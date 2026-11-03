import {
  AppError,
  DeleteTeamBody,
  DeleteTeamResponse,
  TeamDetailsResponse,
  TransferOwnershipBody,
  TransferOwnershipResponse,
  UpdateTeamBody,
} from '@rota/shared';
import { verifyPassword } from '../../auth/password';
import { invalidatePermissionCache, invalidateTeamCache } from '../../auth/permissions';
import { dbShard0 } from '../../db';
import { dispatchOutboxEntry, writeOutbox } from '../../outbox/writer';
import { JobId } from '../../../worker/queues';

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

/**
 * Deletes a team (FR-14, PRD 7.2).
 * Owner only. Must confirm by typing the exact team name.
 * - Team is marked deleted (deletedAt set).
 * - All members lose access immediately (memberships set to INACTIVE).
 * - Subscription is canceled with no refund (FR-14, PRD 1835).
 * - Pending invites are revoked.
 * - Outbox entry and delayed maintenance.purge-team job created for 30 days later.
 * - Works while the team is read-only (B-14 exception, L55).
 */
export async function deleteTeam(
  teamId: string,
  actorUserId: string,
  body: DeleteTeamBody,
): Promise<DeleteTeamResponse> {
  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const team = await client.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, ownerUserId: true, deletedAt: true },
  });

  if (!team || team.deletedAt) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  if (team.ownerUserId !== actorUserId) {
    throw new AppError('FORBIDDEN', 403, 'Only the team owner can delete the team');
  }

  if (body.teamName !== team.name) {
    throw new AppError('VALIDATION_FAILED', 400, 'Team name does not match');
  }

  // Load active members for permission cache invalidation
  const activeMembers = await client.membership.findMany({
    where: { teamId, status: 'ACTIVE' },
    select: { userId: true },
  });

  const now = new Date();

  const outboxEntry = await client.$transaction(async (tx) => {
    // 1. Mark team deleted
    await tx.team.update({
      where: { id: teamId },
      data: { deletedAt: now },
    });

    // 2. Cancel subscription with no refund (FR-14, PRD 1835)
    await tx.subscription.updateMany({
      where: { teamId },
      data: { status: 'CANCELED' },
    });

    // 3. Mark all active memberships REMOVED so access is lost immediately (FR-14)
    await tx.membership.updateMany({
      where: { teamId, status: 'ACTIVE' },
      data: { status: 'REMOVED' },
    });

    // 4. Revoke any pending invites
    await tx.invite.updateMany({
      where: { teamId, revokedAt: null, acceptedAt: null },
      data: { revokedAt: now },
    });

    // 5. Write Outbox entry for maintenance.purge-team
    const outbox = await writeOutbox(tx, {
      kind: 'maintenance.purge-team',
      sourceKey: JobId.maintenancePurgeTeam(teamId),
      payload: { teamId },
      teamId,
    });

    return outbox;
  });

  // Post-commit: dispatch outbox and invalidate caches
  await dispatchOutboxEntry(outboxEntry);
  await invalidateTeamCache(teamId);
  for (const m of activeMembers) {
    await invalidatePermissionCache(m.userId, teamId);
  }

  return { ok: true, teamId };
}
