import { decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';
import { v7 as uuidv7 } from 'uuid';
import { AppError } from '@rota/shared';
import { env } from '../config/env';

export interface VerifiedAccessToken {
  userId: string;
  jti: string;
}

export interface AccessTokenOptions {
  secret?: string;
  kid?: string;
  expiresIn?: string;
}

/**
 * Creates an access token JWT (L-15, L-33, SEC-3, PRD 7.9).
 * - Alg: HS256
 * - Header: kid
 * - Claims: sub (userId), jti (UUID v7), iat, exp (15 min)
 * - Never includes team or role claims (B-18)
 */
export async function createAccessToken(
  userId: string,
  options?: AccessTokenOptions,
): Promise<string> {
  const secret = options?.secret ?? env.JWT_SECRET;
  const kid = options?.kid ?? env.JWT_KID;
  const expiresIn = options?.expiresIn ?? '15m';

  const secretKey = new TextEncoder().encode(secret);

  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', kid })
    .setSubject(userId)
    .setJti(uuidv7())
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);
}

/**
 * Verifies an access token JWT (SEC-3, PRD 7.9).
 * - Fixed algorithm HS256 only
 * - Matches kid to current or previous secret
 * - Rejects unknown kid, missing exp, or missing sub with 401
 */
export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  let header: { alg?: string; kid?: string };
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid token structure');
  }

  if (header.alg !== 'HS256') {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid token algorithm');
  }

  const kid = header.kid;
  if (!kid) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Missing token kid header');
  }

  // Resolve secret by kid (SEC-3, PRD 7.9)
  let secret: string | undefined;
  if (kid === env.JWT_KID) {
    secret = env.JWT_SECRET;
  } else if (kid === env.JWT_PREVIOUS_KID && env.JWT_PREVIOUS_SECRET) {
    secret = env.JWT_PREVIOUS_SECRET;
  }

  if (!secret) {
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Unknown or inactive token kid');
  }

  const secretKey = new TextEncoder().encode(secret);

  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });

    const sub = payload.sub;
    const exp = payload.exp;

    if (!sub || typeof sub !== 'string' || sub.trim().length === 0) {
      throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Missing token subject');
    }

    if (typeof exp !== 'number') {
      throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Missing token expiration');
    }

    return {
      userId: sub,
      jti: typeof payload.jti === 'string' ? payload.jti : '',
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    if (err && typeof err === 'object' && 'code' in err) {
      if (err.code === 'ERR_JWT_EXPIRED') {
        throw new AppError('AUTH_TOKEN_EXPIRED', 401, 'Access token expired');
      }
    }
    throw new AppError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid access token signature');
  }
}
