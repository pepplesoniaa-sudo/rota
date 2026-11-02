import { LoginBody } from '@rota/shared';
import { withApi } from '../../../../lib/api/with-api';
import { loginUser } from '../../../../lib/domain/auth/login';
import { getClientIp } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /v1/auth/login (FR-02, PRD 7.2, SEC-1, L-34)
 * Public login endpoint with rate limiting (5 failed attempts per 15 min per IP/email).
 */
export const POST = withApi(
  {
    auth: 'public',
    body: LoginBody,
  },
  async ({ req, body }) => {
    const clientIp = getClientIp(req);
    return loginUser(body, clientIp);
  },
);

