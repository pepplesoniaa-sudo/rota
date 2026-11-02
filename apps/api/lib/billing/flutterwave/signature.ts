import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';

/**
 * B-10: Constant-time comparison of verif-hash against FLW_SECRET_HASH.
 * Uses SHA-256 digest hashing before timingSafeEqual to prevent length-leak timing attacks.
 */
export function verifyWebhookSignature(headerHash: string | null | undefined): boolean {
  if (!headerHash || typeof headerHash !== 'string') {
    return false;
  }

  const expectedDigest = createHash('sha256').update(env.FLW_SECRET_HASH).digest();
  const incomingDigest = createHash('sha256').update(headerHash).digest();

  return timingSafeEqual(expectedDigest, incomingDigest);
}
