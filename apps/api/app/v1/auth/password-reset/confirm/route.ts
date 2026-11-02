import { PasswordResetConfirmBody } from '@rota/shared';
import { withApi } from '../../../../../lib/api/with-api';
import { confirmPasswordReset } from '../../../../../lib/domain/auth/password-reset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /v1/auth/password-reset/confirm (FR-06, PRD 7.2, SEC-1, L-15, L-33)
 * Public password reset confirmation endpoint using a single-use 30-minute token.
 * Sets new password, marks token used, and revokes all user refresh tokens.
 */
export const POST = withApi(
  {
    auth: 'public',
    status: 200,
    body: PasswordResetConfirmBody,
  },
  async ({ body }) => {
    await confirmPasswordReset(body);
    return { ok: true };
  },
);
