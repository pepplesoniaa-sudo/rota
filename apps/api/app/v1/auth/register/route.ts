import { RegisterBody } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { registerUser } from '../../../../lib/domain/auth/register';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /v1/auth/register (FR-01, PRD 7.2, SEC-1)
 * Public registration endpoint returning 201 with access and refresh tokens.
 */
export const POST = withApi(
  {
    auth: 'public',
    status: 201,
    body: RegisterBody,
  },
  async ({ body }) => {
    return registerUser(body);
  },
);
