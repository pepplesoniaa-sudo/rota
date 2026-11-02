import { AppError, PushTokenParams } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { deletePushToken } from '../../../../../lib/domain/me/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = withApi(
  {
    auth: 'access',
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }

    const parseResult = PushTokenParams.safeParse(ctx.params);
    if (!parseResult.success) {
      throw new AppError('VALIDATION_FAILED', 400, parseResult.error.message);
    }

    return deletePushToken(ctx.userId, parseResult.data.pushTokenId);
  },
);
