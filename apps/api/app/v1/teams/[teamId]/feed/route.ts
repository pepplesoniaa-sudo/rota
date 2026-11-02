import { AppError, FeedQuery } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { getTeamFeed } from '../../../../../lib/domain/feed/manage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
    query: FeedQuery,
  },
  async (ctx) => {
    if (!ctx.teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId');
    }

    return getTeamFeed({
      teamId: ctx.teamId,
      query: ctx.query,
    });
  },
);
