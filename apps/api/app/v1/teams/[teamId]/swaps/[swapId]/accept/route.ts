import { AppError, SwapActionBody } from '@rota/shared';
import { withApi } from '../../../../../../../lib/api/with-api';
import { acceptSwap } from '../../../../../../../lib/domain/swaps/manage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
    status: 200,
    body: SwapActionBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }
    const swapId = typeof ctx.params['swapId'] === 'string' ? ctx.params['swapId'] : undefined;
    if (!swapId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing swapId');
    }

    return acceptSwap({
      teamId: ctx.teamId,
      swapId,
      userId: ctx.userId,
      body: ctx.body,
    });
  },
);
