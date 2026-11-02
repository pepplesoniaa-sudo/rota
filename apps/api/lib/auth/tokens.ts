import crypto from 'node:crypto';

/**
 * Generates a cryptographically secure 32-byte opaque token, base64url encoded (L-33, PRD 7.9).
 */
export function generateRandomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Computes the SHA-256 hex digest of a token string (L-33, B-49).
 * Only this hash is stored in the database.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
