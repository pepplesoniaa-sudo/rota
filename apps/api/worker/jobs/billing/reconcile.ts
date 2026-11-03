import { z } from 'zod';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import {
  resendTransactionWebhook,
  verifyTransaction,
} from '../../../lib/billing/flutterwave/client';

export const billingReconcileJobSchema = z.object({}).strict().default({});

export type BillingReconcileJobData = z.infer<typeof billingReconcileJobSchema>;

/**
 * Worker handler for billing.reconcile (PRD 6.2, B-9, MB-7).
 * Repeatable every 30 min: inspects attempts in PROCESSING > 30 minutes.
 * If provider reports success, requests webhook resend.
 * Reconcile NEVER marks a charge paid by itself (B-9).
 * Runs in system tenant scope (B-20).
 */
export async function handleBillingReconcile(data: unknown = {}): Promise<{
  reconciledCount: number;
}> {
  billingReconcileJobSchema.parse(data ?? {});
  const jobId = `reconcile:${Date.now()}`;

  return runInSystemScope(jobId, async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const stuckAttempts = await dbShard0.chargeAttempt.findMany({
      where: {
        status: 'PROCESSING',
        createdAt: { lte: thirtyMinutesAgo },
      },
      take: 50,
    });

    let reconciledCount = 0;

    for (const attempt of stuckAttempts) {
      try {
        const verifyResult = await verifyTransaction(attempt.txRef);
        const vData = verifyResult.data;

        if (vData.status === 'successful') {
          logger.info(
            { attemptId: attempt.id, txRef: attempt.txRef },
            'Reconcile found successful transaction; requesting webhook resend (B-9)',
          );
          // Request Flutterwave to resend webhook
          await resendTransactionWebhook(vData.id);
          reconciledCount++;
        } else {
          logger.warn(
            { attemptId: attempt.id, txRef: attempt.txRef, status: vData.status },
            'RECONCILE_MISMATCH: Flutterwave reports unconfirmed transaction (PRD 6.2)',
          );
        }
      } catch (err) {
        logger.error(
          { err, attemptId: attempt.id, txRef: attempt.txRef },
          'Failed to verify stuck attempt in billing.reconcile',
        );
      }
    }

    logger.info({ reconciledCount }, 'Completed billing.reconcile');
    return { reconciledCount };
  });
}
