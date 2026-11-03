import { z } from 'zod';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../queues';

export const billingRenewalScanJobSchema = z.object({}).strict().default({});

export type BillingRenewalScanJobData = z.infer<typeof billingRenewalScanJobSchema>;

/**
 * Worker handler for billing.renewal-scan (PRD 6.2, FR-39).
 * Scans subscriptions due for renewal and enqueues billing.renew jobs.
 * Runs in system tenant scope (B-20).
 */
export async function handleBillingRenewalScan(data: unknown = {}): Promise<{
  queuedRenewals: number;
}> {
  billingRenewalScanJobSchema.parse(data ?? {});
  const jobId = `renewal-scan:${Date.now()}`;

  return runInSystemScope(jobId, async () => {
    const now = new Date();

    const dueSubscriptions = await dbShard0.subscription.findMany({
      where: {
        currentPeriodEnd: { lte: now },
      },
      take: 100,
    });

    const billingQueue = getQueue('billing');
    let queuedRenewals = 0;

    for (const sub of dueSubscriptions) {
      const periodStartIso = sub.currentPeriodEnd.toISOString();
      const renewJobId = JobId.billingRenew(sub.id, periodStartIso);

      try {
        await billingQueue.add(
          'billing.renew',
          {
            subscriptionId: sub.id,
            periodStart: periodStartIso,
          },
          {
            jobId: renewJobId,
            ...JOB_RETRY_POLICIES['billing.renew'],
          },
        );
        queuedRenewals++;
      } catch (err) {
        logger.error({ err, subscriptionId: sub.id }, 'Failed to queue billing.renew job');
      }
    }

    logger.info({ queuedRenewals }, 'Completed billing.renewal-scan');
    return { queuedRenewals };
  });
}
