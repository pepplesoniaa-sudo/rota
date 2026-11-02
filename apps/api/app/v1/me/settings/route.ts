import { AppError, UpdateSettingsBody } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { getMySettings, updateMySettings } from '../../../../lib/domain/me/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return getMySettings(ctx.userId);
  },
);

export const PATCH = withApi(
  {
    auth: 'access',
    body: UpdateSettingsBody,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return updateMySettings(ctx.userId, ctx.body);
  },
);
