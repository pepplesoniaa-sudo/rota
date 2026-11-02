import { AppError, CreateShiftBody, ShiftRangeQuery } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { createShift, getShiftsRange } from '../../../../../lib/domain/shifts/manage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
    status: 201,
    body: CreateShiftBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }

    return createShift({
      teamId: ctx.teamId,
      createdByUserId: ctx.userId,
      body: ctx.body,
    });
  },
);

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
    query: ShiftRangeQuery,
  },
  async (ctx) => {
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }
    if (!ctx.role) {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }

    return getShiftsRange({
      teamId: ctx.teamId,
      query: ctx.query,
      role: ctx.role,
    });
  },
);
