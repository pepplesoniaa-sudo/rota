import { NotificationType, Prisma } from '@prisma/client';
import { dbShard0 } from '../../db';
import { getShardDbForTeam } from '../../data/router';
import { logger } from '../../log';
import { calculateQuietHours } from '../../time/quiet-hours';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../../worker/queues';
import { markOutboxProcessed } from '../../outbox/writer';
import { notificationDataSchema } from './schemas';

export interface FanoutParams {
  sourceKey: string;
  teamId: string;
  type: string;
  actorUserId?: string;
}

interface RecipientItem {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Resolves recipients, notification content and quiet hours for any source event.
 * PRD 6.2 / FR-27 / B-41 / B-42
 */
export async function processNotificationFanout(params: FanoutParams): Promise<number> {
  const { sourceKey, teamId, actorUserId } = params;
  const shardDb = await getShardDbForTeam(teamId);

  const candidateRecipients: RecipientItem[] = [];

  // 1. Resolve recipients based on sourceKey kind
  if (sourceKey.startsWith('swap:')) {
    // format: swap:{swapId}:{transition}
    const parts = sourceKey.split(':');
    const swapId = parts[1];
    const transition = parts[2];

    if (swapId && transition) {
      const swap = await shardDb.swapRequest.findUnique({
        where: { id: swapId },
        include: {
          requesterShift: true,
          targetShift: true,
        },
      });

      if (swap) {
        switch (transition) {
          case 'REQUESTED':
            candidateRecipients.push({
              userId: swap.targetUserId,
              type: NotificationType.SWAP_REQUESTED,
              title: 'Shift Swap Requested',
              body: 'A coworker requested a shift swap with you.',
              data: { swapId: swap.id, teamId, invalidate: ['swaps'] },
            });
            break;
          case 'ACCEPTED': {
            // Coworker accepted; notify team managers and owner
            const managers = await dbShard0.membership.findMany({
              where: {
                teamId,
                status: 'ACTIVE',
                role: { in: ['MANAGER', 'OWNER'] },
              },
            });
            for (const m of managers) {
              candidateRecipients.push({
                userId: m.userId,
                type: NotificationType.SWAP_ACCEPTED,
                title: 'Swap Awaiting Approval',
                body: 'A shift swap was accepted by coworker and needs your decision.',
                data: { swapId: swap.id, teamId, invalidate: ['swaps'] },
              });
            }
            break;
          }
          case 'DECLINED':
            candidateRecipients.push({
              userId: swap.requesterUserId,
              type: NotificationType.SWAP_DECLINED,
              title: 'Swap Request Declined',
              body: 'Your coworker declined the swap request.',
              data: { swapId: swap.id, teamId, invalidate: ['swaps'] },
            });
            break;
          case 'APPROVED':
            candidateRecipients.push(
              {
                userId: swap.requesterUserId,
                type: NotificationType.SWAP_APPROVED,
                title: 'Shift Swap Approved',
                body: 'Your shift swap request was approved by management.',
                data: {
                  swapId: swap.id,
                  teamId,
                  invalidate: ['swaps', 'myShifts', 'teamSchedule'],
                },
              },
              {
                userId: swap.targetUserId,
                type: NotificationType.SWAP_APPROVED,
                title: 'Shift Swap Approved',
                body: 'Your shift swap request was approved by management.',
                data: {
                  swapId: swap.id,
                  teamId,
                  invalidate: ['swaps', 'myShifts', 'teamSchedule'],
                },
              },
            );
            break;
          case 'REJECTED':
            candidateRecipients.push(
              {
                userId: swap.requesterUserId,
                type: NotificationType.SWAP_REJECTED,
                title: 'Shift Swap Rejected',
                body: 'Your shift swap request was rejected by management.',
                data: { swapId: swap.id, teamId, invalidate: ['swaps'] },
              },
              {
                userId: swap.targetUserId,
                type: NotificationType.SWAP_REJECTED,
                title: 'Shift Swap Rejected',
                body: 'Your shift swap request was rejected by management.',
                data: { swapId: swap.id, teamId, invalidate: ['swaps'] },
              },
            );
            break;
          case 'EXPIRED':
            candidateRecipients.push({
              userId: swap.requesterUserId,
              type: NotificationType.SWAP_EXPIRED,
              title: 'Swap Request Expired',
              body: 'Your shift swap request expired with no response.',
              data: { swapId: swap.id, teamId, invalidate: ['swaps'] },
            });
            break;
          case 'CANCELED':
            candidateRecipients.push({
              userId: swap.targetUserId,
              type: NotificationType.SWAP_CANCELED,
              title: 'Swap Request Canceled',
              body: 'The coworker canceled their shift swap request.',
              data: { swapId: swap.id, teamId, invalidate: ['swaps'] },
            });
            break;
        }
      }
    }
  } else if (sourceKey.startsWith('event:')) {
    // format: event:{activityEventId}
    const eventId = sourceKey.split(':')[1];
    if (eventId) {
      const event = await shardDb.activityEvent.findUnique({
        where: { id: eventId },
      });

      if (event) {
        if (event.type === 'SCHEDULE_PUBLISHED') {
          // B-42: Send each affected staff member one notification with count and range
          const eventData = (event.payload ?? {}) as Record<string, unknown>;
          const affectedMap = (eventData.affectedUserCounts ?? {}) as Record<string, number>;
          const rangeStr = (eventData.rangeSummary as string) ?? 'the upcoming period';

          for (const [userId, count] of Object.entries(affectedMap)) {
            candidateRecipients.push({
              userId,
              type: NotificationType.SCHEDULE_PUBLISHED,
              title: 'Schedule Published',
              body: `Your schedule for ${rangeStr} is out: ${count} shift${count === 1 ? '' : 's'}.`,
              data: { teamId, invalidate: ['myShifts', 'teamSchedule', 'feed'] },
            });
          }
        } else if (event.type === 'SHIFT_CREATED') {
          // B-42: SHIFT_CREATED written by a publish notify nobody
          const eventData = (event.payload ?? {}) as Record<string, unknown>;
          if (!eventData.fromPublish && event.subjectShiftId) {
            const shift = await shardDb.shift.findUnique({ where: { id: event.subjectShiftId } });
            if (shift && shift.assigneeUserId) {
              candidateRecipients.push({
                userId: shift.assigneeUserId,
                type: NotificationType.SHIFT_CREATED,
                title: 'New Shift Scheduled',
                body: 'You have been assigned a new shift.',
                data: { shiftId: shift.id, teamId, invalidate: ['myShifts', 'teamSchedule'] },
              });
            }
          }
        } else if (event.type === 'SHIFT_CHANGED') {
          if (event.subjectShiftId) {
            const shift = await shardDb.shift.findUnique({ where: { id: event.subjectShiftId } });
            if (shift && shift.assigneeUserId) {
              candidateRecipients.push({
                userId: shift.assigneeUserId,
                type: NotificationType.SHIFT_CHANGED,
                title: 'Shift Updated',
                body: 'Details of your upcoming shift have changed.',
                data: { shiftId: shift.id, teamId, invalidate: ['myShifts', 'teamSchedule'] },
              });
            }
          }
        } else if (event.type === 'MEMBER_JOINED') {
          // Notify managers and owner
          const managers = await dbShard0.membership.findMany({
            where: {
              teamId,
              status: 'ACTIVE',
              role: { in: ['MANAGER', 'OWNER'] },
            },
          });
          const eventData = (event.payload ?? {}) as Record<string, unknown>;
          const memberName = (eventData.name as string) ?? 'A new member';
          for (const m of managers) {
            candidateRecipients.push({
              userId: m.userId,
              type: NotificationType.MEMBER_JOINED,
              title: 'New Team Member',
              body: `${memberName} joined the team.`,
              data: { teamId, invalidate: ['teamMembers', 'feed'] },
            });
          }
        }
      }
    }
  } else if (sourceKey.startsWith('ownership:')) {
    // format: ownership:{teamId}:{transferredAtIso}
    const team = await dbShard0.team.findUnique({ where: { id: teamId } });
    if (team) {
      candidateRecipients.push({
        userId: team.ownerUserId,
        type: NotificationType.OWNERSHIP_TRANSFERRED,
        title: 'Ownership Transferred',
        body: `You are now the owner of ${team.name}.`,
        data: { teamId, invalidate: ['myTeams', 'teamMembers'] },
      });
    }
  } else if (sourceKey.startsWith('seat:')) {
    const team = await dbShard0.team.findUnique({ where: { id: teamId } });
    if (team) {
      candidateRecipients.push({
        userId: team.ownerUserId,
        type: NotificationType.SEAT_ADDED,
        title: 'Paid Seat Added',
        body: `A new active seat was added for ${team.name}.`,
        data: { teamId, invalidate: ['billing', 'teamMembers'] },
      });
    }
  } else if (sourceKey.startsWith('payment-failed:')) {
    const team = await dbShard0.team.findUnique({ where: { id: teamId } });
    if (team) {
      candidateRecipients.push({
        userId: team.ownerUserId,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment Failed',
        body: `Subscription payment failed for ${team.name}. Please update your payment method.`,
        data: { teamId, invalidate: ['billing'] },
      });
    }
  }

  if (candidateRecipients.length === 0) {
    await markOutboxProcessed(dbShard0, sourceKey);
    return 0;
  }

  // 2. Filter out actor (B-41: never notify the user whose action triggered it)
  const nonActorRecipients = candidateRecipients.filter((r) => r.userId !== actorUserId);

  if (nonActorRecipients.length === 0) {
    await markOutboxProcessed(dbShard0, sourceKey);
    return 0;
  }

  // 3. Batch load recipient user settings to check toggles and quiet hours
  const recipientUserIds = [...new Set(nonActorRecipients.map((r) => r.userId))];
  const userSettingsList = await dbShard0.userSettings.findMany({
    where: { userId: { in: recipientUserIds } },
  });
  const settingsByUserId = new Map(userSettingsList.map((s) => [s.userId, s]));

  const notifyQueue = getQueue('notify');
  let createdCount = 0;

  for (const recipient of nonActorRecipients) {
    const settings = settingsByUserId.get(recipient.userId);
    if (!settings) {
      continue;
    }

    // Check user notification toggles
    if (
      recipient.type === NotificationType.SHIFT_CREATED ||
      recipient.type === NotificationType.SHIFT_CHANGED ||
      recipient.type === NotificationType.SCHEDULE_PUBLISHED
    ) {
      if (!settings.notifyShiftChanges) continue;
    } else if (
      recipient.type === NotificationType.SWAP_REQUESTED ||
      recipient.type === NotificationType.SWAP_ACCEPTED ||
      recipient.type === NotificationType.SWAP_DECLINED ||
      recipient.type === NotificationType.SWAP_APPROVED ||
      recipient.type === NotificationType.SWAP_REJECTED ||
      recipient.type === NotificationType.SWAP_EXPIRED ||
      recipient.type === NotificationType.SWAP_CANCELED
    ) {
      if (!settings.notifySwaps) continue;
    } else if (recipient.type === NotificationType.MEMBER_JOINED) {
      if (!settings.notifyMemberJoined) continue;
    } else if (recipient.type === NotificationType.SHIFT_REMINDER) {
      if (!settings.notifyShiftReminders) continue;
    }

    // Calculate quiet hours
    const quietResult = calculateQuietHours({
      timezone: settings.timezone,
      quietHoursEnabled: settings.quietHoursEnabled,
      quietStartMinute: settings.quietStartMinute,
      quietEndMinute: settings.quietEndMinute,
      quietAfterNightShift: settings.quietAfterNightShift,
    });

    const dedupeKey = `${sourceKey}:${recipient.userId}`;
    const parsedData = notificationDataSchema.parse(recipient.data ?? {});

    try {
      const notification = await dbShard0.notification.create({
        data: {
          userId: recipient.userId,
          teamId,
          type: recipient.type,
          title: recipient.title.slice(0, 80),
          body: recipient.body.slice(0, 240),
          data: parsedData as Prisma.InputJsonValue,
          dedupeKey,
          status: 'SCHEDULED',
          scheduledFor: quietResult.scheduledFor,
        },
      });

      createdCount++;

      // Dispatch appropriate job
      if (quietResult.inQuietHours) {
        // Held in quiet hours: one notify.release job per user per release time (PRD 6.2)
        const releaseAtIso = quietResult.scheduledFor.toISOString();
        const releaseJobId = JobId.notifyRelease(recipient.userId, releaseAtIso);
        const delayMs = Math.max(0, quietResult.scheduledFor.getTime() - Date.now());

        await notifyQueue.add(
          'notify.release',
          { userId: recipient.userId, releaseAt: releaseAtIso },
          {
            jobId: releaseJobId,
            delay: delayMs,
            ...JOB_RETRY_POLICIES['notify.release'],
          },
        );
      } else {
        // Not held: deliver immediately (or at scheduledFor)
        const deliverJobId = JobId.notifyDeliver(
          notification.id,
          quietResult.scheduledFor.toISOString(),
        );
        const delayMs = Math.max(0, quietResult.scheduledFor.getTime() - Date.now());

        await notifyQueue.add(
          'notify.deliver',
          { notificationId: notification.id },
          {
            jobId: deliverJobId,
            delay: delayMs,
            ...JOB_RETRY_POLICIES['notify.deliver'],
          },
        );
      }
    } catch (err: unknown) {
      // P2002 on dedupeKey means duplicate fanout already ran (DB-11: idempotent)
      if (
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') ||
        (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002')
      ) {
        logger.debug({ dedupeKey }, 'Duplicate notification suppressed by unique dedupeKey');
        continue;
      }
      throw err;
    }
  }

  await markOutboxProcessed(dbShard0, sourceKey);
  return createdCount;
}
