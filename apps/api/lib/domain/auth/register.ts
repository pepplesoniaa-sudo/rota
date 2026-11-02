import { AppError, RegisterBody, RegisterResponse } from '@rota/shared';
import { createAccessToken } from '../../auth/jwt';
import { hashPassword } from '../../auth/password';
import { createRefreshToken } from '../../auth/refresh';
import { dbShard0 } from '../../db';
import { isValidIanaTimezone } from '../../time';

/**
 * Registers a new user account (FR-01, PRD 5.2, PRD 7.2).
 * - Checks email uniqueness (throws 409 EMAIL_TAKEN)
 * - Hashes password using Argon2id (L-15, SEC-2)
 * - Validates IANA timezone (L-14, FR-01)
 * - Creates User and UserSettings in Shard 0 (L-27)
 * - Creates initial RefreshToken session in Shard 0 (PRD 7.9, L-33)
 * - Returns access token, refresh token, and user info (FR-01)
 */
export async function registerUser(input: RegisterBody): Promise<RegisterResponse> {
  const normalizedEmail = input.email.trim().toLowerCase();

  if (!isValidIanaTimezone(input.timezone)) {
    throw new AppError('VALIDATION_FAILED', 400, 'Invalid IANA timezone');
  }

  const displayName = input.displayName?.trim() || normalizedEmail.split('@')[0] || 'User';
  const passwordHash = await hashPassword(input.password);

  const prismaClient = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  return prismaClient.$transaction(async (tx) => {
    // 1. Check email uniqueness
    const existing = await tx.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new AppError('EMAIL_TAKEN', 409, 'An account with this email already exists');
    }

    // 2. Create User and UserSettings
    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        displayName,
        settings: {
          create: {
            timezone: input.timezone,
          },
        },
      },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    });

    // 3. Create RefreshToken in the same transaction
    const { rawToken } = await createRefreshToken({
      userId: user.id,
      tx,
    });

    // 4. Generate AccessToken (JWT)
    const accessToken = await createAccessToken(user.id);

    return {
      accessToken,
      refreshToken: rawToken,
      user,
    };
  });
}
