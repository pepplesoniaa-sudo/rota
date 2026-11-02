import { PasswordResetRequestBody } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { requestPasswordReset } from '../../../../../lib/domain/auth/password-reset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /v1/auth/password-reset/request (FR-06, PRD 7.2, SEC-1, L-34)
 * Public password reset request endpoint with rate limiting (3 requests per hour per email).
 * Always returns 202 whether email exists or not.
 */
export const POST = withApi(
  {
    auth: 'public',
    status: 202,
    body: PasswordResetRequestBody,
  },
  async ({ body }) => {
    await requestPasswordReset(body);
    return { ok: true };
  },
);
