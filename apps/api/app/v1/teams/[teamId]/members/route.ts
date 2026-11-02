import { AppError } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { getTeamMembers } from '../../../../../lib/domain/teams/members';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER', 'STAFF'],
  },
  async ({ teamId }) => {
    if (!teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId parameter');
    }
    return getTeamMembers(teamId);
  },
);
