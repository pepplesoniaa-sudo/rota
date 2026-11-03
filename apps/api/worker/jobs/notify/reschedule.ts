import { z } from 'zod';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { calculateQuietHours } from '../../../lib/time/quiet-hours';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../queues';

export const notifyRescheduleJobSchema = z
  .object({
    userId: z.string().uuid(),
    settingsVersion: z.number().int().optional(),
  })
  .strict();

export type NotifyRescheduleJobData = z.infer<typeof notifyRescheduleJobSchema>;

/**
 * Worker handler for notify.reschedule (PRD 6.2, FR-28, FR-31).
 * Re-computes scheduledFor on pending SCHEDULED notifications when user settings change.
 * Removes old delayed jobs and re-queues them.
 * Runs in system tenant scope (B-20).
 */
export async function handleNotifyReschedule(data: unknown): Promise<{ rescheduledCount: number }> {
  const parsed = notifyRescheduleJobSchema.parse(data);
  const version = parsed.settingsVersion ?? 1;
  const jobId = `reschedule:${parsed.userId}:${version}`;

  return runInSystemScope(jobId, async () => {
    const { userId } = parsed;

    const settings = await dbShard0.userSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      logger.warn({ userId }, 'User settings not found for reschedule');
      return { rescheduledCount: 0 };
    }

    const pendingNotifications = await dbShard0.notification.findMany({
      where: {
        userId,
        status: 'SCHEDULED',
      },
    });

    if (pendingNotifications.length === 0) {
      return { rescheduledCount: 0 };
    }

    const notifyQueue = getQueue('notify');
    let rescheduledCount = 0;

    for (const notif of pendingNotifications) {
      const oldScheduledIso = notif.scheduledFor.toISOString();

      // Re-calculate quiet hours with updated settings
      const quietResult = calculateQuietHours({
        timezone: settings.timezone,
        quietHoursEnabled: settings.quietHoursEnabled,
        quietStartMinute: settings.quietStartMinute,
        quietEndMinute: settings.quietEndMinute,
        quietAfterNightShift: settings.quietAfterNightShift,
      });

      // Update in database
      await dbShard0.notification.update({
        where: { id: notif.id },
        data: { scheduledFor: quietResult.scheduledFor },
      });

      // Remove old delayed deliver job if present
      const oldJobId = JobId.notifyDeliver(notif.id, oldScheduledIso);
      try {
        const oldJob = await notifyQueue.getJob(oldJobId);
        if (oldJob) {
          await oldJob.remove();
        }
      } catch {
        // Ignore if already gone
      }

      // Add new job
      const delayMs = Math.max(0, quietResult.scheduledFor.getTime() - Date.now());
      if (quietResult.inQuietHours) {
        const releaseJobId = JobId.notifyRelease(userId, quietResult.scheduledFor.toISOString());
        await notifyQueue.add(
          'notify.release',
          { userId, releaseAt: quietResult.scheduledFor.toISOString() },
          {
            jobId: releaseJobId,
            delay: delayMs,
            ...JOB_RETRY_POLICIES['notify.release'],
          },
        );
      } else {
        const deliverJobId = JobId.notifyDeliver(notif.id, quietResult.scheduledFor.toISOString());
        await notifyQueue.add(
          'notify.deliver',
          { notificationId: notif.id },
          {
            jobId: deliverJobId,
            delay: delayMs,
            ...JOB_RETRY_POLICIES['notify.deliver'],
          },
        );
      }

      rescheduledCount++;
    }

    logger.info({ userId, rescheduledCount }, 'Rescheduled pending notifications (FR-28)');
    return { rescheduledCount };
  });
}
