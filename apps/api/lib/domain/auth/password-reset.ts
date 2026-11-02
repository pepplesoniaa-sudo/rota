import { AppError, PasswordResetConfirmBody, PasswordResetRequestBody } from '@rota/shared';
import { hashPassword } from '../../auth/password';
import { generateRandomToken, hashToken } from '../../auth/tokens';
import { env } from '../../config/env';
import { markUserWrite } from '../../data/router';
import { dbShard0 } from '../../db';
import { logger } from '../../log';
import { dispatchOutboxEntry, writeOutbox } from '../../outbox/writer';
import { checkRateLimit, incrementRateLimit } from '../../rate-limit';

/**
 * Requests a password reset link (FR-06, PRD 7.2, L-33, L-34).
 * - Rate limit: 3 requests per hour per email (L-34, FR-06)
 * - Returns 202 whether email exists or not (FR-06)
 * - When rate limited: silently suppresses email sending but still returns 202 (FR-06)
 * - Creates 30-minute single-use token and enqueues email via Outbox (A-4, A-5)
 */
export async function requestPasswordReset(input: PasswordResetRequestBody): Promise<void> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const LIMIT = 3;
  const WINDOW_SECONDS = 3600; // 1 hour (L-34, FR-06)

  // 1. Rate limit check: 3 requests per hour per email
  const rateLimit = await checkRateLimit({
    scope: 'password-reset',
    id: normalizedEmail,
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
  });

  if (!rateLimit.allowed) {
    logger.warn(
      { email: normalizedEmail },
      'Password reset request rate limit reached; suppressing email (FR-06)',
    );
    // FR-06: return 202 but send no email
    return;
  }

  // Increment rate limit counter
  await incrementRateLimit({
    scope: 'password-reset',
    id: normalizedEmail,
    limit: LIMIT,
    windowSeconds: WINDOW_SECONDS,
  });

  // 2. Fetch user on Shard 0 primary (L-27)
  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  const user = await client.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  });

  // FR-06: If user does not exist, return 202 without sending email (no user enumeration)
  if (!user) {
    logger.info(
      { email: normalizedEmail },
      'Password reset requested for non-existent email; silently ignored (FR-06)',
    );
    return;
  }

  // 3. Generate 32-byte crypto token and SHA-256 hash (L-33, B-49)
  const rawToken = generateRandomToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes (L-33, FR-06)
  const resetUrl = `https://${env.DEMO_HOST}/r/${rawToken}`;

  // 4. Create token, EmailMessage, and Outbox row in a single transaction (A-5, DB-12)
  const { outboxEntry } = await client.$transaction(async (tx) => {
    const resetRecord = await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        createdAt: now,
        expiresAt,
      },
    });

    const emailMessage = await tx.emailMessage.create({
      data: {
        template: 'password-reset',
        to: user.email,
        vars: {
          resetUrl,
          name: user.displayName,
        },
        status: 'QUEUED',
      },
    });

    const outbox = await writeOutbox(tx, {
      kind: 'email.send',
      sourceKey: `email:password-reset:${resetRecord.id}`,
      payload: {
        template: 'password-reset',
        to: user.email,
        vars: {
          resetUrl,
          name: user.displayName,
        },
        emailMessageId: emailMessage.id,
      },
    });

    return { outboxEntry: outbox };
  });

  // 5. Dispatch outbox entry after commit (A-5)
  await dispatchOutboxEntry(outboxEntry);
}

/**
 * Confirms a password reset using a reset link token (FR-06, PRD 7.2, L-15, L-33).
 * - Validates single-use token under 30 minutes old
 * - If expired, used, or invalid: throws 410 RESET_LINK_INVALID
 * - Hashes new password with Argon2id
 * - Marks token used and revokes all refresh tokens for user (FR-05, FR-06)
 * - Triggers RYOW on Shard 0 (PRD 7.5, AGENTS.md A-9)
 */
export async function confirmPasswordReset(input: PasswordResetConfirmBody): Promise<void> {
  const tokenHash = hashToken(input.token);

  const client = (
    '$$typeof' in dbShard0 || !('$primary' in dbShard0) ? dbShard0 : dbShard0.$primary()
  ) as typeof dbShard0;

  // 1. Fetch token record
  const record = await client.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record) {
    throw new AppError('RESET_LINK_INVALID', 410, 'Password reset link is invalid or expired');
  }

  // 2. Check if already used
  if (record.usedAt !== null) {
    throw new AppError('RESET_LINK_INVALID', 410, 'Password reset link is invalid or expired');
  }

  // 3. Check expiration (30 minutes)
  const now = new Date();
  if (record.expiresAt.getTime() < now.getTime()) {
    throw new AppError('RESET_LINK_INVALID', 410, 'Password reset link is invalid or expired');
  }

  // 4. Hash new password with Argon2id (L-15, SEC-2)
  const newPasswordHash = await hashPassword(input.password);

  // 5. Update password, mark token used, and revoke all user refresh tokens in one transaction
  await client.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash: newPasswordHash },
    });

    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    });

    await tx.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    });
  });

  // 6. Trigger RYOW on Shard 0 (PRD 7.5, AGENTS.md A-9)
  await markUserWrite(record.userId);
}
