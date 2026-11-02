import { EmptyBody } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { logoutAllDevices } from '../../../../lib/domain/auth/logout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /v1/auth/logout-all (FR-03, PRD 7.2, SEC-1)
 * Revokes all refresh tokens for the authenticated user (Log out everywhere).
 */
export const POST = withApi(
  {
    auth: 'access',
    body: EmptyBody,
  },
  async ({ userId }) => {
    return logoutAllDevices(userId ?? '');
  },
);

