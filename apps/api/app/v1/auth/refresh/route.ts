import { RefreshBody } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { refreshSession } from '../../../../lib/domain/auth/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /v1/auth/refresh (FR-03, PRD 7.2, SEC-1, L-33, B-50)
 * Rotates a refresh token, issuing a new access token and rotated refresh token.
 */
export const POST = withApi(
  {
    auth: 'refresh',
    body: RefreshBody,
  },
  async ({ body }) => {
    return refreshSession(body);
  },
);
