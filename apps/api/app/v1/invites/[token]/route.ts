import { withApi } from '../../../../lib/api/with-api';
import { getInviteByToken } from '../../../../lib/domain/teams/invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(
  {
    auth: 'public',
  },
  async (ctx) => {
    return getInviteByToken(ctx.params.token as string);
  },
);
