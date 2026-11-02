import argon2 from 'argon2';

/**
 * Locked Argon2id hashing parameters (L-15, SEC-2, PRD 7.9):
 * - Type: Argon2id
 * - Memory cost: 19 MiB = 19456 KiB
 * - Time cost: 2 iterations
 * - Parallelism: 1 thread
 */
export const ARGON2_OPTIONS: argon2.Options & { type: 2 } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Hashes a plaintext password using Argon2id with locked parameters (L-15, SEC-2).
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 * Returns true if valid, false otherwise (never throws on mismatch).
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
