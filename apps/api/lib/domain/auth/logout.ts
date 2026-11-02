import { revokeAllUserRefreshTokens, revokeRefreshToken } from '../../auth/refresh';

/**
 * Logs out a user on the current device by revoking their refresh token (FR-03, PRD 7.2).
 */
export async function logoutUser(refreshToken: string): Promise<{ ok: true }> {
  await revokeRefreshToken(refreshToken);
  return { ok: true };
}

/**
 * Logs out a user on all devices by revoking all their refresh tokens (FR-03, PRD 7.9).
 */
export async function logoutAllDevices(userId: string): Promise<{ ok: true }> {
  await revokeAllUserRefreshTokens(userId);
  return { ok: true };
}

