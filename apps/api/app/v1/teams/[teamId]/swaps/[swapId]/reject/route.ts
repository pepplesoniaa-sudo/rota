import { AppError, SwapDecisionBody } from '@rota/shared';
import { withApi } from '../../../../../../../lib/api/with-api';
import { rejectSwap } from '../../../../../../../lib/domain/swaps/manage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
    status: 200,
    body: SwapDecisionBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }
    if (!ctx.role || (ctx.role !== 'OWNER' && ctx.role !== 'MANAGER')) {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }
    const swapId = typeof ctx.params['swapId'] === 'string' ? ctx.params['swapId'] : undefined;
    if (!swapId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing swapId');
    }

    return rejectSwap({
      teamId: ctx.teamId,
      swapId,
      managerUserId: ctx.userId,
      managerRole: ctx.role,
      body: ctx.body,
    });
  },
);
