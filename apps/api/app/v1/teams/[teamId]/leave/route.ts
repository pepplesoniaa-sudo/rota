import { AppError } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { leaveTeam } from '../../../../../lib/domain/teams/members';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
  },
  async ({ teamId, userId, role }) => {
    if (!teamId || !userId || !role) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return leaveTeam(teamId, userId, role);
  },
);
