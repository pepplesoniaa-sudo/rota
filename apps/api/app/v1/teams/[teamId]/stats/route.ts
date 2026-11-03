import { AppError, StatsQuery } from '@rota/shared';
import { withApi } from '@/lib/api';
import { getTeamStats } from '@/lib/domain/teams/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
    query: StatsQuery,
  },
  async ({ teamId, query }) => {
    if (!teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId parameter');
    }
    return getTeamStats(teamId, query);
  },
);
