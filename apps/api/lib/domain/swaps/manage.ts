import { DateTime } from 'luxon';
import {
  AppError,
  CreateSwapBody,
  ShiftItem,
  SwapActionBody,
  SwapDecisionBody,
  SwapItem,
  SwapListQuery,
  SwapListResponse,
  SwapResponse,
} from '@rota/shared';
import { dbShard0, getShardClient } from '../../db';
import { getTeamShardIndex } from '../../data/router';
import { dispatchOutboxEntry, OutboxEntry, writeOutbox } from '../../outbox/writer';
import { logger } from '../../log';

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

interface DbSwap {
  id: string;
  teamId: string;
  type: 'TRADE' | 'GIVEAWAY';
  status:
    | 'PENDING_PEER'
    | 'PENDING_MANAGER'
    | 'APPROVED'
    | 'REJECTED'
    | 'DECLINED'
    | 'CANCELED'
    | 'EXPIRED';
  requesterUserId: string;
  requesterShiftId: string;
  requesterShiftVersion: number;
  targetUserId: string;
  targetShiftId: string | null;
  targetShiftVersion: number | null;
  message: string | null;
  peerRespondedAt: Date | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  expiresAt: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  requesterShift?: DbShift;
  targetShift?: DbShift | null;
}

function formatShift(shift: DbShift, timezone: string): ShiftItem {
  return {
    id: shift.id,
    teamId: shift.teamId,
    assigneeUserId: shift.assigneeUserId,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    startsLocal: DateTime.fromJSDate(shift.startsAt, { zone: 'utc' })
      .setZone(timezone)
      .toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    endsLocal: DateTime.fromJSDate(shift.endsAt, { zone: 'utc' })
      .setZone(timezone)
      .toFormat("yyyy-MM-dd'T'HH:mm:ss"),
    position: shift.position,
    location: shift.location,
    notes: shift.notes,
    status: shift.status,
    publishedAt: shift.publishedAt ? shift.publishedAt.toISOString() : null,
    version: shift.version,
    createdByUserId: shift.createdByUserId,
    createdAt: shift.createdAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString(),
  };
}

function formatSwap(swap: DbSwap, timezone?: string): SwapItem {
  return {
    id: swap.id,
    teamId: swap.teamId,
    type: swap.type,
    status: swap.status,
    requesterUserId: swap.requesterUserId,
    requesterShiftId: swap.requesterShiftId,
    requesterShiftVersion: swap.requesterShiftVersion,
    targetUserId: swap.targetUserId,
    targetShiftId: swap.targetShiftId,
    targetShiftVersion: swap.targetShiftVersion,
    message: swap.message,
    peerRespondedAt: swap.peerRespondedAt ? swap.peerRespondedAt.toISOString() : null,
    decidedByUserId: swap.decidedByUserId,
    decidedAt: swap.decidedAt ? swap.decidedAt.toISOString() : null,
    decisionNote: swap.decisionNote,
    expiresAt: swap.expiresAt.toISOString(),
    version: swap.version,
    createdAt: swap.createdAt.toISOString(),
    updatedAt: swap.updatedAt.toISOString(),
    ...(swap.requesterShift && timezone
      ? { requesterShift: formatShift(swap.requesterShift, timezone) }
      : {}),
    ...(swap.targetShift && timezone
      ? { targetShift: formatShift(swap.targetShift, timezone) }
      : swap.targetShiftId === null
        ? { targetShift: null }
        : {}),
  };
}

/**
 * Creates a swap request for a shift (FR-21, FR-24, PRD 7.2).
 */
export async function createSwapRequest(params: {
  teamId: string;
  requesterUserId: string;
  body: CreateSwapBody;
}): Promise<SwapResponse> {
  const { teamId, requesterUserId, body } = params;

  if (requesterUserId === body.targetUserId) {
    throw new AppError('VALIDATION_FAILED', 400, 'Cannot request a swap with yourself');
  }

  // 1. Verify team on Shard 0
  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  // 2. Verify target user is an active member of this team
  const targetMember = await dbShard0.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: body.targetUserId,
      },
    },
    select: { status: true },
  });

  if (!targetMember || targetMember.status !== 'ACTIVE') {
    throw new AppError(
      'VALIDATION_FAILED',
      400,
      'Target user is not an active member of this team',
    );
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  // 3. Fetch shifts from shard
  const shiftIds = [body.requesterShiftId];
  if (body.targetShiftId) {
    shiftIds.push(body.targetShiftId);
  }

  const shifts = (await shardClient.shift.findMany({
    where: {
      teamId,
      id: { in: shiftIds },
      deletedAt: null,
    },
  })) as DbShift[];

  const reqShift = shifts.find((s) => s.id === body.requesterShiftId);
  if (!reqShift) {
    throw new AppError('NOT_FOUND', 404, 'Requester shift not found');
  }
  if (reqShift.assigneeUserId !== requesterUserId) {
    throw new AppError('FORBIDDEN', 403, 'You do not own this shift');
  }
  if (reqShift.status !== 'PUBLISHED') {
    throw new AppError('VALIDATION_FAILED', 400, 'Draft shifts cannot be swapped');
  }

  const twoHoursFromNow = Date.now() + 2 * 60 * 60 * 1000;
  if (reqShift.startsAt.getTime() < twoHoursFromNow) {
    throw new AppError('SWAP_TOO_LATE', 409, 'Cannot swap a shift that starts in under 2 hours');
  }

  let tgtShift: DbShift | undefined;
  if (body.targetShiftId) {
    tgtShift = shifts.find((s) => s.id === body.targetShiftId);
    if (!tgtShift) {
      throw new AppError('NOT_FOUND', 404, 'Target shift not found');
    }
    if (tgtShift.assigneeUserId !== body.targetUserId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Target shift does not belong to target user');
    }
    if (tgtShift.status !== 'PUBLISHED') {
      throw new AppError('VALIDATION_FAILED', 400, 'Draft shifts cannot be swapped');
    }
    if (tgtShift.startsAt.getTime() < twoHoursFromNow) {
      throw new AppError('SWAP_TOO_LATE', 409, 'Target shift starts in under 2 hours');
    }
  }

  // 4. Check for already open swap on requester shift (or target shift)
  const openSwap = await shardClient.swapRequest.findFirst({
    where: {
      teamId,
      status: { in: ['PENDING_PEER', 'PENDING_MANAGER'] },
      OR: [
        { requesterShiftId: reqShift.id },
        { targetShiftId: reqShift.id },
        ...(tgtShift ? [{ requesterShiftId: tgtShift.id }, { targetShiftId: tgtShift.id }] : []),
      ],
    },
  });

  if (openSwap) {
    throw new AppError('SWAP_ALREADY_OPEN', 409, 'Shift already has an open swap request');
  }

  // 5. Overlap check (FR-24)
  // Target user receives reqShift: check if target user has any other shift overlapping reqShift
  const targetOverlap = await shardClient.shift.findFirst({
    where: {
      teamId,
      assigneeUserId: body.targetUserId,
      deletedAt: null,
      id: tgtShift ? { not: tgtShift.id } : undefined,
      startsAt: { lt: reqShift.endsAt },
      endsAt: { gt: reqShift.startsAt },
    },
    select: { id: true },
  });

  if (targetOverlap) {
    throw new AppError('SWAP_OVERLAP', 409, 'Target user has an overlapping shift');
  }

  // If trade, requester user receives tgtShift: check if requester has any other shift overlapping tgtShift
  if (tgtShift) {
    const reqOverlap = await shardClient.shift.findFirst({
      where: {
        teamId,
        assigneeUserId: requesterUserId,
        deletedAt: null,
        id: { not: reqShift.id },
        startsAt: { lt: tgtShift.endsAt },
        endsAt: { gt: tgtShift.startsAt },
      },
      select: { id: true },
    });

    if (reqOverlap) {
      throw new AppError('SWAP_OVERLAP', 409, 'Requester user has an overlapping shift');
    }
  }

  // 6. Expiry: 72 hours from now or shift start, whichever is sooner (FR-25)
  const maxExpiry = Date.now() + 72 * 60 * 60 * 1000;
  const shiftStartExpiry = Math.min(
    reqShift.startsAt.getTime(),
    tgtShift ? tgtShift.startsAt.getTime() : Infinity,
  );
  const expiresAt = new Date(Math.min(maxExpiry, shiftStartExpiry));

  // 7. Shard transaction to write swap and notify.fanout outbox entry
  const result = await shardClient.$transaction(async (tx) => {
    const swap = (await tx.swapRequest.create({
      data: {
        teamId,
        type: tgtShift ? 'TRADE' : 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId,
        requesterShiftId: reqShift.id,
        requesterShiftVersion: reqShift.version,
        targetUserId: body.targetUserId,
        targetShiftId: tgtShift ? tgtShift.id : null,
        targetShiftVersion: tgtShift ? tgtShift.version : null,
        message: body.message ?? null,
        expiresAt,
        version: 1,
      },
    })) as DbSwap;

    const outboxEntry = await writeOutbox(tx, {
      kind: 'notify.fanout',
      sourceKey: `swap:${swap.id}:REQUESTED`,
      teamId,
      payload: {
        sourceKey: `swap:${swap.id}:REQUESTED`,
        teamId,
        type: 'SWAP_REQUESTED',
      },
    });

    return { swap, outboxEntry };
  });

  if (result.outboxEntry) {
    try {
      await dispatchOutboxEntry(result.outboxEntry as OutboxEntry);
    } catch (err) {
      logger.warn({ err }, 'Failed to dispatch swap notification immediately');
    }
  }

  return {
    swap: formatSwap(result.swap, team.timezone),
  };
}

/**
 * Coworker accepts a swap request (FR-22, FR-24).
 */
export async function acceptSwap(params: {
  teamId: string;
  swapId: string;
  userId: string;
  body: SwapActionBody;
}): Promise<SwapResponse> {
  const { teamId, swapId, userId } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const swap = (await shardClient.swapRequest.findUnique({
    where: { id: swapId },
  })) as DbSwap | null;

  if (!swap || swap.teamId !== teamId) {
    throw new AppError('NOT_FOUND', 404, 'Swap request not found');
  }

  if (swap.targetUserId !== userId) {
    throw new AppError('FORBIDDEN', 403, 'Only the target coworker can accept this swap');
  }

  if (swap.status !== 'PENDING_PEER') {
    throw new AppError(
      'SWAP_ALREADY_DECIDED',
      409,
      'Swap request is no longer pending coworker acceptance',
    );
  }

  // Fetch shifts
  const shiftIds = [swap.requesterShiftId];
  if (swap.targetShiftId) {
    shiftIds.push(swap.targetShiftId);
  }
  const shifts = (await shardClient.shift.findMany({
    where: { teamId, id: { in: shiftIds }, deletedAt: null },
  })) as DbShift[];

  const reqShift = shifts.find((s) => s.id === swap.requesterShiftId);
  if (!reqShift || reqShift.startsAt.getTime() <= Date.now()) {
    throw new AppError('SWAP_TOO_LATE', 409, 'Requester shift has already started');
  }

  const tgtShift = swap.targetShiftId ? shifts.find((s) => s.id === swap.targetShiftId) : undefined;

  // Stale check
  if (
    reqShift.version !== swap.requesterShiftVersion ||
    (swap.targetShiftId && tgtShift && tgtShift.version !== swap.targetShiftVersion)
  ) {
    await shardClient.swapRequest.update({
      where: { id: swapId },
      data: { status: 'CANCELED', version: { increment: 1 } },
    });
    throw new AppError(
      'SWAP_STALE',
      409,
      'Shifts have been modified since swap was created; swap cancelled',
    );
  }

  // Overlap check (FR-24)
  const targetOverlap = await shardClient.shift.findFirst({
    where: {
      teamId,
      assigneeUserId: swap.targetUserId,
      deletedAt: null,
      id: tgtShift ? { not: tgtShift.id } : undefined,
      startsAt: { lt: reqShift.endsAt },
      endsAt: { gt: reqShift.startsAt },
    },
  });
  if (targetOverlap) {
    throw new AppError(
      'SWAP_OVERLAP',
      409,
      'Accepting this swap would create an overlapping shift',
    );
  }

  if (tgtShift) {
    const reqOverlap = await shardClient.shift.findFirst({
      where: {
        teamId,
        assigneeUserId: swap.requesterUserId,
        deletedAt: null,
        id: { not: reqShift.id },
        startsAt: { lt: tgtShift.endsAt },
        endsAt: { gt: tgtShift.startsAt },
      },
    });
    if (reqOverlap) {
      throw new AppError(
        'SWAP_OVERLAP',
        409,
        'Accepting this swap would create an overlapping shift',
      );
    }
  }

  const result = await shardClient.$transaction(async (tx) => {
    const updatedSwap = (await tx.swapRequest.update({
      where: { id: swapId },
      data: {
        status: 'PENDING_MANAGER',
        peerRespondedAt: new Date(),
        version: { increment: 1 },
      },
    })) as DbSwap;

    const outboxEntry = await writeOutbox(tx, {
      kind: 'notify.fanout',
      sourceKey: `swap:${updatedSwap.id}:ACCEPTED`,
      teamId,
      payload: {
        sourceKey: `swap:${updatedSwap.id}:ACCEPTED`,
        teamId,
        type: 'SWAP_ACCEPTED',
      },
    });

    return { swap: updatedSwap, outboxEntry };
  });

  if (result.outboxEntry) {
    try {
      await dispatchOutboxEntry(result.outboxEntry as OutboxEntry);
    } catch (err) {
      logger.warn({ err }, 'Failed to dispatch swap acceptance notification');
    }
  }

  return {
    swap: formatSwap(result.swap, team.timezone),
  };
}

/**
 * Coworker declines a swap request (FR-22).
 */
export async function declineSwap(params: {
  teamId: string;
  swapId: string;
  userId: string;
  body: SwapActionBody;
}): Promise<SwapResponse> {
  const { teamId, swapId, userId } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const swap = (await shardClient.swapRequest.findUnique({
    where: { id: swapId },
  })) as DbSwap | null;

  if (!swap || swap.teamId !== teamId) {
    throw new AppError('NOT_FOUND', 404, 'Swap request not found');
  }

  if (swap.targetUserId !== userId) {
    throw new AppError('FORBIDDEN', 403, 'Only the target coworker can decline this swap');
  }

  if (swap.status !== 'PENDING_PEER') {
    throw new AppError(
      'SWAP_ALREADY_DECIDED',
      409,
      'Swap request is no longer pending coworker acceptance',
    );
  }

  const result = await shardClient.$transaction(async (tx) => {
    const updatedSwap = (await tx.swapRequest.update({
      where: { id: swapId },
      data: {
        status: 'DECLINED',
        peerRespondedAt: new Date(),
        version: { increment: 1 },
      },
    })) as DbSwap;

    const outboxEntry = await writeOutbox(tx, {
      kind: 'notify.fanout',
      sourceKey: `swap:${updatedSwap.id}:DECLINED`,
      teamId,
      payload: {
        sourceKey: `swap:${updatedSwap.id}:DECLINED`,
        teamId,
        type: 'SWAP_DECLINED',
      },
    });

    return { swap: updatedSwap, outboxEntry };
  });

  if (result.outboxEntry) {
    try {
      await dispatchOutboxEntry(result.outboxEntry as OutboxEntry);
    } catch (err) {
      logger.warn({ err }, 'Failed to dispatch swap decline notification');
    }
  }

  return {
    swap: formatSwap(result.swap, team.timezone),
  };
}

/**
 * Requester cancels a swap request (FR-25).
 */
export async function cancelSwap(params: {
  teamId: string;
  swapId: string;
  userId: string;
  body: SwapActionBody;
}): Promise<SwapResponse> {
  const { teamId, swapId, userId } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const swap = (await shardClient.swapRequest.findUnique({
    where: { id: swapId },
  })) as DbSwap | null;

  if (!swap || swap.teamId !== teamId) {
    throw new AppError('NOT_FOUND', 404, 'Swap request not found');
  }

  if (swap.requesterUserId !== userId) {
    throw new AppError('FORBIDDEN', 403, 'Only the swap requester can cancel this swap');
  }

  if (swap.status !== 'PENDING_PEER' && swap.status !== 'PENDING_MANAGER') {
    throw new AppError('SWAP_ALREADY_DECIDED', 409, 'Swap cannot be cancelled in current status');
  }

  const result = await shardClient.$transaction(async (tx) => {
    const updatedSwap = (await tx.swapRequest.update({
      where: { id: swapId },
      data: {
        status: 'CANCELED',
        version: { increment: 1 },
      },
    })) as DbSwap;

    const outboxEntry = await writeOutbox(tx, {
      kind: 'notify.fanout',
      sourceKey: `swap:${updatedSwap.id}:CANCELED`,
      teamId,
      payload: {
        sourceKey: `swap:${updatedSwap.id}:CANCELED`,
        teamId,
        type: 'SWAP_CANCELED',
      },
    });

    return { swap: updatedSwap, outboxEntry };
  });

  if (result.outboxEntry) {
    try {
      await dispatchOutboxEntry(result.outboxEntry as OutboxEntry);
    } catch (err) {
      logger.warn({ err }, 'Failed to dispatch swap cancellation notification');
    }
  }

  return {
    swap: formatSwap(result.swap, team.timezone),
  };
}

/**
 * Manager or Owner approves a swap request (FR-23, FR-24).
 * - Managers cannot approve swaps they are a party to (403 SWAP_SELF_DECISION).
 * - Owner may approve any swap including their own (selfApproved: true in feed event).
 * - Runs SET CONSTRAINTS shift_no_overlap DEFERRED before reassigning shifts.
 */
export async function approveSwap(params: {
  teamId: string;
  swapId: string;
  managerUserId: string;
  managerRole: 'OWNER' | 'MANAGER';
  body: SwapDecisionBody;
}): Promise<SwapResponse> {
  const { teamId, swapId, managerUserId, managerRole, body } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const swap = (await shardClient.swapRequest.findUnique({
    where: { id: swapId },
  })) as DbSwap | null;

  if (!swap || swap.teamId !== teamId) {
    throw new AppError('NOT_FOUND', 404, 'Swap request not found');
  }

  // Self-decision check (FR-23)
  if (
    managerRole === 'MANAGER' &&
    (managerUserId === swap.requesterUserId || managerUserId === swap.targetUserId)
  ) {
    throw new AppError(
      'SWAP_SELF_DECISION',
      403,
      'Managers cannot decide swaps they are involved in',
    );
  }

  if (swap.status !== 'PENDING_MANAGER') {
    throw new AppError(
      'SWAP_ALREADY_DECIDED',
      409,
      'Swap request is no longer pending manager decision',
    );
  }

  // Fetch shifts
  const shiftIds = [swap.requesterShiftId];
  if (swap.targetShiftId) {
    shiftIds.push(swap.targetShiftId);
  }
  const shifts = (await shardClient.shift.findMany({
    where: { teamId, id: { in: shiftIds }, deletedAt: null },
  })) as DbShift[];

  const reqShift = shifts.find((s) => s.id === swap.requesterShiftId);
  if (!reqShift || reqShift.startsAt.getTime() <= Date.now()) {
    throw new AppError('SWAP_TOO_LATE', 409, 'Requester shift has already started');
  }

  const tgtShift = swap.targetShiftId ? shifts.find((s) => s.id === swap.targetShiftId) : undefined;

  // Stale check (FR-23)
  if (
    reqShift.version !== swap.requesterShiftVersion ||
    (swap.targetShiftId && tgtShift && tgtShift.version !== swap.targetShiftVersion)
  ) {
    await shardClient.swapRequest.update({
      where: { id: swapId },
      data: { status: 'CANCELED', version: { increment: 1 } },
    });
    throw new AppError('SWAP_STALE', 409, 'Shifts were modified; swap cancelled');
  }

  // Overlap check (FR-24)
  const targetOverlap = await shardClient.shift.findFirst({
    where: {
      teamId,
      assigneeUserId: swap.targetUserId,
      deletedAt: null,
      id: tgtShift ? { not: tgtShift.id } : undefined,
      startsAt: { lt: reqShift.endsAt },
      endsAt: { gt: reqShift.startsAt },
    },
  });
  if (targetOverlap) {
    throw new AppError('SWAP_OVERLAP', 409, 'Approving this swap would cause an overlapping shift');
  }

  if (tgtShift) {
    const reqOverlap = await shardClient.shift.findFirst({
      where: {
        teamId,
        assigneeUserId: swap.requesterUserId,
        deletedAt: null,
        id: { not: reqShift.id },
        startsAt: { lt: tgtShift.endsAt },
        endsAt: { gt: tgtShift.startsAt },
      },
    });
    if (reqOverlap) {
      throw new AppError(
        'SWAP_OVERLAP',
        409,
        'Approving this swap would cause an overlapping shift',
      );
    }
  }

  const isSelfApproved =
    managerUserId === swap.requesterUserId || managerUserId === swap.targetUserId;
  const now = new Date();

  // One shard transaction with SET CONSTRAINTS shift_no_overlap DEFERRED (FR-23)
  const result = await shardClient.$transaction(async (tx) => {
    // Attempt to defer shift_no_overlap constraint in Postgres
    if ('$executeRawUnsafe' in tx && typeof tx.$executeRawUnsafe === 'function') {
      try {
        await tx.$executeRawUnsafe('SET CONSTRAINTS shift_no_overlap DEFERRED');
      } catch {
        // Ignored if in mock or environment where constraint is not present
      }
    }

    // Reassign requester shift to target user
    await tx.shift.update({
      where: { id: reqShift.id },
      data: {
        assigneeUserId: swap.targetUserId,
        version: { increment: 1 },
      },
    });

    // If trade, reassign target shift to requester user
    if (tgtShift) {
      await tx.shift.update({
        where: { id: tgtShift.id },
        data: {
          assigneeUserId: swap.requesterUserId,
          version: { increment: 1 },
        },
      });
    }

    // Update swap status
    const updatedSwap = (await tx.swapRequest.update({
      where: { id: swapId },
      data: {
        status: 'APPROVED',
        decidedByUserId: managerUserId,
        decidedAt: now,
        decisionNote: body.note ?? null,
        version: { increment: 1 },
      },
    })) as DbSwap;

    // Write SHIFT_SWAPPED feed event (FR-23, FR-26)
    await tx.activityEvent.create({
      data: {
        teamId,
        type: 'SHIFT_SWAPPED',
        actorUserId: managerUserId,
        subjectShiftId: reqShift.id,
        subjectUserId: swap.targetUserId,
        payload: {
          swapId: swap.id,
          type: swap.type,
          requesterUserId: swap.requesterUserId,
          targetUserId: swap.targetUserId,
          requesterShiftId: swap.requesterShiftId,
          targetShiftId: swap.targetShiftId,
          selfApproved: isSelfApproved,
        },
        dedupeKey: `swap-approved:${swap.id}`,
      },
    });

    // Write Outbox entry
    const outboxEntry = await writeOutbox(tx, {
      kind: 'notify.fanout',
      sourceKey: `swap:${updatedSwap.id}:APPROVED`,
      teamId,
      payload: {
        sourceKey: `swap:${updatedSwap.id}:APPROVED`,
        teamId,
        type: 'SWAP_APPROVED',
      },
    });

    return { swap: updatedSwap, outboxEntry };
  });

  if (result.outboxEntry) {
    try {
      await dispatchOutboxEntry(result.outboxEntry as OutboxEntry);
    } catch (err) {
      logger.warn({ err }, 'Failed to dispatch swap approval notification');
    }
  }

  return {
    swap: formatSwap(result.swap, team.timezone),
  };
}

/**
 * Manager or Owner rejects a swap request (FR-23).
 */
export async function rejectSwap(params: {
  teamId: string;
  swapId: string;
  managerUserId: string;
  managerRole: 'OWNER' | 'MANAGER';
  body: SwapDecisionBody;
}): Promise<SwapResponse> {
  const { teamId, swapId, managerUserId, managerRole, body } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const swap = (await shardClient.swapRequest.findUnique({
    where: { id: swapId },
  })) as DbSwap | null;

  if (!swap || swap.teamId !== teamId) {
    throw new AppError('NOT_FOUND', 404, 'Swap request not found');
  }

  // Self-decision check (FR-23)
  if (
    managerRole === 'MANAGER' &&
    (managerUserId === swap.requesterUserId || managerUserId === swap.targetUserId)
  ) {
    throw new AppError(
      'SWAP_SELF_DECISION',
      403,
      'Managers cannot decide swaps they are involved in',
    );
  }

  if (swap.status !== 'PENDING_MANAGER') {
    throw new AppError(
      'SWAP_ALREADY_DECIDED',
      409,
      'Swap request is no longer pending manager decision',
    );
  }

  const result = await shardClient.$transaction(async (tx) => {
    const updatedSwap = (await tx.swapRequest.update({
      where: { id: swapId },
      data: {
        status: 'REJECTED',
        decidedByUserId: managerUserId,
        decidedAt: new Date(),
        decisionNote: body.note ?? null,
        version: { increment: 1 },
      },
    })) as DbSwap;

    const outboxEntry = await writeOutbox(tx, {
      kind: 'notify.fanout',
      sourceKey: `swap:${updatedSwap.id}:REJECTED`,
      teamId,
      payload: {
        sourceKey: `swap:${updatedSwap.id}:REJECTED`,
        teamId,
        type: 'SWAP_REJECTED',
      },
    });

    return { swap: updatedSwap, outboxEntry };
  });

  if (result.outboxEntry) {
    try {
      await dispatchOutboxEntry(result.outboxEntry as OutboxEntry);
    } catch (err) {
      logger.warn({ err }, 'Failed to dispatch swap rejection notification');
    }
  }

  return {
    swap: formatSwap(result.swap, team.timezone),
  };
}

/**
 * Lists swaps in a team (PRD 7.2, FR-21 to FR-25).
 * - Managers and owners can see all swaps.
 * - Staff can only see swaps where they are the requester or target.
 */
export async function listSwaps(params: {
  teamId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  query: SwapListQuery;
}): Promise<SwapListResponse> {
  const { teamId, userId, role, query } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const whereClause: {
    teamId: string;
    status?: DbSwap['status'];
    OR?: Array<{ requesterUserId: string } | { targetUserId: string }>;
  } = {
    teamId,
  };

  if (query.status) {
    whereClause.status = query.status;
  }

  if (role === 'STAFF') {
    whereClause.OR = [{ requesterUserId: userId }, { targetUserId: userId }];
  }

  const rawSwaps = (await shardClient.swapRequest.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  })) as DbSwap[];

  return {
    swaps: rawSwaps.map((s) => formatSwap(s, team.timezone)),
  };
}
