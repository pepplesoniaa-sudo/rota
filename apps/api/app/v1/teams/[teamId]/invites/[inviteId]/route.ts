import { AppError } from '@rota/shared';
import { withApi } from '../../../../../../lib/api/with-api';
import { revokeInvite } from '../../../../../../lib/domain/teams/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
  },
  async ({ teamId, params }) => {
    if (!teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId parameter');
    }
    const inviteId = typeof params.inviteId === 'string' ? params.inviteId : '';
    return revokeInvite(teamId, inviteId);
  },
);
