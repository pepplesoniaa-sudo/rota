import { logger } from '../../../lib/log';
import { dbShard0, getShardClient } from '../../../lib/db';
import { getTeamShardIndex } from '../../../lib/data/router';

export interface MaintenancePurgeTeamData {
  teamId: string;
}

/**
 * Handles maintenance.purge-team job (PRD 6.2, FR-14).
 * Triggered 30 days after team deletion.
 * - Deletes all shard rows for the team (shifts, swaps, availability blocks, activity events, team daily stats, member weekly stats).
 * - Deletes global memberships, invites, and settings for the team.
 * - Rule B-12 / L-26: Never deletes ledger entries or charges!
 */
export async function handleMaintenancePurgeTeam(
  data: MaintenancePurgeTeamData,
): Promise<{ purged: boolean }> {
  const { teamId } = data;
  logger.info({ teamId }, 'Processing maintenance.purge-team');

  try {
    // 1. Resolve team shard
    const shardIndex = await getTeamShardIndex(teamId);
    const shardClient = getShardClient(shardIndex);

    // 2. Delete all shard rows for the team
    await shardClient.$transaction(async (tx) => {
      await tx.activityEvent.deleteMany({ where: { teamId } });
      await tx.swapRequest.deleteMany({ where: { teamId } });
      await tx.shift.deleteMany({ where: { teamId } });
      await tx.availabilityBlock.deleteMany({ where: { teamId } });
      await tx.teamDailyStats.deleteMany({ where: { teamId } });
      await tx.memberWeeklyStats.deleteMany({ where: { teamId } });
      await tx.outbox.deleteMany({ where: { teamId } });
    });

    // 3. Delete global rows on dbShard0 (memberships, invites, outbox)
    // NOTE: Rule B-12 strictly preserves ledger entries, charges, and charge attempts
    await dbShard0.$transaction(async (tx) => {
      await tx.membership.deleteMany({ where: { teamId } });
      await tx.invite.deleteMany({ where: { teamId } });
      await tx.outbox.deleteMany({ where: { teamId } });
    });

    logger.info({ teamId }, 'Successfully purged team data');
    return { purged: true };
  } catch (err) {
    logger.error({ err, teamId }, 'PURGE_FAILED: Failed to purge team data');
    throw err;
  }
}
