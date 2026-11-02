import { LogoutBody } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { logoutUser } from '../../../../lib/domain/auth/logout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /v1/auth/logout (FR-03, PRD 7.2, SEC-1)
 * Revokes current device's refresh token.
 */
export const POST = withApi(
  {
    auth: 'access',
    body: LogoutBody,
  },
  async ({ body }) => {
    return logoutUser(body.refreshToken);
  },
);

