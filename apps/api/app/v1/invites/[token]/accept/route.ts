import { AcceptInviteBody, AppError } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { acceptInvite } from '../../../../../lib/domain/teams/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(
  {
    auth: 'access',
    body: AcceptInviteBody,
  },
  async ({ params, userId }) => {
    if (!userId) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Unauthorized');
    }
    const token = typeof params.token === 'string' ? params.token : '';
    return acceptInvite(token, userId);
  },
);
