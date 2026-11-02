import {
  AppError,
  TeamDetailsResponse,
  TransferOwnershipBody,
  TransferOwnershipResponse,
  UpdateTeamBody,
} from '@rota/shared';
import { verifyPassword } from '../../auth/password';
import { invalidatePermissionCache, invalidateTeamCache } from '../../auth/permissions';
import { dbShard0 } from '../../db';
import { dispatchOutboxEntry, writeOutbox } from '../../outbox/writer';

/**
 * Retrieves full details of a team (PRD 7.2).
 */
export async function getTeam(
  teamId: string,
  actorUserId: string,
  actorRole: 'OWNER' | 'MANAGER' | 'STAFF',
): Promise<TeamDetailsResponse> {
  void actorUserId;

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const team = await client.team.findUnique({
    where: { id: teamId },
  });

  if (!team || team.deletedAt) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const memberCount = await client.membership.count({
    where: { teamId, status: 'ACTIVE' },
  });

  return {
    id: team.id,
    name: team.name,
    timezone: team.timezone,
    shardIndex: team.shardIndex,
    weekStartsOn: team.weekStartsOn,
    ownerUserId: team.ownerUserId,
    role: actorRole,
    memberCount,
    createdAt: team.createdAt.toISOString(),
  };
}

/**
 * Updates team name and/or timezone (PRD 5.1, PRD 7.2).
 * Owner only.
 */
export async function updateTeam(
  teamId: string,
  actorUserId: string,
  body: UpdateTeamBody,
): Promise<TeamDetailsResponse> {
  void actorUserId;

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const existingTeam = await client.team.findUnique({
    where: { id: teamId },
  });

  if (!existingTeam || existingTeam.deletedAt) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const updatedTeam = await client.team.update({
    where: { id: teamId },
    data: {
      name: body.name ?? existingTeam.name,
      timezone: body.timezone ?? existingTeam.timezone,
    },
  });

  // If timezone was updated, invalidate team cache in Redis (PRD 7.3)
  if (body.timezone && body.timezone !== existingTeam.timezone) {
    await invalidateTeamCache(teamId);
  }

  const memberCount = await client.membership.count({
    where: { teamId, status: 'ACTIVE' },
  });

  return {
    id: updatedTeam.id,
    name: updatedTeam.name,
    timezone: updatedTeam.timezone,
    shardIndex: updatedTeam.shardIndex,
    weekStartsOn: updatedTeam.weekStartsOn,
    ownerUserId: updatedTeam.ownerUserId,
    role: 'OWNER',
    memberCount,
    createdAt: updatedTeam.createdAt.toISOString(),
  };
}

/**
 * Transfers ownership of a team to another active member (FR-13, PRD 7.2, L23, B-22, B-24).
 * Runs in one ordered transaction:
 * 1. Current owner membership becomes MANAGER
 * 2. Target membership becomes OWNER
 * 3. Team.ownerUserId becomes targetUserId
 * 4. Dispatches OWNERSHIP_TRANSFERRED notification
 * 5. Invalidates permission cache for both users
 */
export async function transferOwnership(
  teamId: string,
  actorUserId: string,
  body: TransferOwnershipBody,
): Promise<TransferOwnershipResponse> {
  if (body.targetUserId === actorUserId) {
    throw new AppError('VALIDATION_FAILED', 400, 'Cannot transfer ownership to yourself');
  }

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  // 1. Verify owner password with Argon2id (FR-13)
  const ownerUser = await client.user.findUnique({
    where: { id: actorUserId },
    select: { passwordHash: true },
  });

  if (!ownerUser) {
    throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
  }

  const isValidPassword = await verifyPassword(ownerUser.passwordHash, body.password);
  if (!isValidPassword) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid password');
  }

  // 2. Look up target membership; target must be an active member of this team (FR-13)
  const targetMembership = await client.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: body.targetUserId,
      },
    },
  });

  if (!targetMembership || targetMembership.status !== 'ACTIVE') {
    throw new AppError('NOT_FOUND', 404, 'Target member not found');
  }

  // 3. Look up owner membership
  const ownerMembership = await client.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: actorUserId,
      },
    },
  });

  if (!ownerMembership || ownerMembership.status !== 'ACTIVE' || ownerMembership.role !== 'OWNER') {
    throw new AppError('FORBIDDEN', 403, 'Only the current owner can transfer ownership');
  }

  const now = new Date();

  // 4. Ordered global transaction (L23, FR-13)
  const outboxEntry = await client.$transaction(async (tx) => {
    // Step 1: Current owner becomes MANAGER
    await tx.membership.update({
      where: { id: ownerMembership.id },
      data: { role: 'MANAGER' },
    });

    // Step 2: Target becomes OWNER
    await tx.membership.update({
      where: { id: targetMembership.id },
      data: { role: 'OWNER' },
    });

    // Step 3: Team ownerUserId updated
    await tx.team.update({
      where: { id: teamId },
      data: { ownerUserId: body.targetUserId },
    });

    // Step 4: Write outbox entry for OWNERSHIP_TRANSFERRED notification
    const sourceKey = `ownership-transferred:${teamId}:${body.targetUserId}:${now.toISOString()}`;
    const outbox = await writeOutbox(tx, {
      kind: 'notify.fanout',
      sourceKey,
      payload: {
        sourceKey,
        teamId,
        type: 'OWNERSHIP_TRANSFERRED',
      },
      teamId,
    });

    return outbox;
  });

  // 5. Post-commit: dispatch outbox and invalidate permission cache for both users
  await dispatchOutboxEntry(outboxEntry);
  await invalidatePermissionCache(actorUserId, teamId);
  await invalidatePermissionCache(body.targetUserId, teamId);

  return {
    ok: true,
    teamId,
    newOwnerUserId: body.targetUserId,
  };
}
