import { describe, expect, it, vi, beforeEach } from 'vitest';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { AppError } from '@rota/shared';
import { ARGON2_OPTIONS, hashPassword, verifyPassword } from '../../lib/auth/password';
import { createAccessToken, verifyAccessToken } from '../../lib/auth/jwt';
import { generateRandomToken, hashToken } from '../../lib/auth/tokens';
import {
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
} from '../../lib/auth/refresh';
import { env } from '../../lib/config/env';

// In-memory mock store for refresh tokens
interface MockRefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  deviceName: string | null;
  createdAt: Date;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  replacedById: string | null;
}

let mockTokenStore: MockRefreshTokenRecord[] = [];

vi.mock('../../lib/db', () => {
  const mockRefreshTokenDelegate = {
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<MockRefreshTokenRecord, 'id' | 'rotatedAt' | 'revokedAt' | 'replacedById'>;
      }) => {
        const record: MockRefreshTokenRecord = {
          id: `mock-id-${mockTokenStore.length + 1}`,
          userId: data.userId,
          familyId: data.familyId,
          tokenHash: data.tokenHash,
          deviceName: data.deviceName ?? null,
          createdAt: data.createdAt,
          expiresAt: data.expiresAt,
          rotatedAt: null,
          revokedAt: null,
          replacedById: null,
        };
        mockTokenStore.push(record);
        return record;
      },
    ),

    findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
      const found = mockTokenStore.find((t) => t.tokenHash === where.tokenHash);
      return found ? { ...found } : null;
    }),

    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<MockRefreshTokenRecord> }) => {
        const item = mockTokenStore.find((t) => t.id === where.id);
        if (!item) throw new Error('Not found');
        Object.assign(item, data);
        return { ...item };
      },
    ),

    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: {
          id?: string;
          familyId?: string;
          userId?: string;
          tokenHash?: string;
          revokedAt?: null;
        };
        data: Partial<MockRefreshTokenRecord>;
      }) => {
        let count = 0;
        for (const item of mockTokenStore) {
          let match = true;
          if (where.id && item.id !== where.id) match = false;
          if (where.familyId && item.familyId !== where.familyId) match = false;
          if (where.userId && item.userId !== where.userId) match = false;
          if (where.tokenHash && item.tokenHash !== where.tokenHash) match = false;
          if (where.revokedAt === null && item.revokedAt !== null) match = false;

          if (match) {
            Object.assign(item, data);
            count++;
          }
        }
        return { count };
      },
    ),
  };

  const mockDbClient = {
    refreshToken: mockRefreshTokenDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ refreshToken: mockRefreshTokenDelegate }),
    ),
    $primary: () => mockDbClient,
  };

  return {
    dbShard0: mockDbClient,
    dbShard1: mockDbClient,
    getShardClient: () => mockDbClient,
  };
});

describe('1. Password Hashing (Argon2id) (L-15, SEC-2)', () => {
  it('uses locked parameters (19 MiB memory, 2 iterations, parallelism 1)', () => {
    expect(ARGON2_OPTIONS.type).toBe(2); // argon2id
    expect(ARGON2_OPTIONS.memoryCost).toBe(19456); // 19 MiB
    expect(ARGON2_OPTIONS.timeCost).toBe(2);
    expect(ARGON2_OPTIONS.parallelism).toBe(1);
  });

  it('hashes password and verifies matching password', async () => {
    const plain = 'StrongP@ssw0rd123!';
    const hash = await hashPassword(plain);

    expect(hash).toContain('$argon2id$');
    expect(hash).toContain('m=19456,t=2,p=1');

    const isValid = await verifyPassword(hash, plain);
    expect(isValid).toBe(true);

    const isWrongValid = await verifyPassword(hash, 'WrongPassword123!');
    expect(isWrongValid).toBe(false);
  });

  it('verifyPassword gracefully returns false on corrupted hash without throwing', async () => {
    const result = await verifyPassword('not-a-valid-argon-hash', 'some-pass');
    expect(result).toBe(false);
  });
});

describe('2. JWT Access Tokens (L-15, L-33, SEC-3, B-18)', () => {
  const userId = '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e';

  it('creates an access token with HS256, kid header, and 15 min expiry without role/team claims', async () => {
    const token = await createAccessToken(userId);

    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe('HS256');
    expect(header.kid).toBe(env.JWT_KID);

    const payload = decodeJwt(token);
    expect(payload.sub).toBe(userId);
    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe('string');
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeDefined();

    // 15 minutes lifetime = 900 seconds
    const lifetime = (payload.exp as number) - (payload.iat as number);
    expect(lifetime).toBe(900);

    // B-18: Never put team or role claims in JWT
    expect(payload['teamId']).toBeUndefined();
    expect(payload['role']).toBeUndefined();
    expect(payload['roles']).toBeUndefined();
    expect(payload['permissions']).toBeUndefined();
  });

  it('verifies a valid access token and extracts userId and jti', async () => {
    const token = await createAccessToken(userId);
    const verified = await verifyAccessToken(token);

    expect(verified.userId).toBe(userId);
    expect(verified.jti).toBeDefined();
  });

  it('verifies a token signed with previous secret when kid matches JWT_PREVIOUS_KID', async () => {
    // Override previous secret in env for this test
    const previousSecret = 'previous-super-secret-key-at-least-32-chars!';
    const previousKid = 'prev-kid';
    (env as { JWT_PREVIOUS_SECRET?: string; JWT_PREVIOUS_KID: string }).JWT_PREVIOUS_SECRET =
      previousSecret;
    (env as { JWT_PREVIOUS_SECRET?: string; JWT_PREVIOUS_KID: string }).JWT_PREVIOUS_KID =
      previousKid;

    const token = await createAccessToken(userId, {
      secret: previousSecret,
      kid: previousKid,
    });

    const verified = await verifyAccessToken(token);
    expect(verified.userId).toBe(userId);
  });

  it('rejects an unknown kid with 401 AUTH_INVALID_CREDENTIALS (SEC-3)', async () => {
    const token = await createAccessToken(userId, {
      secret: env.JWT_SECRET,
      kid: 'unknown-mystery-kid',
    });

    await expect(verifyAccessToken(token)).rejects.toThrow(AppError);
    await expect(verifyAccessToken(token)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
    });
  });

  it('rejects an expired token with 401 AUTH_TOKEN_EXPIRED', async () => {
    const expiredToken = await createAccessToken(userId, {
      expiresIn: '-10s',
    });

    await expect(verifyAccessToken(expiredToken)).rejects.toThrow(AppError);
    await expect(verifyAccessToken(expiredToken)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_EXPIRED',
      status: 401,
    });
  });

  it('rejects token with invalid signature with 401 AUTH_INVALID_CREDENTIALS', async () => {
    const forgedToken = await createAccessToken(userId, {
      secret: 'an-attacker-crafted-secret-that-does-not-match-at-all!',
      kid: env.JWT_KID,
    });

    await expect(verifyAccessToken(forgedToken)).rejects.toThrow(AppError);
    await expect(verifyAccessToken(forgedToken)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
    });
  });

  it('rejects a malformed token string with 401 AUTH_INVALID_CREDENTIALS', async () => {
    await expect(verifyAccessToken('not.a.valid.jwt.string')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
    });
  });
});

describe('3. Opaque Tokens & Hashes (L-33, B-49)', () => {
  it('generates 32-byte base64url random tokens (43 chars) that are unique', () => {
    const t1 = generateRandomToken();
    const t2 = generateRandomToken();

    expect(typeof t1).toBe('string');
    expect(t1.length).toBe(43); // 32 bytes in base64url = 43 chars
    expect(t1).not.toBe(t2);
  });

  it('computes 64-char SHA-256 hex digest deterministically', () => {
    const token = 'sample-random-opaque-token-string';
    const h1 = hashToken(token);
    const h2 = hashToken(token);

    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);
    expect(/^[0-9a-f]{64}$/.test(h1)).toBe(true);
  });
});

describe('4. Refresh Token Rotation & Session Lifecycle (L-33, B-50, PRD 7.9, FR-03, FR-04)', () => {
  const userId = '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e';

  beforeEach(() => {
    mockTokenStore = [];
  });

  it('creates an initial refresh token with 30-day lifetime and stores SHA-256 hash', async () => {
    const { rawToken, record } = await createRefreshToken({
      userId,
      deviceName: 'iPhone 15 Pro',
    });

    expect(rawToken).toBeDefined();
    expect(record.tokenHash).toBe(hashToken(rawToken));
    expect(record.userId).toBe(userId);
    expect(record.deviceName).toBe('iPhone 15 Pro');
    expect(record.familyId).toBeDefined();
    expect(record.rotatedAt).toBeNull();
    expect(record.revokedAt).toBeNull();

    // 30 days lifetime
    const expectedExpiry = record.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(record.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -3);
  });

  it('cleanly rotates a valid refresh token on first use', async () => {
    const { rawToken: initialRaw } = await createRefreshToken({ userId });

    const result = await rotateRefreshToken({
      rawToken: initialRaw,
      deviceName: 'Pixel 9',
    });

    expect(result.userId).toBe(userId);
    expect(result.accessToken).toBeDefined();
    expect(result.rawRefreshToken).toBeDefined();
    expect(result.rawRefreshToken).not.toBe(initialRaw);

    // Old token should be marked rotated
    const oldHash = hashToken(initialRaw);
    const oldRecord = mockTokenStore.find((t) => t.tokenHash === oldHash);
    expect(oldRecord?.rotatedAt).not.toBeNull();
    expect(oldRecord?.replacedById).toBeDefined();

    // New token exists in same family
    const newHash = hashToken(result.rawRefreshToken);
    const newRecord = mockTokenStore.find((t) => t.tokenHash === newHash);
    expect(newRecord?.familyId).toBe(oldRecord?.familyId);
  });

  it('allows mobile retry within 30-second grace window (FR-03)', async () => {
    const { rawToken: initialRaw } = await createRefreshToken({ userId });

    // First rotation
    const firstRotation = await rotateRefreshToken({ rawToken: initialRaw });

    // Simulate network retry: old token reused 10 seconds later (< 30s grace window)
    const oldRecord = mockTokenStore.find((t) => t.tokenHash === hashToken(initialRaw));
    if (oldRecord) {
      oldRecord.rotatedAt = new Date(Date.now() - 10 * 1000); // 10s ago
    }

    const retryResult = await rotateRefreshToken({ rawToken: initialRaw });

    expect(retryResult.accessToken).toBeDefined();
    expect(retryResult.rawRefreshToken).toBeDefined();

    // The intermediate token from firstRotation should be revoked
    const intermediateHash = hashToken(firstRotation.rawRefreshToken);
    const intermediateRecord = mockTokenStore.find((t) => t.tokenHash === intermediateHash);
    expect(intermediateRecord?.revokedAt).not.toBeNull();
  });

  it('detects theft on token reuse after 30-second grace window, revokes family, and throws 401 AUTH_REFRESH_REUSED (B-50)', async () => {
    const { rawToken: initialRaw } = await createRefreshToken({ userId });

    // Rotate once
    await rotateRefreshToken({ rawToken: initialRaw });

    // Simulate reuse after 35 seconds (> 30s grace window)
    const oldRecord = mockTokenStore.find((t) => t.tokenHash === hashToken(initialRaw));
    if (oldRecord) {
      oldRecord.rotatedAt = new Date(Date.now() - 35 * 1000); // 35s ago
    }

    await expect(rotateRefreshToken({ rawToken: initialRaw })).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSED',
      status: 401,
    });

    // Entire family must now be revoked
    const familyTokens = mockTokenStore.filter((t) => t.familyId === oldRecord?.familyId);
    expect(familyTokens.length).toBeGreaterThan(0);
    for (const t of familyTokens) {
      expect(t.revokedAt).not.toBeNull();
    }
  });

  it('rejects an already-revoked refresh token with 401 AUTH_REFRESH_REVOKED', async () => {
    const { rawToken } = await createRefreshToken({ userId });
    await revokeRefreshToken(rawToken);

    await expect(rotateRefreshToken({ rawToken })).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REVOKED',
      status: 401,
    });
  });

  it('rejects an expired refresh token with 401 AUTH_TOKEN_EXPIRED', async () => {
    const { rawToken, record } = await createRefreshToken({ userId });
    // Manually set expiry in the past
    const inStore = mockTokenStore.find((t) => t.id === record.id);
    if (inStore) {
      inStore.expiresAt = new Date(Date.now() - 1000);
    }

    await expect(rotateRefreshToken({ rawToken })).rejects.toMatchObject({
      code: 'AUTH_TOKEN_EXPIRED',
      status: 401,
    });
  });

  it('rejects an unknown refresh token with 401 AUTH_INVALID_CREDENTIALS', async () => {
    await expect(
      rotateRefreshToken({ rawToken: 'completely-unknown-token' }),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
    });
  });

  it('supports "Log out everywhere" by revoking all user tokens (FR-03)', async () => {
    const session1 = await createRefreshToken({ userId, deviceName: 'Phone' });
    const session2 = await createRefreshToken({ userId, deviceName: 'Tablet' });

    await revokeAllUserRefreshTokens(userId);

    const token1 = mockTokenStore.find((t) => t.tokenHash === hashToken(session1.rawToken));
    const token2 = mockTokenStore.find((t) => t.tokenHash === hashToken(session2.rawToken));

    expect(token1?.revokedAt).not.toBeNull();
    expect(token2?.revokedAt).not.toBeNull();
  });
});
