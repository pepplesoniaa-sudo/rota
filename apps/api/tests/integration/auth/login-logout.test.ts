import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as loginRoute } from '../../../app/v1/auth/login/route';
import { POST as logoutRoute } from '../../../app/v1/auth/logout/route';
import { POST as logoutAllRoute } from '../../../app/v1/auth/logout-all/route';
import { createAccessToken } from '../../../lib/auth/jwt';
import { hashPassword } from '../../../lib/auth/password';
import { createRefreshToken, rotateRefreshToken } from '../../../lib/auth/refresh';

interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
}

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

let mockUsers: MockUser[] = [];
let mockRefreshTokens: MockRefreshToken[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../lib/db', () => {
  const mockUserDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) {
        const found = mockUsers.find((u) => u.email === where.email);
        return found ? { ...found } : null;
      }
      if (where.id) {
        const found = mockUsers.find((u) => u.id === where.id);
        return found ? { ...found } : null;
      }
      return null;
    }),
  };

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
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<MockRefreshToken>;
      }) => {
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
    user: mockUserDelegate,
    refreshToken: mockRefreshTokenDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        user: mockUserDelegate,
        refreshToken: mockRefreshTokenDelegate,
      }),
    ),
    $primary: () => mockDbClient,
  };

  return {
    dbShard0: mockDbClient,
    dbShard1: mockDbClient,
    getShardClient: () => mockDbClient,
  };
});

vi.mock('../../../lib/redis', () => {
  const mockRedisClient = {
    get: vi.fn(async (key: string) => {
      const entry = mockRedisStore.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expireAt) {
        mockRedisStore.delete(key);
        return null;
      }
      return entry.value;
    }),
    ttl: vi.fn(async (key: string) => {
      const entry = mockRedisStore.get(key);
      if (!entry) return -2;
      const remainingSeconds = Math.max(0, Math.ceil((entry.expireAt - Date.now()) / 1000));
      return remainingSeconds;
    }),
    del: vi.fn(async (key: string) => {
      mockRedisStore.delete(key);
      return 1;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      const entry = mockRedisStore.get(key);
      if (entry) {
        entry.expireAt = Date.now() + seconds * 1000;
      }
      return 1;
    }),
    multi: vi.fn(() => {
      const operations: (() => void)[] = [];
      let countResult = 0;
      let ttlResult = -1;

      return {
        incr(key: string) {
          operations.push(() => {
            const entry = mockRedisStore.get(key);
            let current = 0;
            if (entry && Date.now() <= entry.expireAt) {
              current = parseInt(entry.value, 10);
            }
            const next = current + 1;
            mockRedisStore.set(key, {
              value: String(next),
              expireAt: entry ? entry.expireAt : Date.now() + 900 * 1000,
            });
            countResult = next;
          });
          return this;
        },
        ttl(key: string) {
          operations.push(() => {
            const entry = mockRedisStore.get(key);
            if (!entry) {
              ttlResult = -2;
            } else {
              ttlResult = Math.max(0, Math.ceil((entry.expireAt - Date.now()) / 1000));
            }
          });
          return this;
        },
        async exec() {
          for (const op of operations) op();
          return [
            [null, countResult],
            [null, ttlResult],
          ];
        },
      };
    }),
  };

  return {
    redis: mockRedisClient,
  };
});

function createPostRequest(
  url: string,
  body: unknown,
  options?: { ip?: string; token?: string },
): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options?.ip) {
    headers['x-forwarded-for'] = options.ip;
  }
  if (options?.token) {
    headers['authorization'] = `Bearer ${options.token}`;
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const mockContext = { params: Promise.resolve({}) };

describe('FR-02 & FR-03: User Login and Logout', () => {
  const testUserId = '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e';
  const testEmail = 'staff.member@clinic.org';
  const testPassword = 'CorrectPassword123!';

  beforeEach(async () => {
    mockUsers = [];
    mockRefreshTokens = [];
    mockRedisStore.clear();

    const passwordHash = await hashPassword(testPassword);
    mockUsers.push({
      id: testUserId,
      email: testEmail,
      passwordHash,
      displayName: 'Staff Member',
    });
  });

  describe('FR-02: Login Flow', () => {
    it('FR-02: Given correct credentials, returns access token, refresh token, and user info', async () => {
      const req = createPostRequest(
        'http://localhost:3000/v1/auth/login',
        {
          email: 'STAFF.MEMBER@CLINIC.ORG', // Case insensitive check
          password: testPassword,
          deviceName: 'Pixel 9',
        },
        { ip: '198.51.100.42' },
      );

      const res = await loginRoute(req, mockContext);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.accessToken).toBeDefined();
      expect(json.refreshToken).toHaveLength(43);
      expect(json.user).toEqual({
        id: testUserId,
        email: testEmail,
        displayName: 'Staff Member',
      });

      // Verify a refresh token record was created
      expect(mockRefreshTokens).toHaveLength(1);
      expect(mockRefreshTokens[0]?.userId).toBe(testUserId);
      expect(mockRefreshTokens[0]?.deviceName).toBe('Pixel 9');
    });

    it('FR-02: Given wrong password, returns 401 AUTH_INVALID_CREDENTIALS', async () => {
      const req = createPostRequest(
        'http://localhost:3000/v1/auth/login',
        {
          email: testEmail,
          password: 'WrongPassword!',
        },
        { ip: '198.51.100.42' },
      );

      const res = await loginRoute(req, mockContext);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(json.error.message).toBe('Invalid email or password');
    });

    it('FR-02: Given non-existent email, returns identical 401 AUTH_INVALID_CREDENTIALS message', async () => {
      const req = createPostRequest(
        'http://localhost:3000/v1/auth/login',
        {
          email: 'unknown.user@clinic.org',
          password: 'SomePassword123!',
        },
        { ip: '198.51.100.42' },
      );

      const res = await loginRoute(req, mockContext);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(json.error.message).toBe('Invalid email or password');
    });

    it('FR-02 & L-34: Given 5 failed attempts for one email and IP pair, next attempt returns 429 RATE_LIMITED with Retry-After', async () => {
      const ip = '203.0.113.195';

      // 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        const req = createPostRequest(
          'http://localhost:3000/v1/auth/login',
          { email: testEmail, password: `WrongAttempt${i}` },
          { ip },
        );
        const res = await loginRoute(req, mockContext);
        expect(res.status).toBe(401);
      }

      // 6th attempt (even with correct password) gets 429 RATE_LIMITED
      const blockedReq = createPostRequest(
        'http://localhost:3000/v1/auth/login',
        { email: testEmail, password: testPassword },
        { ip },
      );
      const blockedRes = await loginRoute(blockedReq, mockContext);
      expect(blockedRes.status).toBe(429);

      const json = await blockedRes.json();
      expect(json.error.code).toBe('RATE_LIMITED');
      expect(blockedRes.headers.get('Retry-After')).toBeDefined();

      // Another IP for the same email is NOT blocked
      const differentIpReq = createPostRequest(
        'http://localhost:3000/v1/auth/login',
        { email: testEmail, password: testPassword },
        { ip: '198.51.100.99' },
      );
      const differentIpRes = await loginRoute(differentIpReq, mockContext);
      expect(differentIpRes.status).toBe(200);
    });

    it('FR-02: Successful login resets failed attempts counter', async () => {
      const ip = '203.0.113.50';

      // 3 failed attempts
      for (let i = 0; i < 3; i++) {
        const req = createPostRequest(
          'http://localhost:3000/v1/auth/login',
          { email: testEmail, password: 'WrongPassword' },
          { ip },
        );
        await loginRoute(req, mockContext);
      }

      // Successful login resets counter
      const successReq = createPostRequest(
        'http://localhost:3000/v1/auth/login',
        { email: testEmail, password: testPassword },
        { ip },
      );
      const successRes = await loginRoute(successReq, mockContext);
      expect(successRes.status).toBe(200);

      // Verify counter in Redis was cleared
      const rlKey = `rl:login:${testEmail}:${ip}:900`;
      expect(mockRedisStore.has(rlKey)).toBe(false);
    });
  });

  describe('FR-03: Single Logout & Logout Everywhere', () => {
    it('FR-03: POST /v1/auth/logout revokes the current device refresh token', async () => {
      const tokenSession = await createRefreshToken({
        userId: testUserId,
        deviceName: 'Mobile App',
      });
      const accessToken = await createAccessToken(testUserId);

      const req = createPostRequest(
        'http://localhost:3000/v1/auth/logout',
        { refreshToken: tokenSession.rawToken },
        { token: accessToken },
      );

      const res = await logoutRoute(req, mockContext);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Verifying rotation fails with 401 AUTH_REFRESH_REVOKED
      await expect(
        rotateRefreshToken({ rawToken: tokenSession.rawToken }),
      ).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REVOKED',
        status: 401,
      });
    });

    it('FR-03: POST /v1/auth/logout-all revokes all user refresh tokens (Logout everywhere)', async () => {
      const session1 = await createRefreshToken({
        userId: testUserId,
        deviceName: 'Device 1',
      });
      const session2 = await createRefreshToken({
        userId: testUserId,
        deviceName: 'Device 2',
      });
      const accessToken = await createAccessToken(testUserId);

      const req = createPostRequest(
        'http://localhost:3000/v1/auth/logout-all',
        {},
        { token: accessToken },
      );

      const res = await logoutAllRoute(req, mockContext);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Both tokens are revoked
      await expect(
        rotateRefreshToken({ rawToken: session1.rawToken }),
      ).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REVOKED',
        status: 401,
      });

      await expect(
        rotateRefreshToken({ rawToken: session2.rawToken }),
      ).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REVOKED',
        status: 401,
      });
    });

    it('SEC-1: Rejects unauthenticated logout calls with 401 AUTH_TOKEN_EXPIRED', async () => {
      const req = createPostRequest('http://localhost:3000/v1/auth/logout', {
        refreshToken: 'some-token',
      });

      const res = await logoutRoute(req, mockContext);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });
  });
});

