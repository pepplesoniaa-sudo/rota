import { z } from 'zod';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { calculateMonthlyPriceCents, PLAN_CONFIGS } from '../../../lib/billing/pricing';
import { createLedgerEntry } from '../../../lib/billing/ledger';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../queues';
import { DateTime } from 'luxon';
import { LedgerEntryType, Plan, Prisma } from '@prisma/client';

export const billingRenewJobSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    periodStart: z.string().datetime(),
  })
  .strict();

export type BillingRenewJobData = z.infer<typeof billingRenewJobSchema>;

/**
 * Worker handler for billing.renew (PRD 6.2, PRD 8.4, FR-39, B-4, B-7, B-12).
 * Renews subscription, bills active seats, applies scheduled downgrades,
 * and creates renewal charge with CHARGE_SUBSCRIPTION ledger entry.
 * Runs in system tenant scope (B-20).
 */
export async function handleBillingRenew(data: unknown): Promise<{
  chargeId: string;
  amountCents: number;
  planPriceCents: number;
}> {
  const parsed = billingRenewJobSchema.parse(data);
  const jobId = JobId.billingRenew(parsed.subscriptionId, parsed.periodStart);

  return runInSystemScope(jobId, async () => {
    const subscription = await dbShard0.subscription.findUnique({
      where: { id: parsed.subscriptionId },
      include: {
        team: {
          include: {
            memberships: {
              where: { status: 'ACTIVE' },
              select: { id: true },
            },
            paymentMethods: {
              where: { disabledAt: null },
            },
          },
        },
      },
    });

    if (!subscription) {
      throw new Error(`Subscription not found: ${parsed.subscriptionId}`);
    }

    const teamId = subscription.teamId;
    const activeSeats = subscription.team.memberships.length;
    const now = new Date();

    // 1. Determine effective plan: apply scheduled downgrade if valid (B-6, PRD 8.4)
    let effectivePlan = subscription.plan;
    if (subscription.scheduledPlan) {
      if (subscription.scheduledPlan === Plan.STARTER && activeSeats > 5) {
        logger.warn(
          { teamId, activeSeats },
          'Scheduled downgrade to Starter cancelled at renewal: active seats > 5 (B-6)',
        );
        // Cancel scheduled downgrade
        effectivePlan = subscription.plan;
      } else {
        effectivePlan = subscription.scheduledPlan;
      }
    }

    // 2. Compute plan price for active seats (B-4, B-7)
    const planPriceCents = calculateMonthlyPriceCents(effectivePlan, activeSeats);

    // 3. Collect any deferred prorations under 100 cents (PRD 8.4, MB-8)
    const deferredCharges = await dbShard0.charge.findMany({
      where: { teamId, status: 'DEFERRED' },
    });

    const deferredTotalCents = deferredCharges.reduce((acc, dc) => acc + dc.amountCents, 0);

    // Total renewal charge amount includes deferred prorations (PRD 8.4)
    const totalAmountCents = planPriceCents + deferredTotalCents;

    // Line items (MB-10)
    const lineItems: Array<{
      label: string;
      amountCents: number;
      deferredChargeId?: string;
    }> = [
      {
        label: `${PLAN_CONFIGS[effectivePlan].name} plan renewal (${activeSeats} seats)`,
        amountCents: planPriceCents,
      },
      ...deferredCharges.map((dc) => ({
        label: 'Deferred proration',
        amountCents: dc.amountCents,
        deferredChargeId: dc.id,
      })),
    ];

    // Compute next period bounds
    const newPeriodStart = new Date(parsed.periodStart);
    const newPeriodEnd = DateTime.fromJSDate(newPeriodStart, { zone: 'utc' })
      .plus({ months: 1 })
      .toJSDate();

    const hasCard = subscription.team.paymentMethods.length > 0;
    // With no card, dueAt is 3 days after period start (PRD 6.2)
    const dueAt = hasCard ? now : new Date(newPeriodStart.getTime() + 3 * 24 * 60 * 60 * 1000);

    const idempotencyKey = `renew:${subscription.id}:${parsed.periodStart}`;

    // 4. In single transaction on shard 0 (MB-8), create Charge, write ledger and update Subscription
    const charge = await dbShard0.$transaction(async (tx) => {
      const createdCharge = await tx.charge.create({
        data: {
          teamId,
          subscriptionId: subscription.id,
          kind: 'SUBSCRIPTION',
          status: 'PENDING',
          amountCents: totalAmountCents,
          currency: 'USD',
          idempotencyKey,
          periodStart: newPeriodStart,
          periodEnd: newPeriodEnd,
          dueAt,
          lineItems: lineItems as Prisma.InputJsonValue,
        },
      });

      // B-12 / PRD 8.4: CHARGE_SUBSCRIPTION is the plan price only, never deferred prorations!
      await createLedgerEntry(tx, {
        teamId,
        chargeId: createdCharge.id,
        type: LedgerEntryType.CHARGE_SUBSCRIPTION,
        amountCents: planPriceCents,
        currency: 'USD',
        idempotencyKey: `charge:${createdCharge.id}`,
        description: `${PLAN_CONFIGS[effectivePlan].name} plan subscription renewal`,
        occurredAt: now,
      });

      // Update subscription: set new plan, reset paidSeats = activeSeats (PRD 8.4)
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          plan: effectivePlan,
          paidSeats: activeSeats,
          scheduledPlan: null,
          currentPeriodStart: newPeriodStart,
          currentPeriodEnd: newPeriodEnd,
          version: { increment: 1 },
        },
      });

      return createdCharge;
    });

    // 5. If saved card exists, queue billing.charge (PRD 6.2)
    const billingQueue = getQueue('billing');
    if (hasCard) {
      await billingQueue.add(
        'billing.charge',
        { chargeId: charge.id },
        {
          jobId: `charge:${charge.id}:initial`,
          ...JOB_RETRY_POLICIES['billing.charge'],
        },
      );
    }

    logger.info(
      { chargeId: charge.id, teamId, totalAmountCents, planPriceCents },
      'Subscription renewed successfully (PRD 8.4)',
    );

    return {
      chargeId: charge.id,
      amountCents: totalAmountCents,
      planPriceCents,
    };
  });
}
