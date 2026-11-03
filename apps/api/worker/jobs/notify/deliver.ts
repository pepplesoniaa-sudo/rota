import { z } from 'zod';
import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { calculateQuietHours } from '../../../lib/time/quiet-hours';
import { sendExpoPushNotification } from '../../../lib/domain/notify/expo';
import { quietWindowAtSendSchema } from '../../../lib/domain/notify/schemas';
import { Prisma } from '@prisma/client';

export const notifyDeliverJobSchema = z
  .object({
    notificationId: z.string().uuid(),
  })
  .strict();

export type NotifyDeliverJobData = z.infer<typeof notifyDeliverJobSchema>;

/**
 * Worker handler for notify.deliver (PRD 6.2, PRD 6.3).
 * Runs in system tenant scope (B-20).
 */
export async function handleNotifyDeliver(
  data: unknown,
  job?: Job,
  token?: string,
): Promise<{ sent: boolean; pushed: boolean; rescheduled?: boolean }> {
  const parsed = notifyDeliverJobSchema.parse(data);
  const jobId = job?.id ?? `deliver:${parsed.notificationId}`;

  return runInSystemScope(jobId, async () => {
    // 1. Load notification
    const notification = await dbShard0.notification.findUnique({
      where: { id: parsed.notificationId },
    });

    if (!notification || notification.status !== 'SCHEDULED') {
      logger.debug(
        { notificationId: parsed.notificationId, status: notification?.status },
        'Notification not found or not in SCHEDULED status; skipping delivery',
      );
      return { sent: false, pushed: false };
    }

    // 2. Load recipient user settings
    const settings = await dbShard0.userSettings.findUnique({
      where: { userId: notification.userId },
    });

    if (!settings) {
      logger.warn({ userId: notification.userId }, 'User settings not found for recipient');
      return { sent: false, pushed: false };
    }

    // 3. Send-time quiet hours check (PRD 6.3 rule 4, B-43)
    const now = new Date();
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
        { notificationId: notification.id, newScheduledFor: quietResult.scheduledFor },
        'Recipient currently in quiet hours at send time; moving job to delayed',
      );

      await dbShard0.notification.update({
        where: { id: notification.id },
        data: { scheduledFor: quietResult.scheduledFor },
      });

      if (job && token) {
        await job.moveToDelayed(quietResult.scheduledFor.getTime(), token);
        throw new DelayedError();
      }

      return { sent: false, pushed: false, rescheduled: true };
    }

    // 4. Hourly push cap check (FR-30: max 10 pushes per hour)
    const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSentPushes = await dbShard0.notification.findMany({
      where: {
        userId: notification.userId,
        status: 'SENT',
        sentAt: { gte: sixtyMinutesAgo },
      },
      orderBy: { sentAt: 'asc' },
    });

    if (recentSentPushes.length >= 10) {
      const oldest = recentSentPushes[0];
      const oldestSentAt = oldest?.sentAt ? oldest.sentAt.getTime() : Date.now();
      const releaseAt = new Date(oldestSentAt + 60 * 60 * 1000);

      logger.info(
        { userId: notification.userId, releaseAt },
        'Recipient reached 10 pushes / 60 min rate cap; delaying delivery (FR-30)',
      );

      await dbShard0.notification.update({
        where: { id: notification.id },
        data: { scheduledFor: releaseAt },
      });

      if (job && token) {
        await job.moveToDelayed(releaseAt.getTime(), token);
        throw new DelayedError();
      }

      return { sent: false, pushed: false, rescheduled: true };
    }

    // 5. Query active push tokens for the recipient (PRD 10: disabledAt is null)
    const activeTokens = await dbShard0.pushToken.findMany({
      where: {
        userId: notification.userId,
        disabledAt: null,
      },
    });

    const quietWindowValidated = quietWindowAtSendSchema.parse(quietResult.quietWindow);

    if (activeTokens.length === 0) {
      // In-app notification only: mark SENT without sending push
      await dbShard0.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          quietWindowAtSend: quietWindowValidated as Prisma.InputJsonValue,
        },
      });
      return { sent: true, pushed: false };
    }

    // 6. Deliver push notification to each active token
    let ticketId: string | null = null;
    let allTokensDeviceNotRegistered = true;

    for (const tokenRecord of activeTokens) {
      const ticket = await sendExpoPushNotification({
        to: tokenRecord.expoPushToken,
        title: notification.title,
        body: notification.body,
        data: (notification.data as Record<string, unknown>) ?? {},
        sound: 'default',
      });

      if (ticket.status === 'ok') {
        ticketId = ticket.id;
        allTokensDeviceNotRegistered = false;
      } else {
        const isDeviceNotRegistered =
          ticket.details?.error === 'DeviceNotRegistered' ||
          ticket.message.includes('DeviceNotRegistered');

        if (isDeviceNotRegistered) {
          logger.warn(
            { pushTokenId: tokenRecord.id },
            'Expo reported DeviceNotRegistered; disabling push token (PRD 6.2)',
          );
          await dbShard0.pushToken.update({
            where: { id: tokenRecord.id },
            data: { disabledAt: new Date() },
          });
        } else {
          allTokensDeviceNotRegistered = false;
          logger.error(
            { pushTokenId: tokenRecord.id, message: ticket.message },
            'Failed to deliver push notification',
          );
        }
      }
    }

    if (allTokensDeviceNotRegistered) {
      // PRD 6.2: DeviceNotRegistered disables that push token and has no retry
      await dbShard0.notification.update({
        where: { id: notification.id },
        data: {
          status: 'FAILED',
          failureCode: 'DeviceNotRegistered',
          quietWindowAtSend: quietWindowValidated as Prisma.InputJsonValue,
        },
      });
      throw new UnrecoverableError('DeviceNotRegistered');
    }

    // Mark notification SENT
    await dbShard0.notification.update({
      where: { id: notification.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        expoTicketId: ticketId,
        quietWindowAtSend: quietWindowValidated as Prisma.InputJsonValue,
      },
    });

    return { sent: true, pushed: true };
  });
}
