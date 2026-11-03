import { z } from 'zod';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../queues';
import { SubscriptionStatus } from '@prisma/client';

export const billingGraceStepJobSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    chargeId: z.string().uuid(),
    step: z.number().int().min(1).max(7),
  })
  .strict();

export type BillingGraceStepJobData = z.infer<typeof billingGraceStepJobSchema>;

/**
 * Worker handler for billing.grace-step (PRD 6.2, PRD 8.6, B-13, FR-40).
 * Handles retries on days 1, 3, 5 and READ_ONLY transition on day 7.
 * Runs in system tenant scope (B-20).
 */
export async function handleBillingGraceStep(data: unknown): Promise<{
  handled: boolean;
  action: 'retry' | 'read_only' | 'reconcile_pending' | 'already_paid';
}> {
  const parsed = billingGraceStepJobSchema.parse(data);
  const jobId = JobId.billingGraceStep(parsed.chargeId, parsed.step);

  return runInSystemScope(jobId, async () => {
    const charge = await dbShard0.charge.findUnique({
      where: { id: parsed.chargeId },
      include: {
        team: {
          include: {
            subscription: true,
            paymentMethods: {
              where: { disabledAt: null },
            },
          },
        },
        attempts: {
          orderBy: { attemptNo: 'desc' },
          take: 1,
        },
      },
    });

    if (!charge || charge.status === 'PAID') {
      logger.info({ chargeId: parsed.chargeId }, 'Charge is already paid; skipping grace step');
      return { handled: true, action: 'already_paid' };
    }

    const sub = charge.team.subscription;
    if (!sub || sub.status === SubscriptionStatus.ACTIVE) {
      logger.info(
        { subscriptionId: parsed.subscriptionId },
        'Subscription is active; skipping grace step',
      );
      return { handled: true, action: 'already_paid' };
    }

    const billingQueue = getQueue('billing');

    // Days 1, 3, 5: Retry billing.charge if saved card exists
    if (parsed.step === 1 || parsed.step === 3 || parsed.step === 5) {
      if (charge.team.paymentMethods.length > 0) {
        logger.info(
          { chargeId: charge.id, step: parsed.step },
          'Grace retry: queueing billing.charge with new attempt (PRD 8.6)',
        );
        await billingQueue.add(
          'billing.charge',
          { chargeId: charge.id },
          {
            jobId: `charge:${charge.id}:retry-step-${parsed.step}`,
            ...JOB_RETRY_POLICIES['billing.charge'],
          },
        );
      }
      return { handled: true, action: 'retry' };
    }

    // Day 7: Grace ends unpaid
    if (parsed.step === 7) {
      const lastAttempt = charge.attempts[0];
      // Check RECONCILE_PENDING: if attempt is PROCESSING, delay read-only by 1 hour (PRD 6.2)
      if (lastAttempt && lastAttempt.status === 'PROCESSING') {
        logger.warn(
          { chargeId: charge.id, attemptId: lastAttempt.id },
          'Charge attempt is PROCESSING; logging RECONCILE_PENDING and deferring READ_ONLY by 1 hour (PRD 6.2)',
        );

        await billingQueue.add(
          'billing.grace-step',
          { subscriptionId: sub.id, chargeId: charge.id, step: 7 },
          {
            jobId: `grace:${charge.id}:step-7-deferred:${Date.now()}`,
            delay: 60 * 60 * 1000, // 1 hour
            ...JOB_RETRY_POLICIES['billing.grace-step'],
          },
        );

        return { handled: true, action: 'reconcile_pending' };
      }

      // Transition to READ_ONLY (FR-40, PRD 8.6, B-13)
      logger.warn(
        { subscriptionId: sub.id, teamId: charge.teamId },
        'Grace period ended unpaid; transition to READ_ONLY (FR-40)',
      );

      const now = new Date();
      await dbShard0.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubscriptionStatus.READ_ONLY,
          readOnlySince: now,
          version: { increment: 1 },
        },
      });

      return { handled: true, action: 'read_only' };
    }

    return { handled: false, action: 'already_paid' };
  });
}
