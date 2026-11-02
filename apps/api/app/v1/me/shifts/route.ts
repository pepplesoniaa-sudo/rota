import { AppError, MyShiftsQuery } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { getMyShifts } from '../../../../lib/domain/shifts/me';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    query: MyShiftsQuery,
  },
  async (ctx) => {
    if (!ctx.userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }

    return getMyShifts({
      userId: ctx.userId,
      query: ctx.query,
    });
  },
);
