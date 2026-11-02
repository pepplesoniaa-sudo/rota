import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as confirmRoute } from '../../../app/v1/auth/password-reset/confirm/route';
import { POST as requestRoute } from '../../../app/v1/auth/password-reset/request/route';
import { hashPassword, verifyPassword } from '../../../lib/auth/password';
import { createRefreshToken } from '../../../lib/auth/refresh';
import { generateRandomToken, hashToken } from '../../../lib/auth/tokens';

interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
}

interface MockPasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

interface MockEmailMessage {
  id: string;
  template: string;
  to: string;
  vars: Record<string, unknown>;
  status: string;
}

interface MockOutbox {
  id: string;
  kind: string;
  sourceKey: string;
  payload: Record<string, unknown>;
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
let mockResetTokens: MockPasswordResetToken[] = [];
let mockEmailMessages: MockEmailMessage[] = [];
let mockOutboxEntries: MockOutbox[] = [];
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
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MockUser> }) => {
      const found = mockUsers.find((u) => u.id === where.id);
      if (found) Object.assign(found, data);
      return found ? { ...found } : null;
    }),
  };

  const mockResetTokenDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockPasswordResetToken, 'id' | 'usedAt'> }) => {
      const record: MockPasswordResetToken = {
        id: `018f3a2b-0000-7000-8001-${String(mockResetTokens.length + 1).padStart(12, '0')}`,
        userId: data.userId,
        tokenHash: data.tokenHash,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        usedAt: null,
      };
      mockResetTokens.push(record);
      return record;
    }),
    findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
      const found = mockResetTokens.find((t) => t.tokenHash === where.tokenHash);
      return found ? { ...found } : null;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<MockPasswordResetToken> }) => {
        const found = mockResetTokens.find((t) => t.id === where.id);
        if (found) Object.assign(found, data);
        return found ? { ...found } : null;
      },
    ),
  };

  const mockEmailMessageDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockEmailMessage, 'id'> }) => {
      const record: MockEmailMessage = {
        id: `018f3a2b-0000-7000-8002-${String(mockEmailMessages.length + 1).padStart(12, '0')}`,
        template: data.template,
        to: data.to,
        vars: data.vars,
        status: data.status,
      };
      mockEmailMessages.push(record);
      return record;
    }),
  };

  const mockOutboxDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockOutbox, 'id'> }) => {
      const record: MockOutbox = {
        id: `018f3a2b-0000-7000-8003-${String(mockOutboxEntries.length + 1).padStart(12, '0')}`,
        kind: data.kind,
        sourceKey: data.sourceKey,
        payload: data.payload as Record<string, unknown>,
      };
      mockOutboxEntries.push(record);
      return record;
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
          id: `018f3a2b-0000-7000-8004-${String(mockRefreshTokens.length + 1).padStart(12, '0')}`,
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
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { userId?: string; revokedAt?: null };
        data: Partial<MockRefreshToken>;
      }) => {
        let count = 0;
        for (const t of mockRefreshTokens) {
          let match = true;
          if (where.userId && t.userId !== where.userId) match = false;
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
    passwordResetToken: mockResetTokenDelegate,
    emailMessage: mockEmailMessageDelegate,
    outbox: mockOutboxDelegate,
    refreshToken: mockRefreshTokenDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        user: mockUserDelegate,
        passwordResetToken: mockResetTokenDelegate,
        emailMessage: mockEmailMessageDelegate,
        outbox: mockOutboxDelegate,
        refreshToken: mockRefreshTokenDelegate,
      }),
    ),
    $primary: vi.fn(() => ({
      user: mockUserDelegate,
      passwordResetToken: mockResetTokenDelegate,
      emailMessage: mockEmailMessageDelegate,
      outbox: mockOutboxDelegate,
      refreshToken: mockRefreshTokenDelegate,
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          user: mockUserDelegate,
          passwordResetToken: mockResetTokenDelegate,
          emailMessage: mockEmailMessageDelegate,
          outbox: mockOutboxDelegate,
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
              expireAt: entry ? entry.expireAt : Date.now() + 3600 * 1000,
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

vi.mock('../../../worker/queues', () => ({
  getQueue: vi.fn(() => ({
    add: vi.fn(async () => ({ id: 'mock-job-id' })),
  })),
  JOB_RETRY_POLICIES: {
    'email.send': { attempts: 5, backoff: { type: 'exponential', delay: 30000 } },
  },
  JobId: {
    emailSend: (id: string) => `email:${id}`,
  },
}));

function makeRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('Password Reset Flow (FR-06)', () => {
  const testUserId = '018f3a2b-1111-7000-8000-000000000001';
  const testEmail = 'alex.chen@example.com';
  let initialPasswordHash: string;

  beforeEach(async () => {
    mockUsers = [];
    mockResetTokens = [];
    mockEmailMessages = [];
    mockOutboxEntries = [];
    mockRefreshTokens = [];
    mockRedisStore.clear();
    vi.clearAllMocks();

    initialPasswordHash = await hashPassword('InitialPass123!');
    mockUsers.push({
      id: testUserId,
      email: testEmail,
      passwordHash: initialPasswordHash,
      displayName: 'Alex Chen',
    });
  });

  describe('POST /v1/auth/password-reset/request (FR-06)', () => {
    it('FR-06: given an existing email, returns 202 and enqueues password reset email via Outbox', async () => {
      const req = makeRequest('http://localhost:3000/v1/auth/password-reset/request', {
        email: testEmail,
      });
      const res = await requestRoute(req, { params: Promise.resolve({}) });

      expect(res.status).toBe(202);
      const data = (await res.json()) as { ok: boolean };
      expect(data.ok).toBe(true);

      // Verify token record created
      expect(mockResetTokens.length).toBe(1);
      const tokenRecord = mockResetTokens[0];
      if (!tokenRecord) throw new Error('Token record missing');
      expect(tokenRecord.userId).toBe(testUserId);
      expect(tokenRecord.usedAt).toBeNull();

      // Expiry is 30 minutes
      const diffMs = tokenRecord.expiresAt.getTime() - tokenRecord.createdAt.getTime();
      expect(diffMs).toBe(30 * 60 * 1000);

      // Verify email record created
      expect(mockEmailMessages.length).toBe(1);
      const email = mockEmailMessages[0];
      if (!email) throw new Error('Email record missing');
      expect(email.template).toBe('password-reset');
      expect(email.to).toBe(testEmail);
      expect(email.vars['resetUrl']).toMatch(/^https:\/\/.+\/r\/.+$/);

      // Verify Outbox record created
      expect(mockOutboxEntries.length).toBe(1);
      const outbox = mockOutboxEntries[0];
      if (!outbox) throw new Error('Outbox record missing');
      expect(outbox.kind).toBe('email.send');
      expect(outbox.payload['emailMessageId']).toBe(email.id);
    });

    it('FR-06: given a non-existent email, returns 202 without creating token or email', async () => {
      const req = makeRequest('http://localhost:3000/v1/auth/password-reset/request', {
        email: 'unknown.user@example.com',
      });
      const res = await requestRoute(req, { params: Promise.resolve({}) });

      expect(res.status).toBe(202);
      expect(mockResetTokens.length).toBe(0);
      expect(mockEmailMessages.length).toBe(0);
      expect(mockOutboxEntries.length).toBe(0);
    });

    it('FR-06 & L-34: given 3 requests for one email within 1 hour, 4th request returns 202 but sends no email', async () => {
      // 3 requests within 1 hour
      for (let i = 0; i < 3; i++) {
        const req = makeRequest('http://localhost:3000/v1/auth/password-reset/request', {
          email: testEmail,
        });
        const res = await requestRoute(req, { params: Promise.resolve({}) });
        expect(res.status).toBe(202);
      }

      expect(mockResetTokens.length).toBe(3);
      expect(mockEmailMessages.length).toBe(3);

      // 4th request exceeds rate limit
      const req4 = makeRequest('http://localhost:3000/v1/auth/password-reset/request', {
        email: testEmail,
      });
      const res4 = await requestRoute(req4, { params: Promise.resolve({}) });

      expect(res4.status).toBe(202);
      // Count remains 3 (no 4th token or email created)
      expect(mockResetTokens.length).toBe(3);
      expect(mockEmailMessages.length).toBe(3);
    });

    it('FR-06: given invalid email or extra fields, returns 400 VALIDATION_FAILED', async () => {
      const resBadEmail = await requestRoute(
        makeRequest('http://localhost:3000/v1/auth/password-reset/request', {
          email: 'not-an-email',
        }),
        { params: Promise.resolve({}) },
      );
      expect(resBadEmail.status).toBe(400);

      const resExtra = await requestRoute(
        makeRequest('http://localhost:3000/v1/auth/password-reset/request', {
          email: testEmail,
          extraField: 'unexpected',
        }),
        { params: Promise.resolve({}) },
      );
      expect(resExtra.status).toBe(400);
    });
  });

  describe('POST /v1/auth/password-reset/confirm (FR-06)', () => {
    it('FR-06: given a valid unused token under 30 minutes, changes password, marks used, and revokes all refresh tokens', async () => {
      // Create active refresh token sessions for user
      await createRefreshToken({ userId: testUserId, deviceName: 'iPhone' });
      await createRefreshToken({ userId: testUserId, deviceName: 'MacBook' });
      expect(mockRefreshTokens.filter((t) => t.revokedAt === null).length).toBe(2);

      // Create valid reset token
      const rawToken = generateRandomToken();
      const tokenHash = hashToken(rawToken);
      const now = new Date();
      const tokenId = '018f3a2b-0000-7000-8001-000000000099';
      mockResetTokens.push({
        id: tokenId,
        userId: testUserId,
        tokenHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        usedAt: null,
      });

      const newPassword = 'NewSecurePassword123!';
      const req = makeRequest('http://localhost:3000/v1/auth/password-reset/confirm', {
        token: rawToken,
        password: newPassword,
      });
      const res = await confirmRoute(req, { params: Promise.resolve({}) });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean };
      expect(data.ok).toBe(true);

      // Verify password changed
      const user = mockUsers.find((u) => u.id === testUserId);
      if (!user) throw new Error('User not found');
      expect(user.passwordHash).not.toBe(initialPasswordHash);
      const matches = await verifyPassword(user.passwordHash, newPassword);
      expect(matches).toBe(true);

      // Verify token marked used
      const tokenRecord = mockResetTokens.find((t) => t.id === tokenId);
      if (!tokenRecord) throw new Error('Token record not found');
      expect(tokenRecord.usedAt).not.toBeNull();

      // Verify all refresh tokens revoked (FR-05, FR-06)
      const activeSessions = mockRefreshTokens.filter((t) => t.revokedAt === null);
      expect(activeSessions.length).toBe(0);
    });

    it('FR-06: given an already used reset link, returns 410 RESET_LINK_INVALID', async () => {
      const rawToken = generateRandomToken();
      const tokenHash = hashToken(rawToken);
      const now = new Date();
      mockResetTokens.push({
        id: 'prt-used',
        userId: testUserId,
        tokenHash,
        createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        expiresAt: new Date(now.getTime() + 20 * 60 * 1000),
        usedAt: new Date(now.getTime() - 5 * 60 * 1000), // already used
      });

      const req = makeRequest('http://localhost:3000/v1/auth/password-reset/confirm', {
        token: rawToken,
        password: 'NewSecurePassword123!',
      });
      const res = await confirmRoute(req, { params: Promise.resolve({}) });

      expect(res.status).toBe(410);
      const data = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(data.error.code).toBe('RESET_LINK_INVALID');
    });

    it('FR-06: given a reset link older than 30 minutes, returns 410 RESET_LINK_INVALID', async () => {
      const rawToken = generateRandomToken();
      const tokenHash = hashToken(rawToken);
      const now = new Date();
      mockResetTokens.push({
        id: 'prt-expired',
        userId: testUserId,
        tokenHash,
        createdAt: new Date(now.getTime() - 35 * 60 * 1000),
        expiresAt: new Date(now.getTime() - 5 * 60 * 1000), // expired 5 minutes ago
        usedAt: null,
      });

      const req = makeRequest('http://localhost:3000/v1/auth/password-reset/confirm', {
        token: rawToken,
        password: 'NewSecurePassword123!',
      });
      const res = await confirmRoute(req, { params: Promise.resolve({}) });

      expect(res.status).toBe(410);
      const data = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(data.error.code).toBe('RESET_LINK_INVALID');
    });

    it('FR-06: given an unknown token, returns 410 RESET_LINK_INVALID', async () => {
      const req = makeRequest('http://localhost:3000/v1/auth/password-reset/confirm', {
        token: 'unknown-token-hash-12345678',
        password: 'NewSecurePassword123!',
      });
      const res = await confirmRoute(req, { params: Promise.resolve({}) });

      expect(res.status).toBe(410);
      const data = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(data.error.code).toBe('RESET_LINK_INVALID');
    });

    it('FR-06: given a password under 10 characters, returns 400 VALIDATION_FAILED', async () => {
      const req = makeRequest('http://localhost:3000/v1/auth/password-reset/confirm', {
        token: 'some-token-value',
        password: 'short', // under 10 chars
      });
      const res = await confirmRoute(req, { params: Promise.resolve({}) });

      expect(res.status).toBe(400);
      const data = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(data.error.code).toBe('VALIDATION_FAILED');
    });
  });
});
