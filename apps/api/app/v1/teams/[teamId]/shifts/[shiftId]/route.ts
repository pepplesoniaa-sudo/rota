import { AppError, DeleteShiftQuery, UpdateShiftBody } from '@rota/shared';
import { withApi } from '../../../../../../lib/api/with-api';
import { deleteShift, getShift, updateShift } from '../../../../../../lib/domain/shifts/manage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }
    const shiftId = typeof ctx.params['shiftId'] === 'string' ? ctx.params['shiftId'] : undefined;
    if (!shiftId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing shiftId');
    }
    if (!ctx.role) {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }

    return getShift({
      teamId: ctx.teamId,
      shiftId,
      userId: ctx.userId,
      role: ctx.role,
    });
  },
);

export const PATCH = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
    body: UpdateShiftBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }
    const shiftId = typeof ctx.params['shiftId'] === 'string' ? ctx.params['shiftId'] : undefined;
    if (!shiftId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing shiftId');
    }

    return updateShift({
      teamId: ctx.teamId,
      shiftId,
      updatedByUserId: ctx.userId,
      body: ctx.body,
    });
  },
);

export const DELETE = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
    query: DeleteShiftQuery,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }
    const shiftId = typeof ctx.params['shiftId'] === 'string' ? ctx.params['shiftId'] : undefined;
    if (!shiftId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing shiftId');
    }

    return deleteShift({
      teamId: ctx.teamId,
      shiftId,
      deletedByUserId: ctx.userId,
      version: ctx.query.version,
    });
  },
);
