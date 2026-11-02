import { AppError, RegisterPushTokenBody } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { registerPushToken } from '../../../../lib/domain/me/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    status: 201,
    body: RegisterPushTokenBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return registerPushToken(ctx.userId, ctx.body);
  },
);
