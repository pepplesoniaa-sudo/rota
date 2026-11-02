import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../../app/v1/auth/register/route';
import { verifyAccessToken } from '../../../lib/auth/jwt';
import { verifyPassword } from '../../../lib/auth/password';

// In-memory mock store for users, settings, and refresh tokens
interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MockUserSettings {
  userId: string;
  timezone: string;
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
let mockSettings: MockUserSettings[] = [];
let mockRefreshTokens: MockRefreshToken[] = [];

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

    create: vi.fn(
      async ({
        data,
      }: {
        data: {
          email: string;
          passwordHash: string;
          displayName: string;
          settings?: { create: { timezone: string } };
        };
      }) => {
        const user: MockUser = {
          id: `user-${mockUsers.length + 1}`,
          email: data.email,
          passwordHash: data.passwordHash,
          displayName: data.displayName,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockUsers.push(user);

        if (data.settings?.create) {
          mockSettings.push({
            userId: user.id,
            timezone: data.settings.create.timezone,
          });
        }

        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        };
      },
    ),
  };

  const mockRefreshTokenDelegate = {
    create: vi.fn(
      async ({
        data,
      }: {
        data: {
          userId: string;
          familyId: string;
          tokenHash: string;
          deviceName?: string | null;
          createdAt: Date;
          expiresAt: Date;
        };
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

function createRegisterRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/v1/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const mockContext = { params: Promise.resolve({}) };

describe('FR-01: User Registration (POST /v1/auth/register)', () => {
  beforeEach(() => {
    mockUsers = [];
    mockSettings = [];
    mockRefreshTokens = [];
  });

  it('FR-01: Given a valid email, 10+ char password, and IANA timezone, returns 201 with access and refresh tokens', async () => {
    const req = createRegisterRequest({
      email: 'Nurse.Jackie@Example.COM',
      password: 'StrongP@ssword123!',
      timezone: 'America/New_York',
    });

    const res = await POST(req, mockContext);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.accessToken).toBeDefined();
    expect(json.refreshToken).toBeDefined();
    expect(typeof json.refreshToken).toBe('string');
    expect(json.refreshToken.length).toBe(43); // 32 bytes base64url

    expect(json.user).toEqual({
      id: expect.any(String),
      email: 'nurse.jackie@example.com', // DB-4: stored lowercase
      displayName: 'nurse.jackie',
    });

    // Verify token validity
    const decoded = await verifyAccessToken(json.accessToken);
    expect(decoded.userId).toBe(json.user.id);

    // Verify user stored in DB with Argon2id hash
    const storedUser = mockUsers.find((u) => u.email === 'nurse.jackie@example.com');
    expect(storedUser).toBeDefined();
    if (!storedUser) throw new Error('User not found in store');
    expect(storedUser.passwordHash).toContain('$argon2id$');
    const isPasswordValid = await verifyPassword(storedUser.passwordHash, 'StrongP@ssword123!');
    expect(isPasswordValid).toBe(true);

    // Verify user settings created with timezone
    const storedSettings = mockSettings.find((s) => s.userId === storedUser?.id);
    expect(storedSettings?.timezone).toBe('America/New_York');

    // Verify refresh token stored as SHA-256 hash (B-49)
    expect(mockRefreshTokens).toHaveLength(1);
    expect(mockRefreshTokens[0]?.tokenHash).not.toBe(json.refreshToken);
  });

  it('FR-01: Given an explicit displayName, stores it properly', async () => {
    const req = createRegisterRequest({
      email: 'alex@example.com',
      password: 'ValidPassword123!',
      displayName: 'Alex Morgan',
      timezone: 'Europe/London',
    });

    const res = await POST(req, mockContext);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.user.displayName).toBe('Alex Morgan');
  });

  it('FR-01: Given an email already in use, returns 409 EMAIL_TAKEN', async () => {
    // Register first user
    const firstReq = createRegisterRequest({
      email: 'dr.smith@example.com',
      password: 'Password1234!',
      timezone: 'America/Chicago',
    });
    const firstRes = await POST(firstReq, mockContext);
    expect(firstRes.status).toBe(201);

    // Register with same email (case variation)
    const duplicateReq = createRegisterRequest({
      email: 'DR.SMITH@EXAMPLE.COM',
      password: 'DifferentPassword123!',
      timezone: 'America/Chicago',
    });
    const duplicateRes = await POST(duplicateReq, mockContext);
    expect(duplicateRes.status).toBe(409);

    const json = await duplicateRes.json();
    expect(json.error.code).toBe('EMAIL_TAKEN');
  });

  it('FR-01: Given a password under 10 characters, returns 400 VALIDATION_FAILED', async () => {
    const req = createRegisterRequest({
      email: 'shortpass@example.com',
      password: 'short',
      timezone: 'America/Chicago',
    });

    const res = await POST(req, mockContext);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_FAILED');
  });

  it('FR-01: Given an invalid IANA timezone, returns 400 VALIDATION_FAILED', async () => {
    const req = createRegisterRequest({
      email: 'badzone@example.com',
      password: 'Password1234!',
      timezone: 'Invalid/Non_Existent_Timezone',
    });

    const res = await POST(req, mockContext);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_FAILED');
  });

  it('CS-10: Given unrecognized body properties, returns 400 VALIDATION_FAILED (.strict())', async () => {
    const req = createRegisterRequest({
      email: 'extrakeys@example.com',
      password: 'Password1234!',
      timezone: 'America/New_York',
      role: 'ADMIN', // Illegal extra field
    });

    const res = await POST(req, mockContext);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_FAILED');
  });
});
