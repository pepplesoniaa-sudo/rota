import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getMeRoute } from '../../../app/v1/me/route';
import {
  GET as getSettingsRoute,
  PATCH as updateSettingsRoute,
} from '../../../app/v1/me/settings/route';
import { POST as registerPushTokenRoute } from '../../../app/v1/me/push-tokens/route';
import { DELETE as deletePushTokenRoute } from '../../../app/v1/me/push-tokens/[pushTokenId]/route';
import { GET as getMyTeamsRoute } from '../../../app/v1/me/teams/route';
import { createAccessToken } from '../../../lib/auth/jwt';

interface MockUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MockUserSettings {
  userId: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  notifyShiftChanges: boolean;
  notifySwaps: boolean;
  notifyMemberJoined: boolean;
  notifyShiftReminders: boolean;
  quietAfterNightShift: boolean;
  use24HourClock: boolean;
  weekStartsOn: number;
  version: number;
  updatedAt: Date;
}

interface MockPushToken {
  id: string;
  userId: string;
  expoPushToken: string;
  platform: 'IOS' | 'ANDROID';
  deviceId: string;
  createdAt: Date;
  lastSeenAt: Date;
  disabledAt: Date | null;
}

interface MockTeam {
  id: string;
  name: string;
  timezone: string;
  shardIndex: number;
  weekStartsOn: number;
  ownerUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface MockMembership {
  id: string;
  teamId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'REMOVED' | 'LEFT';
  joinedAt: Date;
  endedAt: Date | null;
  team?: MockTeam;
}

let mockUsers: MockUser[] = [];
let mockSettings: MockUserSettings[] = [];
let mockPushTokens: MockPushToken[] = [];
let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../lib/db', () => {
  const userDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = mockUsers.find((u) => u.id === where.id);
      return found ? { ...found } : null;
    }),
  };

  const userSettingsDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => {
      const found = mockSettings.find((s) => s.userId === where.userId);
      return found ? { ...found } : null;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { userId: string }; data: Record<string, unknown> }) => {
        const found = mockSettings.find((s) => s.userId === where.userId);
        if (!found) throw new Error('Settings not found');
        const updated = { ...found };
        for (const [key, val] of Object.entries(data)) {
          if (key === 'version' && typeof val === 'object' && val && 'increment' in val) {
            updated.version += (val as { increment: number }).increment;
          } else {
            (updated as Record<string, unknown>)[key] = val;
          }
        }
        updated.updatedAt = new Date();
        const index = mockSettings.findIndex((s) => s.userId === where.userId);
        mockSettings[index] = updated;
        return { ...updated };
      },
    ),
  };

  const pushTokenDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = mockPushTokens.find((p) => p.id === where.id);
      return found ? { ...found } : null;
    }),
    deleteMany: vi.fn(
      async ({ where }: { where: { expoPushToken?: string; userId?: { not?: string } } }) => {
        let count = 0;
        mockPushTokens = mockPushTokens.filter((p) => {
          if (where.expoPushToken && p.expoPushToken === where.expoPushToken) {
            if (where.userId?.not && p.userId !== where.userId.not) {
              count++;
              return false;
            }
          }
          return true;
        });
        return { count };
      },
    ),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { userId_deviceId: { userId: string; deviceId: string } };
        create: Omit<MockPushToken, 'id' | 'createdAt' | 'lastSeenAt' | 'disabledAt'>;
        update: Partial<MockPushToken>;
      }) => {
        const existing = mockPushTokens.find(
          (p) =>
            p.userId === where.userId_deviceId.userId &&
            p.deviceId === where.userId_deviceId.deviceId,
        );
        if (existing) {
          Object.assign(existing, update, { lastSeenAt: new Date(), disabledAt: null });
          return { ...existing };
        }
        const created: MockPushToken = {
          id: `018f3a2b-9000-7000-8000-${String(mockPushTokens.length + 1).padStart(12, '0')}`,
          userId: create.userId,
          expoPushToken: create.expoPushToken,
          platform: create.platform,
          deviceId: create.deviceId,
          createdAt: new Date(),
          lastSeenAt: new Date(),
          disabledAt: null,
        };
        mockPushTokens.push(created);
        return { ...created };
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = mockPushTokens.findIndex((p) => p.id === where.id);
      if (index === -1) throw new Error('Not found');
      const removed = mockPushTokens.splice(index, 1)[0];
      return removed;
    }),
  };

  const membershipDelegate = {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: { userId: string; status?: string; team?: { deletedAt?: null } };
      }) => {
        const results = mockMemberships
          .filter((m) => {
            if (m.userId !== where.userId) return false;
            if (where.status && m.status !== where.status) return false;
            const team = mockTeams.find((t) => t.id === m.teamId);
            if (!team) return false;
            if (where.team?.deletedAt === null && team.deletedAt !== null) return false;
            return true;
          })
          .map((m) => {
            const team = mockTeams.find((t) => t.id === m.teamId);
            return {
              ...m,
              team: team ? { ...team } : undefined,
            };
          });
        return results;
      },
    ),
  };

  const mockDbClient = {
    user: userDelegate,
    userSettings: userSettingsDelegate,
    pushToken: pushTokenDelegate,
    membership: membershipDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        user: userDelegate,
        userSettings: userSettingsDelegate,
        pushToken: pushTokenDelegate,
        membership: membershipDelegate,
      }),
    ),
  };

  return {
    dbShard0: mockDbClient,
    getShardClient: () => mockDbClient,
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
    ttl: vi.fn(async (key: string) => {
      const entry = mockRedisStore.get(key);
      if (!entry) return -2;
      return Math.max(0, Math.ceil((entry.expireAt - Date.now()) / 1000));
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      const entry = mockRedisStore.get(key);
      if (entry) {
        entry.expireAt = Date.now() + seconds * 1000;
      }
      return 1;
    }),
    del: vi.fn(async (key: string) => {
      mockRedisStore.delete(key);
      return 1;
    }),
    multi: vi.fn(() => {
      const ops: (() => unknown)[] = [];
      return {
        incr(key: string) {
          ops.push(() => {
            const entry = mockRedisStore.get(key);
            let current = 0;
            if (entry && entry.expireAt > Date.now()) {
              current = parseInt(entry.value, 10);
            }
            const next = current + 1;
            mockRedisStore.set(key, {
              value: String(next),
              expireAt: entry ? entry.expireAt : Date.now() + 60 * 1000,
            });
            return next;
          });
        },
        ttl(key: string) {
          ops.push(() => {
            const entry = mockRedisStore.get(key);
            if (!entry) return -1;
            return Math.max(0, Math.ceil((entry.expireAt - Date.now()) / 1000));
          });
        },
        exec: vi.fn(async () => {
          const results = ops.map((op) => [null, op()]);
          return results;
        }),
      };
    }),
  },
}));

function makeRequest(url: string, method: string, body?: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (body) {
    headers['content-type'] = 'application/json';
  }
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return new NextRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('Profile, User Settings, Push Tokens, Team Switcher & Rate Limiting (FR-08, FR-44, PRD 7.2)', () => {
  const userId = '018f3a2b-1000-7000-8000-000000000001';
  const otherUserId = '018f3a2b-2000-7000-8000-000000000002';
  let userToken: string;
  let otherToken: string;

  beforeEach(async () => {
    mockUsers = [
      {
        id: userId,
        email: 'alex@clinic.com',
        displayName: 'Alex Nurse',
        createdAt: new Date('2026-10-01T08:00:00Z'),
        updatedAt: new Date('2026-10-01T08:00:00Z'),
      },
      {
        id: otherUserId,
        email: 'sam@clinic.com',
        displayName: 'Sam Doctor',
        createdAt: new Date('2026-10-02T08:00:00Z'),
        updatedAt: new Date('2026-10-02T08:00:00Z'),
      },
    ];

    mockSettings = [
      {
        userId,
        timezone: 'America/Chicago',
        quietHoursEnabled: true,
        quietStartMinute: 1320,
        quietEndMinute: 420,
        notifyShiftChanges: true,
        notifySwaps: true,
        notifyMemberJoined: true,
        notifyShiftReminders: false,
        quietAfterNightShift: false,
        use24HourClock: false,
        weekStartsOn: 1,
        version: 1,
        updatedAt: new Date('2026-10-01T08:00:00Z'),
      },
    ];

    mockPushTokens = [];
    mockTeams = [];
    mockMemberships = [];
    mockRedisStore.clear();

    userToken = await createAccessToken(userId);
    otherToken = await createAccessToken(otherUserId);
  });

  describe('GET /v1/me (MeResponse)', () => {
    it('returns 200 with user profile for authenticated user', async () => {
      const req = makeRequest('http://localhost:3000/v1/me', 'GET', undefined, userToken);
      const res = await getMeRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({
        user: {
          id: userId,
          email: 'alex@clinic.com',
          displayName: 'Alex Nurse',
          createdAt: new Date('2026-10-01T08:00:00Z').toISOString(),
        },
      });
    });

    it('returns 401 AUTH_TOKEN_EXPIRED if unauthenticated', async () => {
      const req = makeRequest('http://localhost:3000/v1/me', 'GET');
      const res = await getMeRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });
  });

  describe('GET & PATCH /v1/me/settings (SettingsResponse, UpdateSettingsBody)', () => {
    it('returns 200 with user settings', async () => {
      const req = makeRequest('http://localhost:3000/v1/me/settings', 'GET', undefined, userToken);
      const res = await getSettingsRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.settings).toMatchObject({
        userId,
        timezone: 'America/Chicago',
        quietHoursEnabled: true,
        quietStartMinute: 1320,
        quietEndMinute: 420,
        notifyShiftChanges: true,
        notifySwaps: true,
        notifyMemberJoined: true,
        notifyShiftReminders: false,
        quietAfterNightShift: false,
        use24HourClock: false,
        weekStartsOn: 1,
        version: 1,
      });
    });

    it('successfully updates settings and increments version', async () => {
      const req = makeRequest(
        'http://localhost:3000/v1/me/settings',
        'PATCH',
        {
          timezone: 'Europe/London',
          quietHoursEnabled: false,
          use24HourClock: true,
          version: 1,
        },
        userToken,
      );
      const res = await updateSettingsRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.settings.timezone).toBe('Europe/London');
      expect(json.settings.quietHoursEnabled).toBe(false);
      expect(json.settings.use24HourClock).toBe(true);
      expect(json.settings.version).toBe(2);

      // Verify persisted state
      const persisted = mockSettings.find((s) => s.userId === userId);
      expect(persisted?.version).toBe(2);
      expect(persisted?.timezone).toBe('Europe/London');
    });

    it('returns 409 VERSION_CONFLICT on optimistic version mismatch', async () => {
      const req = makeRequest(
        'http://localhost:3000/v1/me/settings',
        'PATCH',
        {
          quietHoursEnabled: false,
          version: 99,
        },
        userToken,
      );
      const res = await updateSettingsRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('VERSION_CONFLICT');
    });

    it('rejects invalid IANA timezone with 400 VALIDATION_FAILED', async () => {
      const req = makeRequest(
        'http://localhost:3000/v1/me/settings',
        'PATCH',
        {
          timezone: 'Invalid/City_Name_Here',
          version: 1,
        },
        userToken,
      );
      const res = await updateSettingsRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects out of range minute with 400 VALIDATION_FAILED', async () => {
      const req = makeRequest(
        'http://localhost:3000/v1/me/settings',
        'PATCH',
        {
          quietStartMinute: 1500,
          version: 1,
        },
        userToken,
      );
      const res = await updateSettingsRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('Push Tokens: POST /v1/me/push-tokens & DELETE /v1/me/push-tokens/:id', () => {
    it('registers a new push token with 201', async () => {
      const req = makeRequest(
        'http://localhost:3000/v1/me/push-tokens',
        'POST',
        {
          expoPushToken: 'ExponentPushToken[device-alex-iphone]',
          platform: 'IOS',
          deviceId: 'iphone-14-pro',
        },
        userToken,
      );
      const res = await registerPushTokenRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.pushToken.expoPushToken).toBe('ExponentPushToken[device-alex-iphone]');
      expect(json.pushToken.platform).toBe('IOS');
      expect(json.pushToken.deviceId).toBe('iphone-14-pro');
      expect(mockPushTokens).toHaveLength(1);
    });

    it('upserts push token on the same deviceId', async () => {
      // First registration
      const req1 = makeRequest(
        'http://localhost:3000/v1/me/push-tokens',
        'POST',
        {
          expoPushToken: 'ExponentPushToken[token-v1]',
          platform: 'ANDROID',
          deviceId: 'pixel-8',
        },
        userToken,
      );
      await registerPushTokenRoute(req1, { params: Promise.resolve({}) });

      // Second registration on same device with updated token
      const req2 = makeRequest(
        'http://localhost:3000/v1/me/push-tokens',
        'POST',
        {
          expoPushToken: 'ExponentPushToken[token-v2]',
          platform: 'ANDROID',
          deviceId: 'pixel-8',
        },
        userToken,
      );
      const res2 = await registerPushTokenRoute(req2, { params: Promise.resolve({}) });
      expect(res2.status).toBe(201);
      const json2 = await res2.json();
      expect(json2.pushToken.expoPushToken).toBe('ExponentPushToken[token-v2]');
      expect(mockPushTokens).toHaveLength(1);
    });

    it('reclaims push token from other user if device was reassigned', async () => {
      // User 2 registers token
      mockPushTokens.push({
        id: 'token-sam',
        userId: otherUserId,
        expoPushToken: 'ExponentPushToken[shared-device]',
        platform: 'IOS',
        deviceId: 'ipad-mini',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        disabledAt: null,
      });

      // User 1 logs in and registers same token
      const req = makeRequest(
        'http://localhost:3000/v1/me/push-tokens',
        'POST',
        {
          expoPushToken: 'ExponentPushToken[shared-device]',
          platform: 'IOS',
          deviceId: 'ipad-mini-alex',
        },
        userToken,
      );
      const res = await registerPushTokenRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(201);

      // Old token for User 2 must be purged
      expect(mockPushTokens.find((p) => p.userId === otherUserId)).toBeUndefined();
      expect(mockPushTokens.find((p) => p.userId === userId)).toBeDefined();
    });

    it('deletes own push token with 200', async () => {
      mockPushTokens.push({
        id: '018f3a2b-9000-7000-8000-000000000001',
        userId,
        expoPushToken: 'ExponentPushToken[to-delete]',
        platform: 'IOS',
        deviceId: 'iphone-old',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        disabledAt: null,
      });

      const req = makeRequest(
        'http://localhost:3000/v1/me/push-tokens/018f3a2b-9000-7000-8000-000000000001',
        'DELETE',
        undefined,
        userToken,
      );
      const res = await deletePushTokenRoute(req, {
        params: Promise.resolve({ pushTokenId: '018f3a2b-9000-7000-8000-000000000001' }),
      });
      expect(res.status).toBe(200);
      expect(mockPushTokens).toHaveLength(0);
    });

    it('returns 404 NOT_FOUND when attempting to delete another users push token', async () => {
      mockPushTokens.push({
        id: '018f3a2b-9000-7000-8000-000000000002',
        userId: otherUserId,
        expoPushToken: 'ExponentPushToken[sam-token]',
        platform: 'IOS',
        deviceId: 'sams-phone',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        disabledAt: null,
      });

      const req = makeRequest(
        'http://localhost:3000/v1/me/push-tokens/018f3a2b-9000-7000-8000-000000000002',
        'DELETE',
        undefined,
        userToken,
      );
      const res = await deletePushTokenRoute(req, {
        params: Promise.resolve({ pushTokenId: '018f3a2b-9000-7000-8000-000000000002' }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });
  });

  describe('FR-08: Team Switcher (GET /v1/me/teams)', () => {
    it('returns active teams ordered by joinedAt with correct role and weekStartsOn', async () => {
      const team1Id = '018f3a2b-3000-7000-8000-000000000001';
      const team2Id = '018f3a2b-3000-7000-8000-000000000002';
      const teamInactiveId = '018f3a2b-3000-7000-8000-000000000003';
      const teamDeletedId = '018f3a2b-3000-7000-8000-000000000004';

      mockTeams = [
        {
          id: team1Id,
          name: 'City Urgent Care',
          timezone: 'America/Chicago',
          shardIndex: 0,
          weekStartsOn: 1,
          ownerUserId: userId,
          createdAt: new Date('2026-10-10T10:00:00Z'),
          updatedAt: new Date('2026-10-10T10:00:00Z'),
          deletedAt: null,
        },
        {
          id: team2Id,
          name: 'Downtown Dental',
          timezone: 'America/New_York',
          shardIndex: 1,
          weekStartsOn: 7,
          ownerUserId: otherUserId,
          createdAt: new Date('2026-10-12T10:00:00Z'),
          updatedAt: new Date('2026-10-12T10:00:00Z'),
          deletedAt: null,
        },
        {
          id: teamInactiveId,
          name: 'Former Clinic',
          timezone: 'America/Denver',
          shardIndex: 0,
          weekStartsOn: 1,
          ownerUserId: otherUserId,
          createdAt: new Date('2026-10-01T10:00:00Z'),
          updatedAt: new Date('2026-10-01T10:00:00Z'),
          deletedAt: null,
        },
        {
          id: teamDeletedId,
          name: 'Closed Hospital',
          timezone: 'America/Chicago',
          shardIndex: 0,
          weekStartsOn: 1,
          ownerUserId: userId,
          createdAt: new Date('2026-10-02T10:00:00Z'),
          updatedAt: new Date('2026-10-02T10:00:00Z'),
          deletedAt: new Date(),
        },
      ];

      mockMemberships = [
        {
          id: 'mem-1',
          teamId: team1Id,
          userId,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date('2026-10-10T10:00:00Z'),
          endedAt: null,
        },
        {
          id: 'mem-2',
          teamId: team2Id,
          userId,
          role: 'STAFF',
          status: 'ACTIVE',
          joinedAt: new Date('2026-10-15T12:00:00Z'),
          endedAt: null,
        },
        {
          id: 'mem-3',
          teamId: teamInactiveId,
          userId,
          role: 'STAFF',
          status: 'LEFT',
          joinedAt: new Date('2026-10-01T10:00:00Z'),
          endedAt: new Date('2026-10-05T10:00:00Z'),
        },
        {
          id: 'mem-4',
          teamId: teamDeletedId,
          userId,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date('2026-10-02T10:00:00Z'),
          endedAt: null,
        },
      ];

      const req = makeRequest('http://localhost:3000/v1/me/teams', 'GET', undefined, userToken);
      const res = await getMyTeamsRoute(req, { params: Promise.resolve({}) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.teams).toHaveLength(2);
      expect(json.teams[0]).toEqual({
        id: team1Id,
        name: 'City Urgent Care',
        timezone: 'America/Chicago',
        role: 'OWNER',
        weekStartsOn: 1,
        joinedAt: new Date('2026-10-10T10:00:00Z').toISOString(),
      });
      expect(json.teams[1]).toEqual({
        id: team2Id,
        name: 'Downtown Dental',
        timezone: 'America/New_York',
        role: 'STAFF',
        weekStartsOn: 7,
        joinedAt: new Date('2026-10-15T12:00:00Z').toISOString(),
      });
    });
  });

  describe('FR-44 & L-34: General Rate Limiting (120 req/min per user)', () => {
    it('allows 120 requests in 60s and rejects the 121st request with 429 RATE_LIMITED and Retry-After', async () => {
      // Simulate 120 successful requests
      for (let i = 0; i < 120; i++) {
        const req = makeRequest('http://localhost:3000/v1/me', 'GET', undefined, userToken);
        const res = await getMeRoute(req, { params: Promise.resolve({}) });
        expect(res.status).toBe(200);
      }

      // 121st request must trigger 429 RATE_LIMITED
      const reqOverLimit = makeRequest('http://localhost:3000/v1/me', 'GET', undefined, userToken);
      const resOverLimit = await getMeRoute(reqOverLimit, { params: Promise.resolve({}) });
      expect(resOverLimit.status).toBe(429);

      const json = await resOverLimit.json();
      expect(json.error.code).toBe('RATE_LIMITED');
      expect(resOverLimit.headers.get('Retry-After')).toBeDefined();
      expect(Number(resOverLimit.headers.get('Retry-After'))).toBeGreaterThan(0);

      // Verify that another user has their own separate quota and is NOT rate limited
      const reqOther = makeRequest('http://localhost:3000/v1/me', 'GET', undefined, otherToken);
      const resOther = await getMeRoute(reqOther, { params: Promise.resolve({}) });
      expect(resOther.status).toBe(200);
    });
  });
});
