import { AppError } from '@rota/shared';
import { dbShard0 } from '../db';
import { redis } from '../redis';

export type TeamRole = 'OWNER' | 'MANAGER' | 'STAFF';

/**
 * Validates that a user is an active member of the specified team and has one of the allowed roles.
 * - PRD 5.1 / B-18: Checks permission on every request using PRD 5.1 matrix.
 * - B-19 / FR-43: Non-members (or inactive members) receive 404 NOT_FOUND, identical to nonexistent team.
 * - PRD 7.3: Uses Redis cache perm:{userId}:{teamId} (TTL 60s), falls back to primary DB if unavailable.
 */
export async function checkTeamRole(
  userId: string,
  teamId: string,
  allowedRoles: TeamRole[],
): Promise<TeamRole> {
  const cacheKey = `perm:${userId}:${teamId}`;
  let cachedRole: string | null = null;
  try {
    cachedRole = await redis.get(cacheKey);
  } catch (err) {
    // Redis unavailable: fallback to primary DB lookup (PRD 7.3)
    void err;
  }

  if (cachedRole === 'NONE') {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  if (cachedRole === 'OWNER' || cachedRole === 'MANAGER' || cachedRole === 'STAFF') {
    if (!allowedRoles.includes(cachedRole)) {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }
    return cachedRole;
  }

  // Primary lookup (PRD 7.3)
  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const membership = await client.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
    select: {
      role: true,
      status: true,
    },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    try {
      await redis.set(cacheKey, 'NONE', 'EX', 60);
    } catch (err) {
      void err;
    }
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const role = membership.role as TeamRole;
  try {
    await redis.set(cacheKey, role, 'EX', 60);
  } catch (err) {
    void err;
  }

  if (!allowedRoles.includes(role)) {
    throw new AppError('FORBIDDEN', 403, 'Forbidden');
  }

  return role;
}

/**
 * Checks that a team is not in READ_ONLY status (PRD 5.1, B-14, FR-25).
 * When read-only, writes return 403 TEAM_READ_ONLY except for exempt endpoints.
 */
export async function checkTeamNotReadOnly(teamId: string): Promise<void> {
  const cacheKey = `team:${teamId}`;
  let cachedStatus: string | null = null;
  try {
    cachedStatus = await redis.get(cacheKey);
  } catch (err) {
    void err;
  }

  if (cachedStatus === 'READ_ONLY') {
    throw new AppError('TEAM_READ_ONLY', 403, 'Team is in read-only mode');
  }

  if (!cachedStatus) {
    const client = (
      '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
    ) as typeof dbShard0;

    const sub = await client.subscription.findUnique({
      where: { teamId },
      select: { status: true },
    });

    if (sub) {
      try {
        await redis.set(cacheKey, sub.status, 'EX', 300);
      } catch (err) {
        void err;
      }
      if (sub.status === 'READ_ONLY') {
        throw new AppError('TEAM_READ_ONLY', 403, 'Team is in read-only mode');
      }
    }
  }
}

/**
 * Invalidates Redis permission cache for a user in a team (PRD 7.3).
 */
export async function invalidatePermissionCache(userId: string, teamId: string): Promise<void> {
  try {
    await redis.del(`perm:${userId}:${teamId}`);
  } catch (err) {
    void err;
  }
}

/**
 * Invalidates Redis team status cache (PRD 7.3).
 */
export async function invalidateTeamCache(teamId: string): Promise<void> {
  try {
    await redis.del(`team:${teamId}`);
  } catch (err) {
    void err;
  }
}
