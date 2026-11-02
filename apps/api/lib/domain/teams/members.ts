import { AppError, MemberListResponse, MemberResponse, UpdateMemberRoleBody } from '@rota/shared';
import { dbShard0, getShardClient } from '../../db';
import { computeShardIndex } from '../../data/router';
import { invalidatePermissionCache } from '../../auth/permissions';

/**
 * Returns all active members of a team (FR-11, PRD 7.2).
 */
export async function getTeamMembers(teamId: string): Promise<MemberListResponse> {
  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const members = await client.membership.findMany({
    where: {
      teamId,
      status: 'ACTIVE',
    },
    include: {
      user: {
        select: {
          displayName: true,
          email: true,
        },
      },
    },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
  });

  return {
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.displayName,
      email: m.user.email,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    })),
  };
}

/**
 * Updates a member's role (FR-11, PRD 7.2, B-23, B-24).
 * Owner only. Owner cannot update own role without transfer (409 OWNER_MUST_TRANSFER).
 */
export async function updateMemberRole(
  teamId: string,
  actorUserId: string,
  targetUserId: string,
  body: UpdateMemberRoleBody,
): Promise<MemberResponse> {
  if (targetUserId === actorUserId) {
    throw new AppError(
      'OWNER_MUST_TRANSFER',
      409,
      'Owner cannot change own role. Transfer ownership first.',
    );
  }

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const targetMembership = await client.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: targetUserId,
      },
    },
    include: {
      user: {
        select: {
          displayName: true,
          email: true,
        },
      },
    },
  });

  if (!targetMembership || targetMembership.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 404, 'Member not found');
  }

  if (targetMembership.role === 'OWNER') {
    throw new AppError(
      'OWNER_MUST_TRANSFER',
      409,
      'Owner cannot change own role. Transfer ownership first.',
    );
  }

  const updated = await client.membership.update({
    where: { id: targetMembership.id },
    data: { role: body.role },
    include: {
      user: {
        select: {
          displayName: true,
          email: true,
        },
      },
    },
  });

  // Invalidate Redis permission cache (FR-11, PRD 7.3)
  await invalidatePermissionCache(targetUserId, teamId);

  return {
    id: updated.id,
    userId: updated.userId,
    name: updated.user.displayName,
    email: updated.user.email,
    role: updated.role,
    joinedAt: updated.joinedAt.toISOString(),
  };
}

/**
 * Removes a member from a team (FR-12, PRD 7.2, B-23, B-24).
 * - Manager can remove STAFF only; Owner can remove MANAGER or STAFF.
 * - Owner cannot be removed (409 OWNER_MUST_TRANSFER).
 * - Cancels open swaps on future shifts on team shard.
 */
export async function removeMember(
  teamId: string,
  actorUserId: string,
  actorRole: 'OWNER' | 'MANAGER' | 'STAFF',
  targetUserId: string,
): Promise<{ ok: true }> {
  if (targetUserId === actorUserId && actorRole === 'OWNER') {
    throw new AppError(
      'OWNER_MUST_TRANSFER',
      409,
      'Owner cannot be removed. Transfer ownership first.',
    );
  }

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const targetMembership = await client.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: targetUserId,
      },
    },
  });

  if (!targetMembership || targetMembership.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 404, 'Member not found');
  }

  if (targetMembership.role === 'OWNER') {
    throw new AppError(
      'OWNER_MUST_TRANSFER',
      409,
      'Owner cannot be removed. Transfer ownership first.',
    );
  }

  // Role enforcement: Manager can remove STAFF only (B-23, FR-12)
  if (actorRole === 'MANAGER' && targetMembership.role !== 'STAFF') {
    throw new AppError('FORBIDDEN', 403, 'Managers can remove staff only');
  }

  const now = new Date();

  // 1. Mark membership REMOVED
  await client.membership.update({
    where: { id: targetMembership.id },
    data: {
      status: 'REMOVED',
      endedAt: now,
    },
  });

  // 2. Future shifts and open swaps cancellation on team shard (FR-12)
  const shardIndex = computeShardIndex(teamId);
  const shardClient = getShardClient(shardIndex);
  const primaryShard = (
    '$$typeof' in shardClient || !('$primary' in shardClient) ? shardClient : shardClient.$primary()
  ) as typeof shardClient;

  const futureShifts = await primaryShard.shift.findMany({
    where: {
      teamId,
      assigneeUserId: targetUserId,
      startsAt: { gt: now },
    },
    select: { id: true },
  });

  const futureShiftIds = futureShifts.map((s) => s.id);
  if (futureShiftIds.length > 0) {
    await primaryShard.swapRequest.updateMany({
      where: {
        teamId,
        status: { in: ['PENDING_PEER', 'PENDING_MANAGER'] },
        OR: [
          { requesterShiftId: { in: futureShiftIds } },
          { targetShiftId: { in: futureShiftIds } },
        ],
      },
      data: { status: 'CANCELED' },
    });
  }

  // Invalidate Redis permission cache (PRD 7.3)
  await invalidatePermissionCache(targetUserId, teamId);

  return { ok: true };
}

/**
 * Leaves a team (FR-12, PRD 7.2, B-24).
 * Owner cannot leave (409 OWNER_MUST_TRANSFER).
 */
export async function leaveTeam(
  teamId: string,
  actorUserId: string,
  actorRole: 'OWNER' | 'MANAGER' | 'STAFF',
): Promise<{ ok: true }> {
  if (actorRole === 'OWNER') {
    throw new AppError(
      'OWNER_MUST_TRANSFER',
      409,
      'Owner cannot leave the team. Transfer ownership first.',
    );
  }

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const membership = await client.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: actorUserId,
      },
    },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 404, 'Membership not found');
  }

  const now = new Date();

  await client.membership.update({
    where: { id: membership.id },
    data: {
      status: 'LEFT',
      endedAt: now,
    },
  });

  // Future shifts and open swaps cancellation on team shard (FR-12)
  const shardIndex = computeShardIndex(teamId);
  const shardClient = getShardClient(shardIndex);
  const primaryShard = (
    '$$typeof' in shardClient || !('$primary' in shardClient) ? shardClient : shardClient.$primary()
  ) as typeof shardClient;

  const futureShifts = await primaryShard.shift.findMany({
    where: {
      teamId,
      assigneeUserId: actorUserId,
      startsAt: { gt: now },
    },
    select: { id: true },
  });

  const futureShiftIds = futureShifts.map((s) => s.id);
  if (futureShiftIds.length > 0) {
    await primaryShard.swapRequest.updateMany({
      where: {
        teamId,
        status: { in: ['PENDING_PEER', 'PENDING_MANAGER'] },
        OR: [
          { requesterShiftId: { in: futureShiftIds } },
          { targetShiftId: { in: futureShiftIds } },
        ],
      },
      data: { status: 'CANCELED' },
    });
  }

  // Invalidate Redis permission cache (PRD 7.3)
  await invalidatePermissionCache(actorUserId, teamId);

  return { ok: true };
}
