import { AppError, TransferOwnershipBody } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { transferOwnership } from '../../../../../lib/domain/teams/manage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    roles: ['OWNER'],
    body: TransferOwnershipBody,
  },
  async ({ teamId, userId, body }) => {
    if (!teamId || !userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    return transferOwnership(teamId, userId, body);
  },
);
