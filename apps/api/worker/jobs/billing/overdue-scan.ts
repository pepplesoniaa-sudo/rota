import { z } from 'zod';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { createLedgerEntry } from '../../../lib/billing/ledger';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../queues';
import { LedgerEntryType, SubscriptionStatus } from '@prisma/client';

export const billingOverdueScanJobSchema = z.object({}).strict().default({});

export type BillingOverdueScanJobData = z.infer<typeof billingOverdueScanJobSchema>;

/**
 * Worker handler for billing.overdue-scan (PRD 6.2, FR-40).
 * Scans charges in PENDING or DEFERRED past their dueAt, marks FAILED,
 * records PAYMENT_FAILED in ledger, and initiates grace period.
 * Runs in system tenant scope (B-20).
 */
export async function handleBillingOverdueScan(data: unknown = {}): Promise<{
  overdueCount: number;
}> {
  billingOverdueScanJobSchema.parse(data ?? {});
  const jobId = `overdue-scan:${Date.now()}`;

  return runInSystemScope(jobId, async () => {
    const now = new Date();

    const overdueCharges = await dbShard0.charge.findMany({
      where: {
        status: { in: ['PENDING', 'DEFERRED'] },
        dueAt: { lte: now },
      },
      include: {
        team: {
          include: {
            subscription: true,
          },
        },
      },
      take: 100,
    });

    let overdueCount = 0;
    const billingQueue = getQueue('billing');
    const dayMs = 24 * 60 * 60 * 1000;

    for (const charge of overdueCharges) {
      try {
        await dbShard0.$transaction(async (tx) => {
          // Conditional update on charge status
          const updated = await tx.charge.updateMany({
            where: {
              id: charge.id,
              status: { in: ['PENDING', 'DEFERRED'] },
            },
            data: {
              status: 'FAILED',
              failureCode: 'OVERDUE',
            },
          });

          if (updated.count === 0) {
            return;
          }

          // Write PAYMENT_FAILED ledger entry (amount = 0 per PRD 8.7)
          await createLedgerEntry(tx, {
            teamId: charge.teamId,
            chargeId: charge.id,
            type: LedgerEntryType.PAYMENT_FAILED,
            amountCents: 0,
            currency: 'USD',
            idempotencyKey: `payment-failed:overdue:${charge.id}`,
            description: `Charge overdue as of ${now.toISOString()}`,
            occurredAt: now,
          });

          // Start 7-day grace period if not already past due or read-only (FR-40, PRD 8.6)
          const sub = charge.team.subscription;
          if (
            sub &&
            sub.status !== SubscriptionStatus.PAST_DUE &&
            sub.status !== SubscriptionStatus.READ_ONLY
          ) {
            const graceEndsAt = new Date(now.getTime() + 7 * dayMs);
            await tx.subscription.update({
              where: { id: sub.id },
              data: {
                status: SubscriptionStatus.PAST_DUE,
                graceEndsAt,
                version: { increment: 1 },
              },
            });

            // Schedule grace steps 1, 3, 5, 7 (PRD 8.6)
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

          overdueCount++;
        });
      } catch (err) {
        logger.error({ err, chargeId: charge.id }, 'Failed to process overdue charge');
      }
    }

    logger.info({ overdueCount }, 'Completed billing.overdue-scan');
    return { overdueCount };
  });
}
