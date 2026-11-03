import { createHash } from 'node:crypto';
import { Prisma, NotificationType } from '@prisma/client';
import { AppError, ERROR_CODES } from '@rota/shared';
import { dbShard0, getShardClient } from '../db';
import { logger } from '../log';
import { redis } from '../redis';
import { getRequestContext, getTenantScope } from './scope';

/**
 * Computes deterministic shard index (0 or 1) for a new team ID.
 * PRD 7.6: shardIndex(teamId) = parseInt(sha256(teamId).slice(0, 8), 16) % 2
 */
export function computeShardIndex(teamId: string): number {
  const hash = createHash('sha256').update(teamId).digest('hex');
  return parseInt(hash.slice(0, 8), 16) % 2;
}

/**
 * Resolves the shard index for an existing team using Redis cache (300s)
 * or Shard 0 (global directory), falling back to computeShardIndex for new teams.
 */
export async function getTeamShardIndex(teamId: string): Promise<number> {
  try {
    const cached = await redis.get(`team:${teamId}`);
    if (cached) {
      const parsed = JSON.parse(cached) as { shardIndex?: number };
      if (typeof parsed.shardIndex === 'number') {
        return parsed.shardIndex;
      }
    }
  } catch (err) {
    logger.debug({ err, teamId }, 'Redis read error when checking team shard index');
  }

  try {
    const team = await dbShard0.team.findUnique({
      where: { id: teamId },
      select: { shardIndex: true },
    });

    if (team) {
      try {
        await redis.set(
          `team:${teamId}`,
          JSON.stringify({ shardIndex: team.shardIndex }),
          'EX',
          300,
        );
      } catch {
        // Cache write failure is non-fatal
      }
      return team.shardIndex;
    }
  } catch (err) {
    logger.warn({ err, teamId }, 'Error looking up team shardIndex in dbShard0');
  }

  // Fallback for new teams prior to insertion
  return computeShardIndex(teamId);
}

/**
 * Determines whether read requests should route to the primary database.
 * PRD 7.5 / AGENTS.md A-9:
 * 1. Explicit header X-Read-Primary: 1
 * 2. Active RYOW marker for user (ryow:{userId} set for 5s after write)
 * 3. Replica lag > 2,000ms or missing (until lag drops below 1,000ms)
 * 4. Redis unreachable (fail-safe to primary)
 */
export async function shouldReadPrimary(options: {
  shardIndex?: number;
  userId?: string;
  headerFlag?: boolean;
}): Promise<boolean> {
  if (options.headerFlag) {
    return true;
  }

  try {
    if (options.userId) {
      const ryow = await redis.exists(`ryow:${options.userId}`);
      if (ryow === 1) {
        return true;
      }
    }

    if (options.shardIndex !== undefined) {
      const lagStr = await redis.get(`replica:lag:${options.shardIndex}`);
      if (lagStr === null) {
        // Missing lag metric -> fail safe to primary
        return true;
      }
      const lagMs = parseInt(lagStr, 10);
      if (Number.isNaN(lagMs) || lagMs > 2000) {
        return true;
      }
    }

    return false;
  } catch (err) {
    logger.warn(
      { err },
      'Redis unreachable when evaluating replica routing; failing safe to primary',
    );
    return true;
  }
}

/**
 * Marks that a user has executed a write, setting the RYOW marker in Redis for 5 seconds.
 * PRD 7.5: SET ryow:{U} 1 EX 5
 */
export async function markUserWrite(userId: string): Promise<void> {
  try {
    await redis.set(`ryow:${userId}`, '1', 'EX', 5);
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to set ryow key in Redis');
  }
}

/**
 * Returns Shard 0 (global) database client routed according to current request context.
 */
export function getGlobalDb() {
  const reqContext = getRequestContext();
  if (reqContext?.readPrimary) {
    return dbShard0.$primary();
  }
  return dbShard0;
}

/**
 * Returns shard database client for a specific shard index, routed to primary if flagged.
 */
export function getShardDb(shardIndex: number) {
  const client = getShardClient(shardIndex);
  const reqContext = getRequestContext();
  if (reqContext?.readPrimary) {
    return client.$primary();
  }
  return client;
}

/**
 * Returns shard database client for a team, resolving shardIndex first.
 */
export async function getShardDbForTeam(teamId: string) {
  const shardIndex = await getTeamShardIndex(teamId);
  return getShardDb(shardIndex);
}

/**
 * Executes raw SQL scoped to a team on its target shard.
 * PRD 7.10 / AGENTS.md B-21:
 * Run raw SQL only through teamQuery(teamId, sql) with a team_id = $1 parameter.
 */
export async function teamQuery<T = unknown>(teamId: string, query: Prisma.Sql): Promise<T> {
  const scope = getTenantScope();
  const reqContext = getRequestContext();
  const requestId = reqContext?.requestId ?? 'unknown';

  if (!scope) {
    logger.error({ requestId, teamId }, 'teamQuery called without tenant scope');
    throw new AppError(
      ERROR_CODES.TENANT_SCOPE_MISSING,
      500,
      'Raw SQL teamQuery must run within a tenant scope',
    );
  }

  if (scope.type === 'team') {
    if (scope.teamId !== teamId) {
      logger.error(
        { requestId, scopeTeamId: scope.teamId, targetTeamId: teamId },
        'teamQuery teamId mismatch',
      );
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        500,
        'Query teamId does not match tenant scope',
      );
    }
  } else if (scope.type === 'user') {
    if (!scope.teamIds.includes(teamId)) {
      logger.error(
        { requestId, userTeamIds: scope.teamIds, targetTeamId: teamId },
        'teamQuery teamId mismatch for user',
      );
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        500,
        'Query teamId is not in user active teams',
      );
    }
  } else if (scope.type === 'system') {
    logger.info({ requestId, jobId: scope.jobId, teamId }, 'Executing teamQuery in system scope');
  }

  const client = await getShardDbForTeam(teamId);
  return client.$queryRaw<T>(query);
}

export interface LockedDueNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  teamId?: string | null;
}

/**
 * Queries and locks due SCHEDULED notifications for a recipient using FOR UPDATE SKIP LOCKED.
 * PRD 6.2: Runs in system scope.
 */
export async function lockDueNotifications(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
): Promise<LockedDueNotification[]> {
  const rows = (await tx.$queryRaw`
    SELECT id, type, title, body, team_id AS "teamId"
    FROM notification
    WHERE user_id = ${userId}::uuid
      AND status = 'SCHEDULED'
      AND scheduled_for <= ${now}
    ORDER BY scheduled_for ASC
    FOR UPDATE SKIP LOCKED
  `) as LockedDueNotification[];
  return rows;
}
