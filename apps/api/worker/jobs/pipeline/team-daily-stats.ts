import { DateTime } from 'luxon';
import { dbShard0, getShardClient } from '../../../lib/db';
import { getTeamShardIndex } from '../../../lib/data/router';
import { logger } from '../../../lib/log';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../queues';

export interface PipelineTeamDailyStatsData {
  teamId?: string;
  date?: string; // ISO date string YYYY-MM-DD
}

/**
 * Computes the team-local start day of the week containing the given date,
 * respecting team's weekStartsOn (1 = Monday, 7 = Sunday).
 */
export function getWeekStart(dt: DateTime, weekStartsOn: number): DateTime {
  // Luxon weekday: 1 = Monday, 7 = Sunday
  const currentWeekday = dt.weekday;
  const diffDays = (currentWeekday - weekStartsOn + 7) % 7;
  return dt.minus({ days: diffDays }).startOf('day');
}

/**
 * Handles pipeline.team-daily-stats job (PRD 6.2, FR-46).
 * Computes:
 * 1. TeamDailyStats row for team-local date (scheduledMinutes, shiftCount, swapsRequested, swapsApproved, swapsRejected, medianApprovalMinutes).
 * 2. MemberWeeklyStats rows for the week containing date (per-member weekly scheduledMinutes).
 * Executed on shard client.
 */
export async function handlePipelineTeamDailyStats(data: PipelineTeamDailyStatsData = {}): Promise<{
  success: boolean;
  dailyStatsId?: string;
  memberCount?: number;
  teamsProcessed?: number;
}> {
  // If no teamId provided, fan out for all active teams (cron trigger at 04:00 UTC per PRD 6.2)
  if (!data.teamId) {
    try {
      const teams = await dbShard0.team.findMany({
        where: { deletedAt: null },
        select: { id: true, timezone: true },
      });

      const pipelineQueue = getQueue('pipeline');
      for (const t of teams) {
        const yesterday = DateTime.now()
          .setZone(t.timezone)
          .minus({ days: 1 })
          .toFormat('yyyy-MM-dd');
        await pipelineQueue.add(
          'pipeline.team-daily-stats',
          { teamId: t.id, date: yesterday },
          {
            jobId: JobId.pipelineTeamDailyStats(t.id, yesterday),
            ...JOB_RETRY_POLICIES['pipeline.team-daily-stats'],
          },
        );
      }
      logger.info({ count: teams.length }, 'Fanned out pipeline.team-daily-stats for active teams');
      return { success: true, teamsProcessed: teams.length };
    } catch (err) {
      logger.error({ err }, 'Error fanning out pipeline.team-daily-stats');
      throw err;
    }
  }

  const { teamId, date } = data;
  if (!date) {
    logger.warn({ teamId }, 'Missing date for pipeline.team-daily-stats child job');
    return { success: false };
  }
  logger.info({ teamId, date }, 'Processing pipeline.team-daily-stats');

  try {
    // 1. Look up team timezone and weekStartsOn from dbShard0
    const team = await dbShard0.team.findUnique({
      where: { id: teamId },
      select: { id: true, timezone: true, weekStartsOn: true, shardIndex: true },
    });

    if (!team) {
      logger.warn({ teamId }, 'Team not found for pipeline.team-daily-stats');
      return { success: false };
    }

    const shardIndex = await getTeamShardIndex(teamId);
    const shardClient = getShardClient(shardIndex);

    // 2. Define team-local day boundaries in UTC
    const localDayStart = DateTime.fromISO(date, { zone: team.timezone }).startOf('day');
    const localDayEnd = DateTime.fromISO(date, { zone: team.timezone }).endOf('day');
    const dayStartUtc = localDayStart.toUTC().toJSDate();
    const dayEndUtc = localDayEnd.toUTC().toJSDate();

    // 3. Query shifts on that day
    const shifts = await shardClient.shift.findMany({
      where: {
        teamId,
        status: 'PUBLISHED',
        deletedAt: null,
        startsAt: {
          gte: dayStartUtc,
          lte: dayEndUtc,
        },
      },
      select: {
        startsAt: true,
        endsAt: true,
      },
    });

    const shiftCount = shifts.length;
    let scheduledMinutes = 0;
    for (const s of shifts) {
      const dur = Math.max(0, Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60000));
      scheduledMinutes += dur;
    }

    // 4. Query swap activity on that day
    const swapsRequested = await shardClient.swapRequest.count({
      where: {
        teamId,
        createdAt: {
          gte: dayStartUtc,
          lte: dayEndUtc,
        },
      },
    });

    const approvedSwaps = await shardClient.swapRequest.findMany({
      where: {
        teamId,
        status: 'APPROVED',
        decidedAt: {
          gte: dayStartUtc,
          lte: dayEndUtc,
        },
      },
      select: {
        createdAt: true,
        decidedAt: true,
      },
    });

    const swapsApproved = approvedSwaps.length;

    const swapsRejected = await shardClient.swapRequest.count({
      where: {
        teamId,
        status: 'REJECTED',
        decidedAt: {
          gte: dayStartUtc,
          lte: dayEndUtc,
        },
      },
    });

    // Calculate median approval minutes
    let medianApprovalMinutes: number | null = null;
    if (approvedSwaps.length > 0) {
      const approvalDurations: number[] = approvedSwaps
        .flatMap((s: { createdAt: Date; decidedAt: Date | null }) => {
          if (!s.decidedAt) return [];
          return [Math.max(0, Math.round((s.decidedAt.getTime() - s.createdAt.getTime()) / 60000))];
        })
        .sort((a: number, b: number) => a - b);

      if (approvalDurations.length > 0) {
        const mid = Math.floor(approvalDurations.length / 2);
        medianApprovalMinutes =
          approvalDurations.length % 2 !== 0
            ? (approvalDurations[mid] ?? null)
            : Math.round(((approvalDurations[mid - 1] ?? 0) + (approvalDurations[mid] ?? 0)) / 2);
      }
    }

    // Upsert TeamDailyStats (unique [teamId, date])
    const calendarDate = localDayStart.toJSDate();
    const dailyStats = await shardClient.teamDailyStats.upsert({
      where: {
        teamId_date: {
          teamId,
          date: calendarDate,
        },
      },
      create: {
        teamId,
        date: calendarDate,
        scheduledMinutes,
        shiftCount,
        swapsRequested,
        swapsApproved,
        swapsRejected,
        medianApprovalMinutes,
      },
      update: {
        scheduledMinutes,
        shiftCount,
        swapsRequested,
        swapsApproved,
        swapsRejected,
        medianApprovalMinutes,
        computedAt: new Date(),
      },
    });

    // 5. Compute MemberWeeklyStats for the week containing this date
    const weekStartDt = getWeekStart(localDayStart, team.weekStartsOn ?? 1);
    const weekEndDt = weekStartDt.plus({ days: 7 }).minus({ milliseconds: 1 });
    const weekStartUtc = weekStartDt.toUTC().toJSDate();
    const weekEndUtc = weekEndDt.toUTC().toJSDate();

    const weekShifts = await shardClient.shift.findMany({
      where: {
        teamId,
        status: 'PUBLISHED',
        deletedAt: null,
        startsAt: {
          gte: weekStartUtc,
          lte: weekEndUtc,
        },
      },
      select: {
        assigneeUserId: true,
        startsAt: true,
        endsAt: true,
      },
    });

    // Aggregate minutes per member
    const memberMinutesMap = new Map<string, number>();
    for (const ws of weekShifts) {
      const dur = Math.max(0, Math.round((ws.endsAt.getTime() - ws.startsAt.getTime()) / 60000));
      memberMinutesMap.set(ws.assigneeUserId, (memberMinutesMap.get(ws.assigneeUserId) ?? 0) + dur);
    }

    const weekStartDate = weekStartDt.toJSDate();
    for (const [userId, memberMinutes] of memberMinutesMap.entries()) {
      await shardClient.memberWeeklyStats.upsert({
        where: {
          teamId_userId_weekStart: {
            teamId,
            userId,
            weekStart: weekStartDate,
          },
        },
        create: {
          teamId,
          userId,
          weekStart: weekStartDate,
          scheduledMinutes: memberMinutes,
        },
        update: {
          scheduledMinutes: memberMinutes,
          computedAt: new Date(),
        },
      });
    }

    logger.info(
      { teamId, date, dailyStatsId: dailyStats.id, membersUpdated: memberMinutesMap.size },
      'Successfully computed pipeline.team-daily-stats',
    );

    return {
      success: true,
      dailyStatsId: dailyStats.id,
      memberCount: memberMinutesMap.size,
    };
  } catch (err) {
    logger.error({ err, teamId, date }, 'Error processing pipeline.team-daily-stats');
    throw err;
  }
}
