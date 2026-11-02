import { AppError, LoginBody, LoginResponse } from '@rota/shared';
import { createAccessToken } from '../../auth/jwt';
import { verifyPassword } from '../../auth/password';
import { createRefreshToken } from '../../auth/refresh';
import { dbShard0 } from '../../db';
import { checkRateLimit, incrementRateLimit, resetRateLimit } from '../../rate-limit';

/**
 * Logs in a user (FR-02, PRD 7.2, L-34).
 * - Rate limit: 5 failed attempts per 15 min per email and IP (L-34, FR-02)
 * - Returns identical 401 AUTH_INVALID_CREDENTIALS whether email exists or not (FR-02)
 * - On success, issues new access token (15m) and refresh token (30d) (L-15, L-33)
 */
export async function loginUser(
  input: LoginBody,
  clientIp: string,
): Promise<LoginResponse> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const rlId = `${normalizedEmail}:${clientIp}`;
  const WINDOW_SECONDS = 15 * 60; // 15 minutes (L-34, FR-02)
  const LIMIT = 5;

  // 1. Rate limit check: 5 attempts per 15 min per email and IP
  const rateLimit = await checkRateLimit({
    scope: 'login',
    id: rlId,
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
  });

  if (!rateLimit.allowed) {
    throw new AppError(
      'RATE_LIMITED',
      429,
      'Too many failed login attempts. Please try again later.',
      { retryAfter: rateLimit.retryAfter },
    );
  }

  // 2. Fetch user on Shard 0 primary (L-27)
  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const user = await client.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      displayName: true,
    },
  });

  // Timing-safe behavior: always report identical error if user not found (FR-02)
  if (!user) {
    await incrementRateLimit({
      scope: 'login',
      id: rlId,
      limit: LIMIT,
      windowSeconds: WINDOW_SECONDS,
    });
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }

  // 3. Verify password with Argon2id
  const isMatch = await verifyPassword(user.passwordHash, input.password);
  if (!isMatch) {
    await incrementRateLimit({
      scope: 'login',
      id: rlId,
      limit: LIMIT,
      windowSeconds: WINDOW_SECONDS,
    });
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }

  // 4. Credentials valid: reset failed attempt counter
  await resetRateLimit('login', rlId, WINDOW_SECONDS);

  // 5. Issue new Refresh Token session (L-33, PRD 7.9)
  const { rawToken } = await createRefreshToken({
    userId: user.id,
    deviceName: input.deviceName ?? null,
  });

  // 6. Issue Access Token JWT (L-15, L-33)
  const accessToken = await createAccessToken(user.id);

  return {
    accessToken,
    refreshToken: rawToken,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  };
}

