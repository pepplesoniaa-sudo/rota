import { Prisma, RefreshToken } from '@prisma/client';
import { AppError } from '@rota/shared';
import { v7 as uuidv7 } from 'uuid';
import { dbShard0 } from '../db';
import { logger } from '../log';
import { createAccessToken } from './jwt';
import { generateRandomToken, hashToken } from './tokens';

export type Shard0Tx = Parameters<Parameters<typeof dbShard0.$transaction>[0]>[0];

export interface CreateRefreshTokenParams {
  userId: string;
  deviceName?: string | null;
  familyId?: string;
  tx?: Shard0Tx | Prisma.TransactionClient;
}

export interface CreateRefreshTokenResult {
  rawToken: string;
  record: RefreshToken;
}

export interface RotateRefreshTokenParams {
  rawToken: string;
  deviceName?: string | null;
}

export interface RotateRefreshTokenResult {
  accessToken: string;
  rawRefreshToken: string;
  userId: string;
}

/**
 * Creates an initial refresh token session (L-33, PRD 7.9).
 * - 32-byte crypto random token
 * - Only SHA-256 hash stored in DB (B-49)
 * - 30-day lifetime from issue
 */
export async function createRefreshToken(
  params: CreateRefreshTokenParams,
): Promise<CreateRefreshTokenResult> {
  const client = params.tx ?? dbShard0;
  const familyId = params.familyId ?? uuidv7();
  const rawToken = generateRandomToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const record = await client.refreshToken.create({
    data: {
      userId: params.userId,
      familyId,
      tokenHash,
      deviceName: params.deviceName ?? null,
      createdAt: now,
      expiresAt,
    },
  });

  return {
    rawToken,
    record,
  };
}

/**
 * Rotates a refresh token on use (L-33, B-50, PRD 7.9, FR-03, FR-04).
 * - Rotates token within the same familyId
 * - 30-second grace window for retries: revokes superseded successor and reissues
 * - After 30 seconds: logs REFRESH_TOKEN_REUSE, revokes entire family, throws 401 AUTH_REFRESH_REUSED
 * - Revoked token throws 401 AUTH_REFRESH_REVOKED
 * - Expired token throws 401 AUTH_TOKEN_EXPIRED
 */
export async function rotateRefreshToken(
  params: RotateRefreshTokenParams,
): Promise<RotateRefreshTokenResult> {
  const tokenHash = hashToken(params.rawToken);
  const prismaClient = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  return prismaClient.$transaction(async (tx) => {
    const record = await tx.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid refresh token');
    }

    if (record.revokedAt !== null) {
      throw new AppError('AUTH_REFRESH_REVOKED', 401, 'Refresh token has been revoked');
    }

    const now = new Date();
    if (record.expiresAt.getTime() < now.getTime()) {
      throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Refresh token has expired');
    }

    // Check if token was already rotated (L-33, B-50, PRD 7.9)
    if (record.rotatedAt !== null) {
      const elapsedMs = now.getTime() - record.rotatedAt.getTime();
      const GRACE_WINDOW_MS = 30 * 1000;

      if (elapsedMs > GRACE_WINDOW_MS) {
        // Theft detection: token reuse outside grace window
        await tx.refreshToken.updateMany({
          where: { familyId: record.familyId, revokedAt: null },
          data: { revokedAt: now },
        });

        logger.warn(
          { userId: record.userId, familyId: record.familyId, tokenId: record.id },
          'REFRESH_TOKEN_REUSE: refresh token reused after 30s grace window, family revoked',
        );

        throw new AppError('AUTH_REFRESH_REUSED', 401, 'Refresh token reuse detected');
      }

      // Retry within 30s grace window: revoke successor and reissue pair
      if (record.replacedById) {
        await tx.refreshToken.updateMany({
          where: { id: record.replacedById, revokedAt: null },
          data: { revokedAt: now },
        });
      }

      const newRawToken = generateRandomToken();
      const newTokenHash = hashToken(newRawToken);
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const replacement = await tx.refreshToken.create({
        data: {
          userId: record.userId,
          familyId: record.familyId,
          tokenHash: newTokenHash,
          deviceName: params.deviceName ?? record.deviceName,
          createdAt: now,
          expiresAt,
        },
      });

      await tx.refreshToken.update({
        where: { id: record.id },
        data: { replacedById: replacement.id },
      });

      const accessToken = await createAccessToken(record.userId);

      return {
        accessToken,
        rawRefreshToken: newRawToken,
        userId: record.userId,
      };
    }

    // Clean first-time rotation
    const newRawToken = generateRandomToken();
    const newTokenHash = hashToken(newRawToken);
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const replacement = await tx.refreshToken.create({
      data: {
        userId: record.userId,
        familyId: record.familyId,
        tokenHash: newTokenHash,
        deviceName: params.deviceName ?? record.deviceName,
        createdAt: now,
        expiresAt,
      },
    });

    await tx.refreshToken.update({
      where: { id: record.id },
      data: {
        rotatedAt: now,
        replacedById: replacement.id,
      },
    });

    const accessToken = await createAccessToken(record.userId);

    return {
      accessToken,
      rawRefreshToken: newRawToken,
      userId: record.userId,
    };
  });
}

/**
 * Revokes a single refresh token by raw token (for single logout FR-03).
 */
export async function revokeRefreshToken(
  rawToken: string,
  tx?: Shard0Tx | Prisma.TransactionClient,
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const client = tx ?? dbShard0;
  await client.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes an entire token family by familyId.
 */
export async function revokeRefreshTokenFamily(
  familyId: string,
  tx?: Shard0Tx | Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? dbShard0;
  await client.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes all refresh tokens for a user (Log out everywhere FR-03, PRD 7.9).
 */
export async function revokeAllUserRefreshTokens(
  userId: string,
  tx?: Shard0Tx | Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? dbShard0;
  await client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
