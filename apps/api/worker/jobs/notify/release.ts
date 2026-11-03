import { z } from 'zod';
import { NotificationType } from '@prisma/client';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { sendExpoPushNotification } from '../../../lib/domain/notify/expo';
import { lockDueNotifications } from '../../../lib/data/router';

export const notifyReleaseJobSchema = z
  .object({
    userId: z.string().uuid(),
    releaseAt: z.string().datetime(),
  })
  .strict();

export type NotifyReleaseJobData = z.infer<typeof notifyReleaseJobSchema>;

/**
 * Worker handler for notify.release (PRD 6.2, FR-28, FR-30).
 * Handles quiet hours release, digest coalescing (4+ notifications) and rate cap releases.
 * Runs in system tenant scope (B-20).
 */
export async function handleNotifyRelease(data: unknown): Promise<{
  released: number;
  digest: boolean;
  digestId?: string;
}> {
  const parsed = notifyReleaseJobSchema.parse(data);
  const jobId = `release:${parsed.userId}:${parsed.releaseAt}`;

  return runInSystemScope(jobId, async () => {
    const { userId } = parsed;
    const now = new Date();

    // 1. Lock due SCHEDULED notifications with SELECT ... FOR UPDATE SKIP LOCKED in a transaction (PRD 6.2)
    return dbShard0.$transaction(async (tx) => {
      const dueNotifications = await lockDueNotifications(tx, userId, now);

      if (dueNotifications.length === 0) {
        logger.debug({ userId }, 'No due scheduled notifications found for release');
        return { released: 0, digest: false };
      }

      const activeTokens = await tx.pushToken.findMany({
        where: { userId, disabledAt: null },
      });

      // 2. Digest threshold rule (PRD 6.2 / FR-30):
      // "If there are 4 or more, it sends one digest: a DIGEST notification row is the digest record,
      // and each member notification is marked SENT with digestId pointing to it. Otherwise it sends each one."
      if (dueNotifications.length >= 4) {
        const count = dueNotifications.length;
        const digestTitle = 'Schedule Updates';
        const digestBody = `You have ${count} updates from your teams.`;
        const dedupeKey = `digest:${userId}:${parsed.releaseAt}`;

        // Create the single DIGEST notification record
        const digest = await tx.notification.create({
          data: {
            userId,
            teamId: dueNotifications[0]?.teamId ?? null,
            type: NotificationType.DIGEST,
            title: digestTitle,
            body: digestBody,
            dedupeKey,
            status: 'SENT',
            sentAt: now,
            scheduledFor: now,
          },
        });

        // Mark all member notifications SENT with digestId pointing to digest record
        const dueIds = dueNotifications.map((n) => n.id);
        await tx.notification.updateMany({
          where: { id: { in: dueIds } },
          data: {
            status: 'SENT',
            sentAt: now,
            digestId: digest.id,
          },
        });

        // Send ONE digest push notification to user's devices
        for (const token of activeTokens) {
          const ticket = await sendExpoPushNotification({
            to: token.expoPushToken,
            title: digestTitle,
            body: digestBody,
            data: { url: 'rota://notifications', invalidate: ['feed', 'myShifts'] },
            sound: 'default',
          });

          if (ticket.status === 'ok') {
            await tx.notification.update({
              where: { id: digest.id },
              data: { expoTicketId: ticket.id },
            });
          }
        }

        logger.info(
          { userId, count, digestId: digest.id },
          'Coalesced and delivered digest for 4+ notifications (FR-30)',
        );

        return { released: count, digest: true, digestId: digest.id };
      }

      // 3. Fewer than 4: send each notification individually
      for (const notif of dueNotifications) {
        let ticketId: string | null = null;
        for (const token of activeTokens) {
          const ticket = await sendExpoPushNotification({
            to: token.expoPushToken,
            title: notif.title,
            body: notif.body,
            data: { url: 'rota://notifications' },
            sound: 'default',
          });
          if (ticket.status === 'ok') {
            ticketId = ticket.id;
          }
        }

        await tx.notification.update({
          where: { id: notif.id },
          data: {
            status: 'SENT',
            sentAt: now,
            expoTicketId: ticketId,
          },
        });
      }

      logger.info(
        { userId, count: dueNotifications.length },
        'Delivered notifications individually',
      );
      return { released: dueNotifications.length, digest: false };
    });
  });
}
