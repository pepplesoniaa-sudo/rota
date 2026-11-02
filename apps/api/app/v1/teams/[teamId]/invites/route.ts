import { AppError, CreateInviteBody } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { createInvite, getPendingInvites } from '../../../../../lib/domain/teams/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
    status: 201,
    body: CreateInviteBody,
  },
  async ({ teamId, userId, role, body }) => {
    if (!teamId || !userId || !role) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return createInvite(teamId, userId, role, body);
  },
);

export const GET = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
  },
  async ({ teamId }) => {
    if (!teamId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Missing teamId parameter');
    }
    return getPendingInvites(teamId);
  },
);
