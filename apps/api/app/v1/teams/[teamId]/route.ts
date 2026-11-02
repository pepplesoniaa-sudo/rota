import { AppError, UpdateTeamBody } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { getTeam, updateTeam } from '../../../../lib/domain/teams/manage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
  },
  async ({ teamId, userId, role }) => {
    if (!teamId || !userId || !role) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return getTeam(teamId, userId, role);
  },
);

export const PATCH = withApi(
  {
    auth: 'access',
    roles: ['OWNER'],
    body: UpdateTeamBody,
  },
  async ({ teamId, userId, body }) => {
    if (!teamId || !userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return updateTeam(teamId, userId, body);
  },
);
