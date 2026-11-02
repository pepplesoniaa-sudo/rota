import { DateTime } from 'luxon';
import { MyShiftItem, MyShiftsQuery, MyShiftsResponse } from '@rota/shared';
import { dbShard0, getShardClient } from '../../db';

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
 * Returns all published shifts across all teams for the authenticated user (FR-17, PRD 7.2).
 * - Queries both shards in parallel in the user tenant scope.
 * - Drafts are excluded.
 * - Detects cross-team overlapping shifts and labels with overlapping team names.
 */
export async function getMyShifts(params: {
  userId: string;
  query: MyShiftsQuery;
}): Promise<MyShiftsResponse> {
  const { userId, query } = params;

  // 1. Fetch active memberships and their teams on Shard 0
  const memberships = await dbShard0.membership.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      team: { deletedAt: null },
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          timezone: true,
          shardIndex: true,
        },
      },
    },
  });

  if (memberships.length === 0) {
    return { shifts: [] };
  }

  // 2. Group teams by shardIndex
  const teamsByShard = new Map<number, Array<{ id: string; name: string; timezone: string }>>();
  const teamMap = new Map<string, { id: string; name: string; timezone: string }>();

  for (const m of memberships) {
    if (!m.team) continue;
    const teamInfo = { id: m.team.id, name: m.team.name, timezone: m.team.timezone };
    teamMap.set(m.team.id, teamInfo);

    const sIdx = m.team.shardIndex ?? 0;
    const list = teamsByShard.get(sIdx) ?? [];
    list.push(teamInfo);
    teamsByShard.set(sIdx, list);
  }

  // 3. Prepare date range UTC bounds
  const fromUtc = query.from
    ? DateTime.fromISO(query.from + 'T00:00:00', { zone: 'utc' }).toJSDate()
    : undefined;
  const toUtc = query.to
    ? DateTime.fromISO(query.to + 'T23:59:59.999', { zone: 'utc' }).toJSDate()
    : undefined;

  // 4. Query shards in parallel (FR-17)
  const shardPromises = Array.from(teamsByShard.entries()).map(async ([sIdx, teams]) => {
    const shardClient = getShardClient(sIdx);
    const teamIds = teams.map((t) => t.id);

    const raw = await shardClient.shift.findMany({
      where: {
        teamId: { in: teamIds },
        assigneeUserId: userId,
        deletedAt: null,
        status: 'PUBLISHED', // Drafts are excluded
        ...(fromUtc ? { startsAt: { gte: fromUtc } } : {}),
        ...(toUtc ? { startsAt: { lte: toUtc } } : {}),
      },
      orderBy: { startsAt: 'asc' },
    });
    return raw as DbShift[];
  });

  const shardResults = await Promise.all(shardPromises);
  const allShifts = shardResults.flat().sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  // 5. Format shifts with local times and cross-team overlap detection
  const formattedShifts: MyShiftItem[] = allShifts.map((shift) => {
    const team = teamMap.get(shift.teamId) ?? {
      id: shift.teamId,
      name: 'Unknown Team',
      timezone: 'UTC',
    };

    const startsLocal = DateTime.fromJSDate(shift.startsAt, { zone: 'utc' })
      .setZone(team.timezone)
      .toFormat("yyyy-MM-dd'T'HH:mm:ss");
    const endsLocal = DateTime.fromJSDate(shift.endsAt, { zone: 'utc' })
      .setZone(team.timezone)
      .toFormat("yyyy-MM-dd'T'HH:mm:ss");

    // Detect overlapping shifts across DIFFERENT teams (FR-17)
    const overlappingOtherTeams = allShifts.filter(
      (other) =>
        other.teamId !== shift.teamId &&
        other.startsAt < shift.endsAt &&
        other.endsAt > shift.startsAt,
    );

    const hasOverlapAcrossTeams = overlappingOtherTeams.length > 0;
    const overlappingTeamNames = hasOverlapAcrossTeams
      ? [
          ...new Set(
            overlappingOtherTeams.map((o) => teamMap.get(o.teamId)?.name ?? 'Unknown Team'),
          ),
        ]
      : undefined;

    return {
      id: shift.id,
      teamId: shift.teamId,
      teamName: team.name,
      teamTimezone: team.timezone,
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
      startsLocal,
      endsLocal,
      position: shift.position,
      location: shift.location ?? null,
      notes: shift.notes ?? null,
      version: shift.version,
      hasOverlapAcrossTeams,
      overlappingTeamNames,
    };
  });

  return {
    shifts: formattedShifts,
  };
}
