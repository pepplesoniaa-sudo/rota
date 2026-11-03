import { AppError, ERROR_CODES } from '@rota/shared';
import { dbShard0 } from '../../db';
import { calculateMonthlyPriceCents, PLAN_CONFIGS } from '../../billing/pricing';
import { calculateProrationCents } from '../../billing/proration';
import { createLedgerEntry } from '../../billing/ledger';
import { redis } from '../../redis';
import { getQueue, JOB_RETRY_POLICIES } from '../../../worker/queues';
import { ChargeStatus, LedgerEntryType, Plan, Prisma } from '@prisma/client';

export interface PlanChangeCalculation {
  currentPlan: Plan;
  newPlan: Plan;
  isUpgrade: boolean;
  appliesAt: 'IMMEDIATELY' | 'PERIOD_END';
  prorationCents: number;
  nextRenewalAmountCents: number;
  effectiveDate: string;
  activeSeats: number;
  paidSeats: number;
}

/**
 * Pure calculation shared by preview and execution (MB-14 / B-15).
 */
export function calculatePlanChange(
  currentPlan: Plan,
  newPlan: Plan,
  paidSeats: number,
  activeSeats: number,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  changeInstant: Date = new Date(),
): PlanChangeCalculation {
  if (currentPlan === newPlan) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      400,
      `Team is already on the ${PLAN_CONFIGS[newPlan].name} plan`,
    );
  }

  // B-6 & FR-37: Reject a Starter downgrade while active seats are above 5
  if (newPlan === Plan.STARTER && activeSeats > 5) {
    throw new AppError(
      ERROR_CODES.SEAT_LIMIT_REACHED,
      409,
      'Cannot downgrade to Starter with more than 5 active seats',
    );
  }

  // B-6: Classify plan change by price at current paidSeats, never by tier name
  const currentMonthly = calculateMonthlyPriceCents(currentPlan, paidSeats);
  const newMonthly = calculateMonthlyPriceCents(newPlan, paidSeats);
  const isUpgrade = newMonthly > currentMonthly;

  let prorationCents = 0;
  let appliesAt: 'IMMEDIATELY' | 'PERIOD_END' = 'PERIOD_END';
  let effectiveDate = currentPeriodEnd.toISOString();

  if (isUpgrade) {
    appliesAt = 'IMMEDIATELY';
    effectiveDate = changeInstant.toISOString();
    // B-5: Compute proration using exact PRD 8.2 formula
    const periodSeconds = Math.floor(
      (currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / 1000,
    );
    const remainingSeconds = Math.floor(
      (currentPeriodEnd.getTime() - changeInstant.getTime()) / 1000,
    );
    const deltaCents = newMonthly - currentMonthly;
    prorationCents = calculateProrationCents({
      deltaCents,
      remainingSeconds,
      periodSeconds,
    });
  }

  const nextRenewalPlan = isUpgrade ? newPlan : newPlan;
  const nextRenewalAmountCents = calculateMonthlyPriceCents(nextRenewalPlan, activeSeats);

  return {
    currentPlan,
    newPlan,
    isUpgrade,
    appliesAt,
    prorationCents,
    nextRenewalAmountCents,
    effectiveDate,
    activeSeats,
    paidSeats,
  };
}

/**
 * Previews a plan change without writing to the database (B-15, MB-14, FR-36).
 */
export async function previewPlanChange(
  teamId: string,
  newPlan: Plan,
  changeInstant: Date = new Date(),
): Promise<PlanChangeCalculation> {
  const subscription = await dbShard0.subscription.findUnique({
    where: { teamId },
    include: {
      team: {
        select: {
          memberships: {
            where: { status: 'ACTIVE' },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!subscription) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Subscription not found');
  }

  const activeSeats = subscription.team.memberships.length;

  return calculatePlanChange(
    subscription.plan,
    newPlan,
    subscription.paidSeats,
    activeSeats,
    subscription.currentPeriodStart,
    subscription.currentPeriodEnd,
    changeInstant,
  );
}

/**
 * Executes a plan change (FR-36, FR-37, B-5, B-6, MB-8, MB-13).
 */
export async function executePlanChange(
  teamId: string,
  newPlan: Plan,
  _actorUserId?: string,
  changeInstant: Date = new Date(),
): Promise<PlanChangeCalculation> {
  const now = changeInstant;

  const result = await dbShard0.$transaction(async (tx) => {
    // MB-13: Serialize seat and plan changes per team via Subscription.version increment
    const subscription = await tx.subscription.update({
      where: { teamId },
      data: { version: { increment: 1 } },
      include: {
        team: {
          select: {
            memberships: {
              where: { status: 'ACTIVE' },
              select: { id: true },
            },
            paymentMethods: {
              where: { disabledAt: null },
              select: { id: true },
            },
          },
        },
      },
    });

    const activeSeats = subscription.team.memberships.length;
    const calc = calculatePlanChange(
      subscription.plan,
      newPlan,
      subscription.paidSeats,
      activeSeats,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
      now,
    );

    if (calc.isUpgrade) {
      // 1. Upgrade applies immediately
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          plan: newPlan,
          scheduledPlan: null, // Clear any prior scheduled change
        },
      });

      // 2. If proration > 0, create Charge and ledger entry
      if (calc.prorationCents > 0) {
        // B-5: proration under 100 cents still gets ledger entry, collected at next renewal (DEFERRED)
        const isDeferred = calc.prorationCents < 100;
        const chargeStatus: ChargeStatus = isDeferred ? 'DEFERRED' : 'PENDING';
        const dueAt = isDeferred ? subscription.currentPeriodEnd : now;
        const idempotencyKey = `proration:${subscription.id}:${newPlan}:${now.toISOString()}`;

        const lineItems = [
          {
            label: `Prorated upgrade to ${PLAN_CONFIGS[newPlan].name}`,
            amountCents: calc.prorationCents,
          },
        ];

        const charge = await tx.charge.create({
          data: {
            teamId,
            subscriptionId: subscription.id,
            kind: 'UPGRADE_PRORATION',
            status: chargeStatus,
            amountCents: calc.prorationCents,
            currency: 'USD',
            idempotencyKey,
            dueAt,
            lineItems: lineItems as Prisma.InputJsonValue,
          },
        });

        // MB-9: CHARGE_UPGRADE_PRORATION ledger key is charge:{chargeId}
        await createLedgerEntry(tx, {
          teamId,
          chargeId: charge.id,
          type: LedgerEntryType.CHARGE_UPGRADE_PRORATION,
          amountCents: calc.prorationCents,
          currency: 'USD',
          idempotencyKey: `charge:${charge.id}`,
          description: `Prorated upgrade to ${PLAN_CONFIGS[newPlan].name}`,
          occurredAt: now,
        });

        // If not deferred and active card exists, queue tokenized charge (B-11, PRD 6.2)
        if (!isDeferred && subscription.team.paymentMethods.length > 0) {
          const billingQueue = getQueue('billing');
          await billingQueue.add(
            'billing.charge',
            { chargeId: charge.id },
            {
              jobId: `charge:${charge.id}:initial`,
              ...JOB_RETRY_POLICIES['billing.charge'],
            },
          );
        }
      }
    } else {
      // Downgrade: scheduled for period end with no credit or refund (FR-37)
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          scheduledPlan: newPlan,
        },
      });
    }

    return calc;
  });

  // Invalidate cached team status (L-32)
  try {
    await redis.del(`team:${teamId}`);
  } catch {
    // Non-fatal cache invalidation failure
  }

  return result;
}

/**
 * Cancels a scheduled downgrade (FR-37).
 */
export async function cancelScheduledPlanChange(teamId: string): Promise<{ success: boolean }> {
  await dbShard0.subscription.update({
    where: { teamId },
    data: {
      scheduledPlan: null,
      version: { increment: 1 },
    },
  });

  try {
    await redis.del(`team:${teamId}`);
  } catch {
    // Non-fatal
  }

  return { success: true };
}
