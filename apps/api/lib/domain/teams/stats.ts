import { DateTime } from 'luxon';
import { dbShard0, getShardClient } from '../../db';
import { getTeamShardIndex } from '../../data/router';
import { StatsQuery, StatsResponse } from '@rota/shared';

/**
 * Returns team daily stats and member weekly scheduled hours (FR-46, PRD 7.2).
 * Accessible by Manager+.
 */
export async function getTeamStats(teamId: string, query: StatsQuery = {}): Promise<StatsResponse> {
  const days = query.days ?? 28;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId },
    select: { timezone: true, weekStartsOn: true },
  });

  const timezone = team?.timezone ?? 'UTC';
  const shardIndex = await getTeamShardIndex(teamId);
  const shardClient = getShardClient(shardIndex);

  const localNow = DateTime.now().setZone(timezone);
  const sinceDate = localNow.minus({ days }).startOf('day').toJSDate();

  // 1. Fetch daily stats for the last N days
  const dailyRows = await shardClient.teamDailyStats.findMany({
    where: {
      teamId,
      date: { gte: sinceDate },
    },
    orderBy: { date: 'asc' },
  });

  const dailyStats = dailyRows.map((r) => ({
    date: DateTime.fromJSDate(r.date, { zone: 'utc' }).toFormat('yyyy-MM-dd'),
    scheduledMinutes: r.scheduledMinutes,
    scheduledHours: Math.round((r.scheduledMinutes / 60) * 10) / 10,
    shiftCount: r.shiftCount,
    swapsRequested: r.swapsRequested,
    swapsApproved: r.swapsApproved,
    swapsRejected: r.swapsRejected,
    medianApprovalMinutes: r.medianApprovalMinutes,
  }));

  // 2. Fetch member weekly stats
  const weeklyRows = await shardClient.memberWeeklyStats.findMany({
    where: {
      teamId,
      weekStart: { gte: sinceDate },
    },
    orderBy: [{ weekStart: 'asc' }, { scheduledMinutes: 'desc' }],
  });

  const memberWeeklyStats = weeklyRows.map((w) => ({
    userId: w.userId,
    weekStart: DateTime.fromJSDate(w.weekStart, { zone: 'utc' }).toFormat('yyyy-MM-dd'),
    scheduledMinutes: w.scheduledMinutes,
    scheduledHours: Math.round((w.scheduledMinutes / 60) * 10) / 10,
    overFortyHours: w.scheduledMinutes > 2400, // 40 hours = 2400 min
  }));

  return {
    dailyStats,
    memberWeeklyStats,
  };
}
