import { AvailabilityQuery, AppError } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { getAvailability } from '../../../../../lib/domain/shifts/availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
    query: AvailabilityQuery,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }
    if (!ctx.role) {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }

    return getAvailability({
      teamId: ctx.teamId,
      userId: ctx.userId,
      role: ctx.role,
      targetUserId: ctx.query.userId,
    });
  },
);
