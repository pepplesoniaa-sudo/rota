import { AppError, CreateSwapBody, SwapListQuery } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { createSwapRequest, listSwaps } from '../../../../../lib/domain/swaps/manage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
    query: SwapListQuery,
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

    return listSwaps({
      teamId: ctx.teamId,
      userId: ctx.userId,
      role: ctx.role,
      query: ctx.query,
    });
  },
);

export const POST = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
    status: 201,
    body: CreateSwapBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }

    return createSwapRequest({
      teamId: ctx.teamId,
      requesterUserId: ctx.userId,
      body: ctx.body,
    });
  },
);
