import { DateTime } from 'luxon';
import {
  AppError,
  CreateShiftBody,
  ShiftItem,
  ShiftListResponse,
  ShiftRangeQuery,
  ShiftResponse,
  UpdateShiftBody,
} from '@rota/shared';
import { dbShard0, getShardClient } from '../../db';
import { getTeamShardIndex } from '../../data/router';
import { parseLocalToUtc, validateShiftDuration } from '../../time';
import { validateAvailability } from './availability';

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

function formatShiftResponse(shift: DbShift, timezone: string, needsCover?: boolean): ShiftItem {
  const startsLocal = DateTime.fromJSDate(shift.startsAt, { zone: 'utc' })
    .setZone(timezone)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const endsLocal = DateTime.fromJSDate(shift.endsAt, { zone: 'utc' })
    .setZone(timezone)
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");

  return {
    id: shift.id,
    teamId: shift.teamId,
    assigneeUserId: shift.assigneeUserId,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    startsLocal,
    endsLocal,
    position: shift.position,
    location: shift.location,
    notes: shift.notes,
    status: shift.status,
    publishedAt: shift.publishedAt ? shift.publishedAt.toISOString() : null,
    version: shift.version,
    createdByUserId: shift.createdByUserId,
    createdAt: shift.createdAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString(),
    ...(needsCover !== undefined ? { needsCover } : {}),
  };
}

export async function createShift(params: {
  teamId: string;
  createdByUserId: string;
  body: CreateShiftBody;
}): Promise<ShiftResponse> {
  const { teamId, createdByUserId, body } = params;

  // 1. Fetch team metadata (timezone, shardIndex) on Shard 0
  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { id: true, timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  // 2. Verify assignee is an active member of this team (DB-10)
  const membership = await dbShard0.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: body.assigneeUserId,
      },
    },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    throw new AppError('VALIDATION_FAILED', 400, 'Assignee is not an active member of this team');
  }

  // 3. Resolve local times to UTC instants using team timezone (FR-15, L-14)
  const startsUtc = parseLocalToUtc(body.startsLocal, team.timezone, body.startsUseLaterOffset);
  const endsUtc = parseLocalToUtc(body.endsLocal, team.timezone, body.endsUseLaterOffset);

  // 4. Validate shift duration (15 min to 16 hours, L-36)
  validateShiftDuration(startsUtc, endsUtc);

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  // 5. Availability check (FR-20)
  const blocks = await shardClient.availabilityBlock.findMany({
    where: {
      teamId,
      userId: body.assigneeUserId,
    },
  });

  const startsLocal = startsUtc.setZone(team.timezone);
  const endsLocal = endsUtc.setZone(team.timezone);

  validateAvailability({
    startsLocal,
    endsLocal,
    blocks,
    acknowledgeAvailability: body.acknowledgeAvailability,
  });

  // 6. Overlap check on shard (FR-15, FR-24)
  const startsAtDate = startsUtc.toJSDate();
  const endsAtDate = endsUtc.toJSDate();

  const overlap = await shardClient.shift.findFirst({
    where: {
      teamId,
      assigneeUserId: body.assigneeUserId,
      deletedAt: null,
      startsAt: { lt: endsAtDate },
      endsAt: { gt: startsAtDate },
    },
    select: { id: true },
  });

  if (overlap) {
    throw new AppError('SHIFT_OVERLAP', 409, 'Assignee already has an overlapping shift');
  }

  // 7. Save shift as DRAFT on shard (FR-15c: drafts write no feed event and notify nobody)
  try {
    const shift = await shardClient.shift.create({
      data: {
        teamId,
        assigneeUserId: body.assigneeUserId,
        startsAt: startsAtDate,
        endsAt: endsAtDate,
        position: body.position,
        location: body.location ?? null,
        notes: body.notes ?? null,
        status: 'DRAFT',
        createdByUserId,
        version: 1,
      },
    });

    return {
      shift: formatShiftResponse(shift as DbShift, team.timezone),
    };
  } catch (err: unknown) {
    // Map Postgres exclusion constraint violation (23P01) to 409 SHIFT_OVERLAP
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      ((err as { code: string }).code === '23P01' ||
        (err as { code: string }).code === 'P2002' ||
        String((err as { message?: string }).message).includes('shift_no_overlap'))
    ) {
      throw new AppError('SHIFT_OVERLAP', 409, 'Assignee already has an overlapping shift');
    }
    throw err;
  }
}

export async function getShift(params: {
  teamId: string;
  shiftId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
}): Promise<ShiftResponse> {
  const { teamId, shiftId, role } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const shift = await shardClient.shift.findUnique({
    where: { id: shiftId },
  });

  if (!shift || shift.teamId !== teamId || shift.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'Shift not found');
  }

  // Drafts are hidden from staff (FR-15c)
  if (shift.status === 'DRAFT' && role === 'STAFF') {
    throw new AppError('NOT_FOUND', 404, 'Shift not found');
  }

  // Check if assignee is inactive -> needsCover (FR-12)
  const assigneeMembership = await dbShard0.membership.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: shift.assigneeUserId,
      },
    },
    select: { status: true },
  });

  const needsCover = assigneeMembership?.status !== 'ACTIVE';

  return {
    shift: formatShiftResponse(shift as DbShift, team.timezone, needsCover),
  };
}

export async function updateShift(params: {
  teamId: string;
  shiftId: string;
  updatedByUserId: string;
  body: UpdateShiftBody;
}): Promise<ShiftResponse> {
  const { teamId, shiftId, body } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const existing = await shardClient.shift.findUnique({
    where: { id: shiftId },
  });

  if (!existing || existing.teamId !== teamId || existing.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'Shift not found');
  }

  // Optimistic concurrency check (FR-16, DB-11)
  if (existing.version !== body.version) {
    throw new AppError('VERSION_CONFLICT', 409, 'Shift version conflict; reload and retry');
  }

  const targetAssigneeId = body.assigneeUserId ?? existing.assigneeUserId;

  // If assignee changed, verify new assignee is an active member
  if (body.assigneeUserId && body.assigneeUserId !== existing.assigneeUserId) {
    const membership = await dbShard0.membership.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: body.assigneeUserId,
        },
      },
      select: { status: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_FAILED', 400, 'Assignee is not an active member of this team');
    }
  }

  let startsUtc: DateTime = DateTime.fromJSDate(existing.startsAt, { zone: 'utc' });
  let endsUtc: DateTime = DateTime.fromJSDate(existing.endsAt, { zone: 'utc' });

  if (body.startsLocal) {
    startsUtc = parseLocalToUtc(body.startsLocal, team.timezone, body.startsUseLaterOffset);
  }
  if (body.endsLocal) {
    endsUtc = parseLocalToUtc(body.endsLocal, team.timezone, body.endsUseLaterOffset);
  }

  validateShiftDuration(startsUtc, endsUtc);

  const startsAtDate = startsUtc.toJSDate();
  const endsAtDate = endsUtc.toJSDate();

  // Availability check if times or assignee changed
  if (body.startsLocal || body.endsLocal || body.assigneeUserId) {
    const blocks = await shardClient.availabilityBlock.findMany({
      where: {
        teamId,
        userId: targetAssigneeId,
      },
    });

    const startsLocal = startsUtc.setZone(team.timezone);
    const endsLocal = endsUtc.setZone(team.timezone);

    validateAvailability({
      startsLocal,
      endsLocal,
      blocks,
      acknowledgeAvailability: body.acknowledgeAvailability,
    });
  }

  // Overlap check excluding this shift
  const overlap = await shardClient.shift.findFirst({
    where: {
      id: { not: shiftId },
      teamId,
      assigneeUserId: targetAssigneeId,
      deletedAt: null,
      startsAt: { lt: endsAtDate },
      endsAt: { gt: startsAtDate },
    },
    select: { id: true },
  });

  if (overlap) {
    throw new AppError('SHIFT_OVERLAP', 409, 'Assignee already has an overlapping shift');
  }

  // If time or assignee changed, cancel any open swaps involving this shift (FR-16)
  const isTimeOrAssigneeChanged =
    (body.assigneeUserId && body.assigneeUserId !== existing.assigneeUserId) ||
    existing.startsAt.getTime() !== startsAtDate.getTime() ||
    existing.endsAt.getTime() !== endsAtDate.getTime();

  if (isTimeOrAssigneeChanged) {
    await shardClient.swapRequest.updateMany({
      where: {
        teamId,
        OR: [{ requesterShiftId: shiftId }, { targetShiftId: shiftId }],
        status: { in: ['PENDING_PEER', 'PENDING_MANAGER'] },
      },
      data: {
        status: 'CANCELED',
        version: { increment: 1 },
      },
    });
  }

  const updated = await shardClient.shift.update({
    where: { id: shiftId },
    data: {
      assigneeUserId: targetAssigneeId,
      startsAt: startsAtDate,
      endsAt: endsAtDate,
      position: body.position !== undefined ? body.position : existing.position,
      location: body.location !== undefined ? body.location : existing.location,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      version: { increment: 1 },
    },
  });

  return {
    shift: formatShiftResponse(updated as DbShift, team.timezone),
  };
}

export async function deleteShift(params: {
  teamId: string;
  shiftId: string;
  deletedByUserId: string;
  version: number;
}): Promise<{ ok: boolean }> {
  const { teamId, shiftId, version } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const existing = await shardClient.shift.findUnique({
    where: { id: shiftId },
  });

  if (!existing || existing.teamId !== teamId || existing.deletedAt !== null) {
    throw new AppError('NOT_FOUND', 404, 'Shift not found');
  }

  if (existing.version !== version) {
    throw new AppError('VERSION_CONFLICT', 409, 'Shift version conflict; reload and retry');
  }

  // Cancel any open swaps involving this shift (FR-16)
  await shardClient.swapRequest.updateMany({
    where: {
      teamId,
      OR: [{ requesterShiftId: shiftId }, { targetShiftId: shiftId }],
      status: { in: ['PENDING_PEER', 'PENDING_MANAGER'] },
    },
    data: {
      status: 'CANCELED',
      version: { increment: 1 },
    },
  });

  // Soft delete shift
  await shardClient.shift.update({
    where: { id: shiftId },
    data: {
      deletedAt: new Date(),
      version: { increment: 1 },
    },
  });

  return { ok: true };
}

export async function getShiftsRange(params: {
  teamId: string;
  query: ShiftRangeQuery;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
}): Promise<ShiftListResponse> {
  const { teamId, query, role } = params;

  const team = await dbShard0.team.findUnique({
    where: { id: teamId, deletedAt: null },
    select: { timezone: true, shardIndex: true },
  });

  if (!team) {
    throw new AppError('NOT_FOUND', 404, 'Team not found');
  }

  // Validate range <= 31 days (FR-18, L-36)
  const fromDt = DateTime.fromISO(query.from, { zone: team.timezone }).startOf('day');
  const toDt = DateTime.fromISO(query.to, { zone: team.timezone }).endOf('day');

  if (toDt.diff(fromDt, 'days').days > 31) {
    throw new AppError('RANGE_TOO_LARGE', 400, 'Date range cannot exceed 31 days');
  }

  const shardIndex = team.shardIndex ?? (await getTeamShardIndex(teamId));
  const shardClient = getShardClient(shardIndex);

  const fromUtcDate = fromDt.toUTC().toJSDate();
  const toUtcDate = toDt.toUTC().toJSDate();

  // Query shifts on shard
  const shifts = await shardClient.shift.findMany({
    where: {
      teamId,
      deletedAt: null,
      status: role === 'STAFF' ? 'PUBLISHED' : undefined,
      startsAt: { lte: toUtcDate },
      endsAt: { gte: fromUtcDate },
    },
    orderBy: {
      startsAt: 'asc',
    },
  });

  // Query memberships of all assignees in this team to compute needsCover
  const assigneeIds = Array.from(new Set(shifts.map((s) => s.assigneeUserId)));
  const memberships = await dbShard0.membership.findMany({
    where: {
      teamId,
      userId: { in: assigneeIds },
    },
    select: { userId: true, status: true },
  });

  const activeAssigneeIds = new Set(
    memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.userId),
  );

  return {
    shifts: shifts.map((s) => {
      const needsCover = !activeAssigneeIds.has(s.assigneeUserId);
      return formatShiftResponse(s as DbShift, team.timezone, needsCover);
    }),
  };
}
