import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as refreshRoute } from '../../../app/v1/auth/refresh/route';
import { verifyAccessToken } from '../../../lib/auth/jwt';
import { createRefreshToken, rotateRefreshToken } from '../../../lib/auth/refresh';

interface MockRefreshToken {
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

let mockRefreshTokens: MockRefreshToken[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../lib/db', () => {
  const mockRefreshTokenDelegate = {
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<MockRefreshToken, 'id' | 'rotatedAt' | 'revokedAt' | 'replacedById'>;
      }) => {
        const token: MockRefreshToken = {
          id: `rt-${mockRefreshTokens.length + 1}`,
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
        mockRefreshTokens.push(token);
        return token;
      },
    ),

    findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
      const found = mockRefreshTokens.find((t) => t.tokenHash === where.tokenHash);
      return found ? { ...found } : null;
    }),

    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<MockRefreshToken> }) => {
        const found = mockRefreshTokens.find((t) => t.id === where.id);
        if (found) Object.assign(found, data);
        return found ? { ...found } : null;
      },
    ),

    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: {
          tokenHash?: string;
          userId?: string;
          familyId?: string;
          revokedAt?: null;
        };
        data: Partial<MockRefreshToken>;
      }) => {
        let count = 0;
        for (const t of mockRefreshTokens) {
          let match = true;
          if (where.tokenHash && t.tokenHash !== where.tokenHash) match = false;
          if (where.userId && t.userId !== where.userId) match = false;
          if (where.familyId && t.familyId !== where.familyId) match = false;
          if (where.revokedAt === null && t.revokedAt !== null) match = false;
          if (match) {
            Object.assign(t, data);
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
      cb({
        refreshToken: mockRefreshTokenDelegate,
      }),
    ),
    $primary: vi.fn(() => ({
      refreshToken: mockRefreshTokenDelegate,
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          refreshToken: mockRefreshTokenDelegate,
        }),
      ),
    })),
  };

  return {
    dbShard0: mockDbClient,
    getDbShard0: () => mockDbClient,
  };
});

vi.mock('../../../lib/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      const entry = mockRedisStore.get(key);
      if (!entry) return null;
      if (entry.expireAt && entry.expireAt < Date.now()) {
        mockRedisStore.delete(key);
        return null;
      }
      return entry.value;
    }),
    set: vi.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
      let expireAt = 0;
      if (mode === 'EX' && ttl) {
        expireAt = Date.now() + ttl * 1000;
      }
      mockRedisStore.set(key, { value, expireAt });
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      mockRedisStore.delete(key);
      return 1;
    }),
  },
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/v1/auth/refresh', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/auth/refresh (FR-03)', () => {
  const testUserId = '018f3a2b-1111-7000-8000-000000000001';

  beforeEach(() => {
    mockRefreshTokens = [];
    mockRedisStore.clear();
    vi.clearAllMocks();
  });

  it('FR-03: given a valid refresh token, rotates token and returns 200 with new pair in the same family', async () => {
    const session = await createRefreshToken({
      userId: testUserId,
      deviceName: 'iPhone 15',
    });

    const req = makeRequest({ refreshToken: session.rawToken });
    const res = await refreshRoute(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
    };

    expect(data.accessToken).toBeDefined();
    expect(data.refreshToken).toBeDefined();
    expect(data.refreshToken).not.toBe(session.rawToken);

    // Verify access token is valid and contains user id
    const verified = await verifyAccessToken(data.accessToken);
    expect(verified.userId).toBe(testUserId);

    // Verify old token was marked rotated
    const oldToken = mockRefreshTokens.find((t) => t.id === session.record.id);
    if (!oldToken) throw new Error('Old token missing');
    expect(oldToken.rotatedAt).not.toBeNull();
    expect(oldToken.replacedById).toBeDefined();

    // Verify new token exists with same familyId
    const newToken = mockRefreshTokens.find((t) => t.id === oldToken.replacedById);
    if (!newToken) throw new Error('New token missing');
    expect(newToken.familyId).toBe(session.record.familyId);
    expect(newToken.userId).toBe(testUserId);
  });

  it('FR-03: given a refresh token rotated <= 30 seconds ago, treats as retry, revokes successor and reissues', async () => {
    const session = await createRefreshToken({
      userId: testUserId,
      deviceName: 'Pixel 8',
    });

    // First rotation
    const firstRotation = await rotateRefreshToken({ rawToken: session.rawToken });
    const successorId = mockRefreshTokens.find((t) => t.id === session.record.id)?.replacedById;
    expect(successorId).toBeDefined();

    // Call refresh again with the original token within 30 seconds
    const req = makeRequest({ refreshToken: session.rawToken });
    const res = await refreshRoute(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      accessToken: string;
      refreshToken: string;
    };

    expect(data.refreshToken).toBeDefined();
    expect(data.refreshToken).not.toBe(firstRotation.rawRefreshToken);

    // Verify the previous successor was revoked
    const revokedSuccessor = mockRefreshTokens.find((t) => t.id === successorId);
    if (!revokedSuccessor) throw new Error('Successor missing');
    expect(revokedSuccessor.revokedAt).not.toBeNull();

    // Verify the replacedById pointer on original token was updated to the new token
    const originalToken = mockRefreshTokens.find((t) => t.id === session.record.id);
    if (!originalToken) throw new Error('Original token missing');
    expect(originalToken.replacedById).not.toBe(successorId);
  });

  it('FR-03: given a refresh token rotated > 30 seconds ago, revokes entire family and returns 401 AUTH_REFRESH_REUSED', async () => {
    const session = await createRefreshToken({
      userId: testUserId,
    });

    // Rotate the token
    await rotateRefreshToken({ rawToken: session.rawToken });

    // Simulate 35 seconds elapsed
    const originalToken = mockRefreshTokens.find((t) => t.id === session.record.id);
    if (!originalToken) throw new Error('Original token missing');
    originalToken.rotatedAt = new Date(Date.now() - 35 * 1000);

    const req = makeRequest({ refreshToken: session.rawToken });
    const res = await refreshRoute(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    const data = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(data.error.code).toBe('AUTH_REFRESH_REUSED');

    // Verify all tokens in the family are now revoked
    const familyTokens = mockRefreshTokens.filter((t) => t.familyId === session.record.familyId);
    expect(familyTokens.length).toBeGreaterThanOrEqual(2);
    for (const t of familyTokens) {
      expect(t.revokedAt).not.toBeNull();
    }
  });

  it('FR-03: given a revoked refresh token, returns 401 AUTH_REFRESH_REVOKED', async () => {
    const session = await createRefreshToken({
      userId: testUserId,
    });

    // Revoke the token (e.g. from single logout)
    const stored = mockRefreshTokens.find((t) => t.id === session.record.id);
    if (!stored) throw new Error('Stored token missing');
    stored.revokedAt = new Date();

    const req = makeRequest({ refreshToken: session.rawToken });
    const res = await refreshRoute(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    const data = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(data.error.code).toBe('AUTH_REFRESH_REVOKED');
  });

  it('FR-03: given an expired refresh token, returns 401 AUTH_TOKEN_EXPIRED', async () => {
    const session = await createRefreshToken({
      userId: testUserId,
    });

    // Expire the token (past 30 days)
    const stored = mockRefreshTokens.find((t) => t.id === session.record.id);
    if (!stored) throw new Error('Stored token missing');
    stored.expiresAt = new Date(Date.now() - 1000);

    const req = makeRequest({ refreshToken: session.rawToken });
    const res = await refreshRoute(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    const data = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(data.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('FR-03: given an invalid or unknown refresh token, returns 401 AUTH_INVALID_CREDENTIALS', async () => {
    const req = makeRequest({ refreshToken: 'nonexistent-token-value-1234567890' });
    const res = await refreshRoute(req, { params: Promise.resolve({}) });

    expect(res.status).toBe(401);
    const data = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(data.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('FR-03: given malformed body or extra fields, returns 400 VALIDATION_FAILED', async () => {
    // Missing refreshToken
    const resMissing = await refreshRoute(makeRequest({}), { params: Promise.resolve({}) });
    expect(resMissing.status).toBe(400);
    const dataMissing = (await resMissing.json()) as {
      error: { code: string; message: string };
    };
    expect(dataMissing.error.code).toBe('VALIDATION_FAILED');

    // Unknown field (strict check CS-10)
    const resExtra = await refreshRoute(
      makeRequest({ refreshToken: 'valid-format-token', unexpectedField: 'bad' }),
      { params: Promise.resolve({}) },
    );
    expect(resExtra.status).toBe(400);
    const dataExtra = (await resExtra.json()) as {
      error: { code: string; message: string };
    };
    expect(dataExtra.error.code).toBe('VALIDATION_FAILED');
  });
});

