import { DateTime } from 'luxon';
import {
  AppError,
  CopyWeekBody,
  CopyWeekResponse,
  PublishShiftsBody,
  PublishShiftsResponse,
} from '@rota/shared';
import { dbShard0, getShardClient } from '../../db';
import { getTeamShardIndex } from '../../data/router';
import { parseLocalToUtc } from '../../time';
import { dispatchOutboxEntry, OutboxEntry, writeOutbox } from '../../outbox/writer';
import { logger } from '../../log';

interface DbShift {
  id: string;
  teamId: string;
  assigneeUserId: string;
  startsAt: Date;
  endsAt: Date;
  position: string;
  location: string | null;
  notes: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: Date | null;
  version: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Publishes draft shifts in a date range or by specific shift IDs (FR-15c, PRD 7.2).
 * - All matching draft shifts become PUBLISHED in one shard transaction.
 * - Writes one SHIFT_CREATED feed event per published shift (which notifies nobody).
 * - Writes one SCHEDULE_PUBLISHED event.
 * - Writes an Outbox entry for notify.fanout for SCHEDULE_PUBLISHED to notify affected staff.
 */
export async function publishShifts(params: {
  teamId: string;
  publisherUserId: string;
  body: PublishShiftsBody;
}): Promise<PublishShiftsResponse> {
  const { teamId, publisherUserId, body } = params;

  // 1. Fetch team metadata on Shard 0
  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  let candidateShifts: DbShift[] = [];
  let rangeFrom: string;
  let rangeTo: string;

  if (body.shiftIds && body.shiftIds.length > 0) {
    const raw = await shardClient.shift.findMany({
      where: {
        teamId,
        id: { in: body.shiftIds },
        deletedAt: null,
        status: 'DRAFT',
      },
      orderBy: { startsAt: 'asc' },
    });
    candidateShifts = raw as DbShift[];

    const firstShift = candidateShifts[0];
    const lastShift = candidateShifts[candidateShifts.length - 1];

    if (firstShift && lastShift) {
      rangeFrom = DateTime.fromJSDate(firstShift.startsAt, { zone: 'utc' })
        .setZone(team.timezone)
        .toFormat('yyyy-MM-dd');
      rangeTo = DateTime.fromJSDate(lastShift.endsAt, {
        zone: 'utc',
      })
        .setZone(team.timezone)
        .toFormat('yyyy-MM-dd');
    } else {
      rangeFrom = DateTime.now().setZone(team.timezone).toFormat('yyyy-MM-dd');
      rangeTo = rangeFrom;
    }
  } else if (body.from && body.to) {
    rangeFrom = body.from;
    rangeTo = body.to;

    const fromDt = DateTime.fromISO(body.from + 'T00:00:00', { zone: team.timezone });
    const toDt = DateTime.fromISO(body.to + 'T23:59:59.999', { zone: team.timezone });

    if (!fromDt.isValid || !toDt.isValid) {
      throw new AppError('VALIDATION_FAILED', 400, 'Invalid from or to date');
    }
    if (toDt < fromDt) {
      throw new AppError('VALIDATION_FAILED', 400, 'from date must be before or equal to to date');
    }
    const diffDays = toDt.diff(fromDt, 'days').days;
    if (diffDays > 31) {
      throw new AppError('VALIDATION_FAILED', 400, 'Schedule range cannot exceed 31 days');
    }

    const fromUtc = fromDt.toUTC().toJSDate();
    const toUtc = toDt.toUTC().toJSDate();

    const raw = await shardClient.shift.findMany({
      where: {
        teamId,
        deletedAt: null,
        status: 'DRAFT',
        startsAt: { gte: fromUtc, lte: toUtc },
      },
      orderBy: { startsAt: 'asc' },
    });
    candidateShifts = raw as DbShift[];
  } else {
    throw new AppError(
      'VALIDATION_FAILED',
      400,
      'Either (from and to) or shiftIds must be provided',
    );
  }

  if (candidateShifts.length === 0) {
    return { ok: true, publishedCount: 0 };
  }

  const shiftIds = candidateShifts.map((s) => s.id);
  const affectedUserIds = [...new Set(candidateShifts.map((s) => s.assigneeUserId))];
  const now = new Date();

  // 2. Perform publication in one shard transaction
  // A-5 / A-6 / DB-12: Write state change and outbox in the same transaction
  const txResult = await shardClient.$transaction(async (tx) => {
    // A. Update shifts to PUBLISHED
    await tx.shift.updateMany({
      where: {
        teamId,
        id: { in: shiftIds },
      },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
      },
    });

    // B. Write SHIFT_CREATED feed events (fromPublish: true so they notify nobody)
    for (const shift of candidateShifts) {
      await tx.activityEvent.create({
        data: {
          teamId,
          type: 'SHIFT_CREATED',
          actorUserId: publisherUserId,
          subjectShiftId: shift.id,
          subjectUserId: shift.assigneeUserId,
          payload: {
            shiftId: shift.id,
            assigneeUserId: shift.assigneeUserId,
            startsAt: shift.startsAt.toISOString(),
            endsAt: shift.endsAt.toISOString(),
            position: shift.position,
            fromPublish: true,
          },
          dedupeKey: `publish-shift:${shift.id}`,
        },
      });
    }

    // C. Write SCHEDULE_PUBLISHED feed event
    const schedulePublishedEvent = await tx.activityEvent.create({
      data: {
        teamId,
        type: 'SCHEDULE_PUBLISHED',
        actorUserId: publisherUserId,
        subjectShiftId: null,
        subjectUserId: null,
        payload: {
          shiftCount: candidateShifts.length,
          from: rangeFrom,
          to: rangeTo,
          affectedUserIds,
        },
      },
    });

    // D. Write Outbox entry for notify.fanout for SCHEDULE_PUBLISHED
    const outboxEntry = await writeOutbox(tx, {
      kind: 'notify.fanout',
      sourceKey: `event:${schedulePublishedEvent.id}`,
      teamId,
      payload: {
        sourceKey: `event:${schedulePublishedEvent.id}`,
        teamId,
        type: 'SCHEDULE_PUBLISHED',
      },
    });

    return {
      count: candidateShifts.length,
      outboxEntry,
    };
  });

  // 3. Dispatch outbox entry after transaction commit
  if (txResult.outboxEntry) {
    try {
      await dispatchOutboxEntry(txResult.outboxEntry as OutboxEntry);
    } catch (err) {
      logger.warn({ err }, 'Failed to dispatch publish outbox job immediately');
    }
  }

  return {
    ok: true,
    publishedCount: txResult.count,
  };
}

/**
 * Copies last week's shifts to next week in one shard transaction (FR-15b, PRD 7.2).
 * - Creates each shift 7 days later at the same local wall-clock times in the team time zone, as drafts.
 * - Skips any shift that would overlap, whose local time does not exist on the new date, or whose assignee is no longer active.
 * - Returns copied count, skipped count, and detailed skipped list.
 */
export async function copyWeek(params: {
  teamId: string;
  createdByUserId: string;
  body: CopyWeekBody;
}): Promise<CopyWeekResponse> {
  const { teamId, createdByUserId, body } = params;

  // 1. Fetch team metadata on Shard 0
  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const fromDt = DateTime.fromISO(body.fromWeekStart + 'T00:00:00', { zone: team.timezone });
  if (!fromDt.isValid) {
    throw new AppError('VALIDATION_FAILED', 400, 'fromWeekStart must be a valid YYYY-MM-DD date');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const sourceWeekStartUtc = fromDt.toUTC().toJSDate();
  const sourceWeekEndUtc = fromDt.plus({ days: 7 }).toUTC().toJSDate();

  // 2. Fetch all non-deleted shifts in the source week
  const rawSourceShifts = await shardClient.shift.findMany({
    where: {
      teamId,
      deletedAt: null,
      startsAt: { gte: sourceWeekStartUtc, lt: sourceWeekEndUtc },
    },
    orderBy: { startsAt: 'asc' },
  });
  const sourceShifts = rawSourceShifts as DbShift[];

  if (sourceShifts.length === 0) {
    return {
      copiedCount: 0,
      skippedCount: 0,
      skippedShifts: [],
    };
  }

  // 3. Fetch active memberships on Shard 0 for candidate assignees
  const candidateUserIds = [...new Set(sourceShifts.map((s) => s.assigneeUserId))];
  const memberships = await dbShard0.membership.findMany({
    where: {
      teamId,
      userId: { in: candidateUserIds },
    },
    select: { userId: true, status: true },
  });
  const activeUserIds = new Set(
    memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.userId),
  );

  // 4. Query target week existing shifts to detect overlaps
  const targetWeekStartUtc = sourceWeekEndUtc;
  const targetWeekEndUtc = fromDt.plus({ days: 14 }).toUTC().toJSDate();

  const existingTargetShifts = (await shardClient.shift.findMany({
    where: {
      teamId,
      deletedAt: null,
      startsAt: { lt: targetWeekEndUtc },
      endsAt: { gt: targetWeekStartUtc },
    },
    select: {
      id: true,
      assigneeUserId: true,
      startsAt: true,
      endsAt: true,
    },
  })) as Array<{ id: string; assigneeUserId: string; startsAt: Date; endsAt: Date }>;

  const toCreate: Array<{
    teamId: string;
    assigneeUserId: string;
    startsAt: Date;
    endsAt: Date;
    position: string;
    location: string | null;
    notes: string | null;
    status: 'DRAFT';
    createdByUserId: string;
    version: number;
  }> = [];

  const skippedShifts: Array<{
    shiftId: string;
    reason: 'OVERLAP' | 'TIME_NONEXISTENT' | 'ASSIGNEE_INACTIVE';
  }> = [];

  for (const shift of sourceShifts) {
    // A. Check if assignee is still active
    if (!activeUserIds.has(shift.assigneeUserId)) {
      skippedShifts.push({ shiftId: shift.id, reason: 'ASSIGNEE_INACTIVE' });
      continue;
    }

    // B. Calculate target local times 7 days later at same local wall-clock times
    const srcStartLocal = DateTime.fromJSDate(shift.startsAt, { zone: 'utc' }).setZone(
      team.timezone,
    );
    const srcEndLocal = DateTime.fromJSDate(shift.endsAt, { zone: 'utc' }).setZone(team.timezone);

    const targetStartLocal = srcStartLocal.plus({ days: 7 });
    const targetEndLocal = srcEndLocal.plus({ days: 7 });

    const targetStartsLocalStr = targetStartLocal.toFormat("yyyy-MM-dd'T'HH:mm:ss");
    const targetEndsLocalStr = targetEndLocal.toFormat("yyyy-MM-dd'T'HH:mm:ss");

    let targetStartsUtc: DateTime;
    let targetEndsUtc: DateTime;
    try {
      targetStartsUtc = parseLocalToUtc(targetStartsLocalStr, team.timezone);
      targetEndsUtc = parseLocalToUtc(targetEndsLocalStr, team.timezone);
    } catch {
      // Catches SHIFT_TIME_NONEXISTENT or DST spring-forward gap
      skippedShifts.push({ shiftId: shift.id, reason: 'TIME_NONEXISTENT' });
      continue;
    }

    const newStartsAt = targetStartsUtc.toJSDate();
    const newEndsAt = targetEndsUtc.toJSDate();

    // C. Overlap check against existing shifts on target week
    const hasExistingOverlap = existingTargetShifts.some(
      (s) =>
        s.assigneeUserId === shift.assigneeUserId &&
        s.startsAt < newEndsAt &&
        s.endsAt > newStartsAt,
    );

    if (hasExistingOverlap) {
      skippedShifts.push({ shiftId: shift.id, reason: 'OVERLAP' });
      continue;
    }

    // D. Overlap check against newly created shifts in this copy batch for same user
    const hasBatchOverlap = toCreate.some(
      (s) =>
        s.assigneeUserId === shift.assigneeUserId &&
        s.startsAt < newEndsAt &&
        s.endsAt > newStartsAt,
    );

    if (hasBatchOverlap) {
      skippedShifts.push({ shiftId: shift.id, reason: 'OVERLAP' });
      continue;
    }

    toCreate.push({
      teamId,
      assigneeUserId: shift.assigneeUserId,
      startsAt: newStartsAt,
      endsAt: newEndsAt,
      position: shift.position,
      location: shift.location,
      notes: shift.notes,
      status: 'DRAFT',
      createdByUserId,
      version: 1,
    });
  }

  // 5. In one shard transaction, create all valid drafts
  if (toCreate.length > 0) {
    await shardClient.$transaction(async (tx) => {
      for (const item of toCreate) {
        await tx.shift.create({
          data: item,
        });
      }
    });
  }

  return {
    copiedCount: toCreate.length,
    skippedCount: skippedShifts.length,
    skippedShifts,
  };
}
