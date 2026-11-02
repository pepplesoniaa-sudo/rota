import { NextRequest } from 'next/server';
import { logger } from '../log';
import { redis } from '../redis';

/**
 * Extracts client IP from Caddy's X-Forwarded-For header (L-34, SEC-13).
 * Always takes the last entry (the one Caddy appended), ignoring earlier untrusted client entries.
 */
export function getClientIp(req: NextRequest): string {
  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const parts = xForwardedFor.split(',').map((p) => p.trim());
    const lastPart = parts[parts.length - 1];
    if (lastPart) return lastPart;
  }
  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp) return xRealIp.trim();
  return '127.0.0.1';
}

export interface RateLimitCheckParams {
  scope: string;
  id: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
}

/**
 * Checks a rate limit counter in Redis (PRD 7.3, L-34).
 * Redis key: rl:{scope}:{id}:{windowSeconds}
 * Fails open if Redis is unreachable (PRD 7.3).
 */
export async function checkRateLimit(params: RateLimitCheckParams): Promise<RateLimitResult> {
  const key = `rl:${params.scope}:${params.id}:${params.windowSeconds}`;

  try {
    const current = await redis.get(key);
    const count = current ? parseInt(current, 10) : 0;
    const ttl = await redis.ttl(key);

    if (count >= params.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: ttl > 0 ? ttl : params.windowSeconds,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, params.limit - count),
    };
  } catch (err) {
    logger.warn({ err, key }, 'Redis rate limit check failed; failing open');
    return { allowed: true, remaining: 1 };
  }
}

/**
 * Increments rate limit attempt counter in Redis (e.g. on failed login attempt).
 */
export async function incrementRateLimit(params: RateLimitCheckParams): Promise<number> {
  const key = `rl:${params.scope}:${params.id}:${params.windowSeconds}`;

  try {
    const multi = redis.multi();
    multi.incr(key);
    multi.ttl(key);
    const results = await multi.exec();

    if (!results || !results[0]) return 1;

    const count = typeof results[0][1] === 'number' ? results[0][1] : 1;
    const ttl = typeof results[1]?.[1] === 'number' ? results[1][1] : -1;

    // If newly created key (TTL was -1), set expiration
    if (ttl === -1) {
      await redis.expire(key, params.windowSeconds);
    }

    return count;
  } catch (err) {
    logger.warn({ err, key }, 'Redis rate limit increment failed; ignoring');
    return 1;
  }
}

/**
 * Resets rate limit counter (e.g. on successful login).
 */
export async function resetRateLimit(
  scope: string,
  id: string,
  windowSeconds: number,
): Promise<void> {
  const key = `rl:${scope}:${id}:${windowSeconds}`;
  try {
    await redis.del(key);
  } catch (err) {
    logger.warn({ err, key }, 'Redis rate limit reset failed; ignoring');
  }
}
