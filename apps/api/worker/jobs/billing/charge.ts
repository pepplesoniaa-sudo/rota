import { z } from 'zod';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { chargeTokenizedCard } from '../../../lib/billing/flutterwave/client';
import { decryptCardToken } from '../../../lib/billing/flutterwave/encryption';
import { createLedgerEntry } from '../../../lib/billing/ledger';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../queues';
import { LedgerEntryType, SubscriptionStatus } from '@prisma/client';

export const billingChargeJobSchema = z
  .object({
    chargeId: z.string().uuid(),
  })
  .strict();

export type BillingChargeJobData = z.infer<typeof billingChargeJobSchema>;

/**
 * Worker handler for billing.charge (PRD 6.2, B-11, MB-7).
 * Runs tokenized card charge with Flutterwave.
 * Runs in system tenant scope (B-20).
 */
export async function handleBillingCharge(data: unknown): Promise<{
  attemptId?: string;
  txRef?: string;
  success: boolean;
}> {
  const parsed = billingChargeJobSchema.parse(data);
  const jobId = `charge:${parsed.chargeId}`;

  return runInSystemScope(jobId, async () => {
    // 1. Load charge, team owner and active payment method
    const charge = await dbShard0.charge.findUnique({
      where: { id: parsed.chargeId },
      include: {
        team: {
          include: {
            owner: { select: { email: true } },
            subscription: true,
            paymentMethods: {
              where: { disabledAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        attempts: {
          select: { attemptNo: true },
          orderBy: { attemptNo: 'desc' },
          take: 1,
        },
      },
    });

    if (!charge || charge.status === 'PAID') {
      logger.info({ chargeId: parsed.chargeId }, 'Charge not found or already PAID');
      return { success: false };
    }

    const card = charge.team.paymentMethods[0];
    if (!card) {
      logger.warn(
        { teamId: charge.teamId },
        'No active payment method for team; cannot run charge',
      );
      return { success: false };
    }

    const lastAttemptNo = charge.attempts[0]?.attemptNo ?? 0;
    const nextAttemptNo = lastAttemptNo + 1;
    const txRef = `${charge.id}-${nextAttemptNo}`;

    // 2. Commit new ChargeAttempt before calling Flutterwave (MB-7, B-11)
    const attempt = await dbShard0.chargeAttempt.create({
      data: {
        chargeId: charge.id,
        attemptNo: nextAttemptNo,
        txRef,
        method: 'TOKEN',
        amountCents: charge.amountCents,
        status: 'PROCESSING',
      },
    });

    // 3. Decrypt card token and execute charge (B-17)
    const decryptedToken = decryptCardToken(card.providerTokenEncrypted);

    let chargeResult;
    try {
      chargeResult = await chargeTokenizedCard({
        token: decryptedToken,
        amountCents: charge.amountCents,
        txRef,
        email: charge.team.owner.email,
      });
    } catch (err) {
      // MB-7: A timeout or unknown network error sets attempt to PROCESSING for webhook/reconcile
      logger.error(
        { err, txRef },
        'Error executing tokenized card charge; keeping PROCESSING for reconcile',
      );
      return { attemptId: attempt.id, txRef, success: false };
    }

    if (!chargeResult.success) {
      // Provider decline is a payment failure (PRD 6.2, PRD 8.6, B-13)
      logger.warn({ txRef, chargeId: charge.id }, 'Tokenized charge declined by provider');

      const now = new Date();
      await dbShard0.$transaction(async (tx) => {
        await tx.chargeAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED' },
        });

        await tx.charge.update({
          where: { id: charge.id },
          data: { status: 'FAILED' },
        });

        // Write PAYMENT_FAILED ledger entry (amountCents = 0 per PRD 8.7)
        await createLedgerEntry(tx, {
          teamId: charge.teamId,
          chargeId: charge.id,
          type: LedgerEntryType.PAYMENT_FAILED,
          amountCents: 0,
          currency: 'USD',
          idempotencyKey: `payment-failed:${attempt.id}`,
          description: `Card payment failed for attempt ${attempt.attemptNo}`,
          occurredAt: now,
        });

        // Start grace period if subscription not already PAST_DUE (FR-40, PRD 8.6)
        const sub = charge.team.subscription;
        if (
          sub &&
          sub.status !== SubscriptionStatus.PAST_DUE &&
          sub.status !== SubscriptionStatus.READ_ONLY
        ) {
          const graceEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              status: SubscriptionStatus.PAST_DUE,
              graceEndsAt,
              version: { increment: 1 },
            },
          });

          // Schedule grace steps 1, 3, 5, 7 (PRD 8.6)
          const billingQueue = getQueue('billing');
          const dayMs = 24 * 60 * 60 * 1000;
          for (const step of [1, 3, 5, 7]) {
            await billingQueue.add(
              'billing.grace-step',
              { subscriptionId: sub.id, chargeId: charge.id, step },
              {
                jobId: JobId.billingGraceStep(charge.id, step),
                delay: step * dayMs,
                ...JOB_RETRY_POLICIES['billing.grace-step'],
              },
            );
          }
        }
      });

      return { attemptId: attempt.id, txRef, success: false };
    }

    return { attemptId: attempt.id, txRef, success: true };
  });
}
