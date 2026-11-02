import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKeyBuffer(): Buffer {
  return Buffer.from(env.CARD_ENCRYPTION_KEY, 'hex');
}

/**
 * B-17 & PRD 7.10: Encrypt card tokens with AES-256-GCM before storage.
 * Serializes as iv:authTag:ciphertext (hex).
 */
export function encryptCardToken(token: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKeyBuffer(), iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted card token.
 */
export function decryptCardToken(encryptedPayload: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error('Invalid encrypted card token format');
  }

  const ivHex = parts[0];
  const authTagHex = parts[1];
  const ciphertextHex = parts[2];

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, getKeyBuffer(), iv);
  decipher.setAuthTag(authTag);

  const decryptedUpdate = decipher.update(ciphertextHex, 'hex', 'utf8');
  const decryptedFinal = decipher.final('utf8');

  return `${decryptedUpdate}${decryptedFinal}`;
}
