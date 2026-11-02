import { AppError, FeedEventItem, FeedResponse } from '@rota/shared';
import { dbShard0, getShardClient } from '../../db';
import { getTeamShardIndex } from '../../data/router';

interface DbActivityEvent {
  id: string;
  teamId: string;
  type:
    'SHIFT_CREATED' | 'SHIFT_CHANGED' | 'SHIFT_SWAPPED' | 'MEMBER_JOINED' | 'SCHEDULE_PUBLISHED';
  actorUserId: string | null;
  subjectShiftId: string | null;
  subjectUserId: string | null;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  createdAt: Date;
}

interface CursorPayload {
  t: string;
  id: string;
}

export function encodeCursor(item: { createdAt: Date; id: string }): string {
  const payload: CursorPayload = {
    t: item.createdAt.toISOString(),
    id: item.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursorStr: string): { createdAt: Date; id: string } {
  try {
    const jsonStr = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('t' in parsed) ||
      !('id' in parsed) ||
      typeof (parsed as CursorPayload).t !== 'string' ||
      typeof (parsed as CursorPayload).id !== 'string'
    ) {
      throw new Error('Invalid cursor shape');
    }
    const d = new Date((parsed as CursorPayload).t);
    if (isNaN(d.getTime())) {
      throw new Error('Invalid cursor date');
    }
    return { createdAt: d, id: (parsed as CursorPayload).id };
  } catch {
    throw new AppError('CURSOR_INVALID', 400, 'Invalid pagination cursor');
  }
}

/**
 * Returns paginated team activity events using keyset pagination (FR-26, PRD 7.10).
 * - Ordered by created_at DESC, id DESC.
 * - Keyset cursor: (created_at, id) < (cursorTime, cursorId).
 * - Fetches limit + 1 rows to determine nextCursor.
 */
export async function getTeamFeed(params: {
  teamId: string;
  query: { cursor?: string; limit?: number };
}): Promise<FeedResponse> {
  const { teamId, query } = params;
  const limit = query.limit ?? 20;

  // 1. Verify team on Shard 0
  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  let cursorFilter:
    | {
        OR: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
      }
    | undefined;

  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    cursorFilter = {
      OR: [
        { createdAt: { lt: decoded.createdAt } },
        { createdAt: decoded.createdAt, id: { lt: decoded.id } },
      ],
    };
  }

  const rawEvents = (await shardClient.activityEvent.findMany({
    where: {
      teamId,
      ...cursorFilter,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })) as DbActivityEvent[];

  let nextCursor: string | null = null;
  let itemsToReturn = rawEvents;

  if (rawEvents.length > limit) {
    itemsToReturn = rawEvents.slice(0, limit);
    const lastItem = itemsToReturn[itemsToReturn.length - 1];
    if (lastItem) {
      nextCursor = encodeCursor(lastItem);
    }
  }

  const events: FeedEventItem[] = itemsToReturn.map((e) => ({
    id: e.id,
    teamId: e.teamId,
    type: e.type,
    actorUserId: e.actorUserId,
    subjectShiftId: e.subjectShiftId,
    subjectUserId: e.subjectUserId,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  }));

  return {
    events,
    nextCursor,
  };
}
