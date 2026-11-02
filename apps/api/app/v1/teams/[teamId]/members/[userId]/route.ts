import { AppError, UpdateMemberRoleBody } from '@rota/shared';
import { withApi } from '../../../../../../lib/api/with-api';
import { removeMember, updateMemberRole } from '../../../../../../lib/domain/teams/members';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = withApi(
  {
    auth: 'access',
    roles: ['OWNER'],
    body: UpdateMemberRoleBody,
  },
  async ({ teamId, userId, params, body }) => {
    if (!teamId || !userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    const targetUserId = typeof params.userId === 'string' ? params.userId : '';
    return updateMemberRole(teamId, userId, targetUserId, body);
  },
);

export const DELETE = withApi(
  {
    auth: 'access',
    roles: ['OWNER', 'MANAGER'],
  },
  async ({ teamId, userId, role, params }) => {
    if (!teamId || !userId || !role) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    const targetUserId = typeof params.userId === 'string' ? params.userId : '';
    return removeMember(teamId, userId, role, targetUserId);
  },
);
