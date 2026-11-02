import { DateTime } from 'luxon';
import { AppError, AvailabilityResponse, ReplaceAvailabilityBody } from '@rota/shared';
import { dbShard0, getShardClient } from '../../db';
import { getTeamShardIndex } from '../../data/router';

export interface ShiftSegment {
  dayOfWeek: number; // 1 = Monday ... 7 = Sunday
  startMinute: number; // 0 to 1439
  endMinute: number; // 1 to 1440
}

export interface UncoveredInterval {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface AvailabilityBlockLike {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface RawAvailabilityBlockInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Normalizes input blocks by splitting cross-midnight blocks into two and merging
 * touching or overlapping blocks on the same day (FR-19).
 * Enforces maximum of 28 blocks (L-36) and validates endMinute > startMinute.
 */
export function normalizeAndMergeBlocks(
  rawBlocks: RawAvailabilityBlockInput[],
): AvailabilityBlockLike[] {
  const splitBlocks: AvailabilityBlockLike[] = [];

  for (const b of rawBlocks) {
    if (b.endMinute <= b.startMinute) {
      throw new AppError('VALIDATION_FAILED', 400, 'Block end must be after block start');
    }

    if (b.endMinute > 1440) {
      splitBlocks.push({
        dayOfWeek: b.dayOfWeek,
        startMinute: b.startMinute,
        endMinute: 1440,
      });
      const nextDay = b.dayOfWeek === 7 ? 1 : b.dayOfWeek + 1;
      splitBlocks.push({
        dayOfWeek: nextDay,
        startMinute: 0,
        endMinute: b.endMinute - 1440,
      });
    } else {
      splitBlocks.push({
        dayOfWeek: b.dayOfWeek,
        startMinute: b.startMinute,
        endMinute: b.endMinute,
      });
    }
  }

  const merged: AvailabilityBlockLike[] = [];

  for (let day = 1; day <= 7; day++) {
    const dayBlocks = splitBlocks
      .filter((b) => b.dayOfWeek === day)
      .sort((a, b) => a.startMinute - b.startMinute);

    if (dayBlocks.length === 0) continue;

    const first = dayBlocks[0];
    if (!first) continue;
    const cur = { ...first };

    for (let i = 1; i < dayBlocks.length; i++) {
      const next = dayBlocks[i];
      if (!next) continue;
      if (next.startMinute <= cur.endMinute) {
        cur.endMinute = Math.max(cur.endMinute, next.endMinute);
      } else {
        merged.push({ ...cur });
        cur.startMinute = next.startMinute;
        cur.endMinute = next.endMinute;
        cur.dayOfWeek = next.dayOfWeek;
      }
    }
    merged.push(cur);
  }

  if (merged.length > 28) {
    throw new AppError('VALIDATION_FAILED', 400, 'Cannot exceed 28 availability blocks');
  }

  return merged;
}

/**
 * Splits a shift in team-local time into calendar day segments (FR-20).
 * Handles cross-midnight shifts by breaking them at 24:00 (1440).
 */
export function splitShiftIntoSegments(startsLocal: DateTime, endsLocal: DateTime): ShiftSegment[] {
  const segments: ShiftSegment[] = [];
  let current = startsLocal;

  while (current < endsLocal) {
    const nextDayStart = current.plus({ days: 1 }).startOf('day');
    const segmentEnd = endsLocal < nextDayStart ? endsLocal : nextDayStart;

    const dayOfWeek = current.weekday;
    const startMinute = current.hour * 60 + current.minute;
    const endMinute = segmentEnd.hasSame(current, 'day')
      ? segmentEnd.hour * 60 + segmentEnd.minute
      : 1440;

    if (endMinute > startMinute) {
      segments.push({ dayOfWeek, startMinute, endMinute });
    }

    current = nextDayStart;
  }

  return segments;
}

/**
 * Finds uncovered intervals for a shift segment given a member's availability blocks (FR-20).
 */
export function findUncoveredIntervals(
  segment: ShiftSegment,
  blocks: AvailabilityBlockLike[],
): UncoveredInterval[] {
  const dayBlocks = blocks.filter((b) => b.dayOfWeek === segment.dayOfWeek);
  const length = segment.endMinute - segment.startMinute;
  const covered = new Array<boolean>(length).fill(false);

  for (const b of dayBlocks) {
    const from = Math.max(segment.startMinute, b.startMinute);
    const to = Math.min(segment.endMinute, b.endMinute);
    for (let m = from; m < to; m++) {
      covered[m - segment.startMinute] = true;
    }
  }

  const uncovered: UncoveredInterval[] = [];
  let runStart: number | null = null;

  for (let i = 0; i < length; i++) {
    if (!covered[i]) {
      if (runStart === null) {
        runStart = segment.startMinute + i;
      }
    } else {
      if (runStart !== null) {
        uncovered.push({
          dayOfWeek: segment.dayOfWeek,
          startMinute: runStart,
          endMinute: segment.startMinute + i,
        });
        runStart = null;
      }
    }
  }

  if (runStart !== null) {
    uncovered.push({
      dayOfWeek: segment.dayOfWeek,
      startMinute: runStart,
      endMinute: segment.endMinute,
    });
  }

  return uncovered;
}

/**
 * Validates whether an assignee is available for the given shift range (FR-20).
 * If assignee has no blocks, they are treated as available.
 * If any part is uncovered and acknowledgeAvailability is not true, throws 409 AVAILABILITY_WARNING.
 */
export function validateAvailability(params: {
  startsLocal: DateTime;
  endsLocal: DateTime;
  blocks: AvailabilityBlockLike[];
  acknowledgeAvailability?: boolean;
}): { isAvailable: boolean; uncoveredIntervals: UncoveredInterval[] } {
  // Member with no blocks saved is treated as available
  if (params.blocks.length === 0) {
    return { isAvailable: true, uncoveredIntervals: [] };
  }

  const segments = splitShiftIntoSegments(params.startsLocal, params.endsLocal);
  const uncoveredIntervals: UncoveredInterval[] = [];

  for (const segment of segments) {
    const uncovered = findUncoveredIntervals(segment, params.blocks);
    uncoveredIntervals.push(...uncovered);
  }

  if (uncoveredIntervals.length > 0) {
    if (!params.acknowledgeAvailability) {
      throw new AppError(
        'AVAILABILITY_WARNING',
        409,
        'Assignee has availability conflicts during this shift',
        { intervals: uncoveredIntervals },
      );
    }
    return { isAvailable: false, uncoveredIntervals };
  }

  return { isAvailable: true, uncoveredIntervals: [] };
}

export async function replaceAvailability(params: {
  teamId: string;
  userId: string;
  body: ReplaceAvailabilityBody;
}): Promise<AvailabilityResponse> {
  const { teamId, userId, body } = params;

  // 1. Verify team exists
  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  // 2. Verify membership
  const membership = await dbShard0.membership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  // 3. Normalize, split cross-midnight, merge touching/overlapping
  const merged = normalizeAndMergeBlocks(body.blocks);

  // 4. Shard transaction to replace blocks
  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  await shardClient.$transaction(async (tx) => {
    await tx.availabilityBlock.deleteMany({
      where: { teamId, userId },
    });

    if (merged.length > 0) {
      await tx.availabilityBlock.createMany({
        data: merged.map((b) => ({
          teamId,
          userId,
          dayOfWeek: b.dayOfWeek,
          startMinute: b.startMinute,
          endMinute: b.endMinute,
        })),
      });
    }
  });

  const saved = await shardClient.availabilityBlock.findMany({
    where: { teamId, userId },
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  });

  return {
    blocks: saved.map((b) => ({
      id: b.id,
      teamId: b.teamId,
      userId: b.userId,
      dayOfWeek: b.dayOfWeek,
      startMinute: b.startMinute,
      endMinute: b.endMinute,
      createdAt: b.createdAt.toISOString(),
    })),
  };
}

export async function getAvailability(params: {
  teamId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  targetUserId?: string;
}): Promise<AvailabilityResponse> {
  const { teamId, userId, role, targetUserId } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  // Staff cannot view other members' availability (PRD 5.1)
  if (role === 'STAFF') {
    if (targetUserId && targetUserId !== userId) {
      throw new AppError('FORBIDDEN', 403, 'Staff cannot view other members availability');
    }
  }

  const queryUserId = role === 'STAFF' ? userId : (targetUserId ?? undefined);

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const blocks = await shardClient.availabilityBlock.findMany({
    where: {
      teamId,
      userId: queryUserId,
    },
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  });

  return {
    blocks: blocks.map((b) => ({
      id: b.id,
      teamId: b.teamId,
      userId: b.userId,
      dayOfWeek: b.dayOfWeek,
      startMinute: b.startMinute,
      endMinute: b.endMinute,
      createdAt: b.createdAt.toISOString(),
    })),
  };
}
