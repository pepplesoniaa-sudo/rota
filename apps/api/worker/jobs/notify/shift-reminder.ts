import { NotificationType, Prisma } from '@prisma/client';
import { dbShard0, getShardClient } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { calculateQuietHours } from '../../../lib/time/quiet-hours';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../queues';
import { notificationDataSchema } from '../../../lib/domain/notify/schemas';

export interface ShiftReminderJobData {
  windowStart?: string;
  windowEnd?: string;
}

/**
 * Handles notify.shift-reminder job (PRD 6.2, FR-45).
 * Repeatable, runs every 5 minutes.
 * - Finds published shifts starting 55 to 60 minutes from now.
 * - Drops reminders for shifts that have already started.
 * - Drops reminders that fall within recipient's quiet hours (Assumption 28 / FR-45).
 * - Enqueues notify.deliver for active reminders.
 */
export async function handleNotifyShiftReminder(
  data: ShiftReminderJobData = {},
): Promise<{ processedCount: number; sentCount: number }> {
  const now = new Date();
  const windowStart = data.windowStart
    ? new Date(data.windowStart)
    : new Date(now.getTime() + 55 * 60 * 1000);
  const windowEnd = data.windowEnd
    ? new Date(data.windowEnd)
    : new Date(now.getTime() + 60 * 60 * 1000);

  logger.info({ windowStart, windowEnd }, 'Processing notify.shift-reminder scan');

  let processedCount = 0;
  let sentCount = 0;

  // Scan both shards for candidate shifts
  for (const shardIdx of [0, 1]) {
    try {
      const shardClient = getShardClient(shardIdx);
      const shifts = await shardClient.shift.findMany({
        where: {
          status: 'PUBLISHED',
          deletedAt: null,
          startsAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
        select: {
          id: true,
          teamId: true,
          assigneeUserId: true,
          startsAt: true,
          position: true,
        },
      });

      for (const shift of shifts) {
        processedCount++;

        // 1. Drop if shift has already started
        if (shift.startsAt.getTime() <= Date.now()) {
          logger.debug({ shiftId: shift.id }, 'Shift reminder dropped: shift already started');
          continue;
        }

        // 2. Fetch assignee's settings
        const settings = await dbShard0.userSettings.findUnique({
          where: { userId: shift.assigneeUserId },
        });

        if (!settings || !settings.notifyShiftReminders) {
          continue;
        }

        // 3. Check quiet hours: FR-45 / Assumption 28:
        // Reminders falling in quiet hours are dropped because they would arrive after shift starts.
        const quietResult = calculateQuietHours(
          {
            timezone: settings.timezone,
            quietHoursEnabled: settings.quietHoursEnabled,
            quietStartMinute: settings.quietStartMinute,
            quietEndMinute: settings.quietEndMinute,
            quietAfterNightShift: settings.quietAfterNightShift,
          },
          now,
        );

        if (quietResult.inQuietHours) {
          logger.info(
            { shiftId: shift.id, userId: shift.assigneeUserId },
            'Shift reminder dropped: recipient is in quiet hours',
          );
          continue;
        }

        // 4. Resolve team name for notification copy
        const team = await dbShard0.team.findUnique({
          where: { id: shift.teamId },
          select: { name: true },
        });
        const teamName = team?.name ?? 'your team';

        const dedupeKey = JobId.notifyShiftReminder(shift.id, shift.startsAt.toISOString());
        const notificationData = notificationDataSchema.parse({
          teamId: shift.teamId,
          shiftId: shift.id,
          invalidate: ['me', 'shifts'],
        });

        try {
          const notification = await dbShard0.notification.create({
            data: {
              userId: shift.assigneeUserId,
              teamId: shift.teamId,
              type: NotificationType.SHIFT_REMINDER,
              title: 'Upcoming Shift Reminder',
              body: `Your shift (${shift.position}) at ${teamName} starts in 1 hour.`,
              data: notificationData as Prisma.InputJsonValue,
              dedupeKey,
              status: 'SCHEDULED',
              scheduledFor: now,
            },
          });

          // Dispatch immediate deliver job
          const notifyQueue = getQueue('notify');
          const deliverJobId = JobId.notifyDeliver(notification.id, now.toISOString());
          await notifyQueue.add(
            'notify.deliver',
            { notificationId: notification.id },
            {
              jobId: deliverJobId,
              ...JOB_RETRY_POLICIES['notify.deliver'],
            },
          );

          sentCount++;
        } catch (err) {
          // Idempotency: duplicate notification creation on dedupeKey is safely ignored
          const isUniqueConstraint =
            typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002';
          if (!isUniqueConstraint) {
            logger.warn({ err, shiftId: shift.id }, 'Error creating shift reminder notification');
          }
        }
      }
    } catch (err) {
      logger.error({ err, shardIdx }, 'Error querying shard for shift reminders');
    }
  }

  logger.info({ processedCount, sentCount }, 'Completed notify.shift-reminder scan');
  return { processedCount, sentCount };
}
