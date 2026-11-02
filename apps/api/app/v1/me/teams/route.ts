import { AppError } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { getMyTeams } from '../../../../lib/domain/me/profile';

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
    return getMyTeams(ctx.userId);
  },
);
