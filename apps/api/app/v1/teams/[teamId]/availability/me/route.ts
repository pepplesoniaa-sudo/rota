import { ReplaceAvailabilityBody, AppError } from '@rota/shared';
import { withApi } from '../../../../../../lib/api/with-api';
import { replaceAvailability } from '../../../../../../lib/domain/shifts/availability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
    body: ReplaceAvailabilityBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }

    return replaceAvailability({
      teamId: ctx.teamId,
      userId: ctx.userId,
      body: ctx.body,
    });
  },
);
