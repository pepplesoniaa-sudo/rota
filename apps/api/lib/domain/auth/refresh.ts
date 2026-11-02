import { RefreshBody, RefreshResponse } from '@rota/shared';
import { rotateRefreshToken } from '../../auth/refresh';
import { markUserWrite } from '../../data/router';

/**
 * Refreshes an authenticated session using a refresh token (FR-03, PRD 7.2, PRD 7.9).
 * - Rotates the refresh token within the same token family
 * - Replaces the successor if called within 30s grace window (retries)
 * - Revokes entire family on reuse after 30s (theft detection)
 * - Returns new access token and rotated refresh token
 * - Triggers RYOW on Shard 0 (PRD 7.5, AGENTS.md A-9)
 */
export async function refreshSession(input: RefreshBody): Promise<RefreshResponse> {
  const result = await rotateRefreshToken({
    rawToken: input.refreshToken,
    deviceName: input.deviceName ?? null,
  });

  await markUserWrite(result.userId);

  return {
    accessToken: result.accessToken,
    refreshToken: result.rawRefreshToken,
  };
}

