import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as getTeamRoute,
  PATCH as updateTeamRoute,
} from '../../../app/v1/teams/[teamId]/route';
import { POST as transferOwnershipRoute } from '../../../app/v1/teams/[teamId]/ownership-transfer/route';
import { createAccessToken } from '../../../lib/auth/jwt';
import { hashPassword } from '../../../lib/auth/password';

interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
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
}

interface MockSubscription {
  id: string;
  teamId: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'CANCELED';
}

interface MockOutbox {
  id: string;
  teamId: string | null;
  kind: string;
  sourceKey: string;
  payload: unknown;
}

let mockUsers: MockUser[] = [];
let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
let mockSubscriptions: MockSubscription[] = [];
let mockOutboxEntries: MockOutbox[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../lib/db', () => {
  const teamDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = mockTeams.find((t) => t.id === where.id);
      return found ? { ...found } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MockTeam> }) => {
      const found = mockTeams.find((t) => t.id === where.id);
      if (!found) throw new Error('Team not found');
      Object.assign(found, data);
      return { ...found };
    }),
  };

  const userDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = mockUsers.find((u) => u.id === where.id);
      return found ? { ...found } : null;
    }),
  };

  const membershipDelegate = {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: { teamId_userId?: { teamId: string; userId: string }; id?: string };
      }) => {
        let found: MockMembership | undefined;
        if (where.teamId_userId) {
          found = mockMemberships.find(
            (m) =>
              m.teamId === where.teamId_userId?.teamId && m.userId === where.teamId_userId?.userId,
          );
        } else if (where.id) {
          found = mockMemberships.find((m) => m.id === where.id);
        }
        return found ? { ...found } : null;
      },
    ),
    count: vi.fn(
      async ({ where }: { where: { teamId: string; status?: 'ACTIVE' | 'REMOVED' | 'LEFT' } }) => {
        return mockMemberships.filter(
          (m) => m.teamId === where.teamId && (!where.status || m.status === where.status),
        ).length;
      },
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<MockMembership> }) => {
        const found = mockMemberships.find((m) => m.id === where.id);
        if (!found) throw new Error('Membership not found');
        Object.assign(found, data);
        return { ...found };
      },
    ),
  };

  const subscriptionDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { teamId: string } }) => {
      const found = mockSubscriptions.find((s) => s.teamId === where.teamId);
      return found ? { ...found } : null;
    }),
  };

  const outboxDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockOutbox, 'id'> }) => {
      const record: MockOutbox = {
        id: `018f3a2b-0000-7000-8050-${String(mockOutboxEntries.length + 1).padStart(12, '0')}`,
        teamId: data.teamId ?? null,
        kind: data.kind,
        sourceKey: data.sourceKey,
        payload: data.payload,
      };
      mockOutboxEntries.push(record);
      return record;
    }),
  };

  const mockDbClient = {
    team: teamDelegate,
    user: userDelegate,
    membership: membershipDelegate,
    subscription: subscriptionDelegate,
    outbox: outboxDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        team: teamDelegate,
        user: userDelegate,
        membership: membershipDelegate,
        subscription: subscriptionDelegate,
        outbox: outboxDelegate,
      }),
    ),
    $primary: vi.fn(() => ({
      team: teamDelegate,
      user: userDelegate,
      membership: membershipDelegate,
      subscription: subscriptionDelegate,
      outbox: outboxDelegate,
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          team: teamDelegate,
          user: userDelegate,
          membership: membershipDelegate,
          subscription: subscriptionDelegate,
          outbox: outboxDelegate,
        }),
      ),
    })),
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

vi.mock('../../../worker/queues', () => ({
  getQueue: vi.fn(() => ({
    add: vi.fn(async () => ({ id: 'mock-job-id' })),
  })),
  JOB_RETRY_POLICIES: {
    'notify.fanout': { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
  },
  JobId: {
    notifyFanout: (sourceKey: string) => `fanout:${sourceKey}`,
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

describe('Team Details and Ownership Transfer (FR-13, PRD 7.2)', () => {
  const teamId = '018f3a2b-1000-7000-8000-000000000001';
  const ownerUserId = '018f3a2b-2000-7000-8000-000000000001';
  const managerUserId = '018f3a2b-3000-7000-8000-000000000001';
  const staffUserId = '018f3a2b-4000-7000-8000-000000000001';
  const outsiderUserId = '018f3a2b-5000-7000-8000-000000000001';
  const ownerPassword = 'CorrectPassword123!';

  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;
  let outsiderToken: string;

  beforeEach(async () => {
    const pwdHash = await hashPassword(ownerPassword);

    mockUsers = [
      {
        id: ownerUserId,
        email: 'owner@clinic.com',
        passwordHash: pwdHash,
        displayName: 'Dr. Owner',
      },
      {
        id: managerUserId,
        email: 'manager@clinic.com',
        passwordHash: 'hash',
        displayName: 'Manager',
      },
      { id: staffUserId, email: 'staff@clinic.com', passwordHash: 'hash', displayName: 'Staff' },
      {
        id: outsiderUserId,
        email: 'outsider@other.com',
        passwordHash: 'hash',
        displayName: 'Outsider',
      },
    ];

    mockTeams = [
      {
        id: teamId,
        name: 'Apex Medical Center',
        timezone: 'America/New_York',
        shardIndex: 0,
        weekStartsOn: 1,
        ownerUserId,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        updatedAt: new Date('2026-11-01T00:00:00Z'),
        deletedAt: null,
      },
    ];

    mockMemberships = [
      {
        id: '018f3a2b-0000-7000-8010-000000000001',
        teamId,
        userId: ownerUserId,
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: new Date('2026-11-01T00:00:00Z'),
        endedAt: null,
      },
      {
        id: '018f3a2b-0000-7000-8010-000000000002',
        teamId,
        userId: managerUserId,
        role: 'MANAGER',
        status: 'ACTIVE',
        joinedAt: new Date('2026-11-01T00:00:00Z'),
        endedAt: null,
      },
      {
        id: '018f3a2b-0000-7000-8010-000000000003',
        teamId,
        userId: staffUserId,
        role: 'STAFF',
        status: 'ACTIVE',
        joinedAt: new Date('2026-11-01T00:00:00Z'),
        endedAt: null,
      },
    ];

    mockSubscriptions = [
      {
        id: '018f3a2b-0000-7000-8020-000000000001',
        teamId,
        status: 'ACTIVE',
      },
    ];

    mockOutboxEntries = [];
    mockRedisStore.clear();
    vi.clearAllMocks();

    ownerToken = await createAccessToken(ownerUserId);
    managerToken = await createAccessToken(managerUserId);
    staffToken = await createAccessToken(staffUserId);
    outsiderToken = await createAccessToken(outsiderUserId);
  });

  describe('GET /v1/teams/:teamId', () => {
    it('returns team details for active team member (Member auth)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}`,
        'GET',
        undefined,
        staffToken,
      );

      const res = await getTeamRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        id: string;
        name: string;
        timezone: string;
        role: string;
        memberCount: number;
      };

      expect(body.id).toBe(teamId);
      expect(body.name).toBe('Apex Medical Center');
      expect(body.timezone).toBe('America/New_York');
      expect(body.role).toBe('STAFF');
      expect(body.memberCount).toBe(3);
    });

    it('returns 404 NOT_FOUND for non-member caller (B-19, FR-43)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}`,
        'GET',
        undefined,
        outsiderToken,
      );

      const res = await getTeamRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /v1/teams/:teamId', () => {
    it('allows owner to update team name and timezone, invalidating team cache in Redis', async () => {
      // Pre-warm redis cache
      mockRedisStore.set(`team:${teamId}`, { value: 'ACTIVE', expireAt: Date.now() + 300000 });

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}`,
        'PATCH',
        {
          name: 'Apex Health Group',
          timezone: 'America/Chicago',
        },
        ownerToken,
      );

      const res = await updateTeamRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { name: string; timezone: string };
      expect(body.name).toBe('Apex Health Group');
      expect(body.timezone).toBe('America/Chicago');

      // Verify Redis team cache invalidated (PRD 7.3)
      expect(mockRedisStore.has(`team:${teamId}`)).toBe(false);
    });

    it('rejects manager or staff attempting to update team settings with 403 FORBIDDEN', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}`,
        'PATCH',
        { name: 'Hacked Clinic' },
        managerToken,
      );

      const res = await updateTeamRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 403 TEAM_READ_ONLY when updating team on read-only team (B-14)', async () => {
      const sub = mockSubscriptions[0];
      if (!sub) throw new Error('Sub missing');
      sub.status = 'READ_ONLY';

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}`,
        'PATCH',
        { name: 'New Name' },
        ownerToken,
      );

      const res = await updateTeamRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('TEAM_READ_ONLY');
    });
  });

  describe('FR-13: Transfer Ownership', () => {
    it('transfers ownership in one ordered transaction, invalidating cache for both users', async () => {
      // Pre-warm permission cache for both users
      mockRedisStore.set(`perm:${ownerUserId}:${teamId}`, {
        value: 'OWNER',
        expireAt: Date.now() + 60000,
      });
      mockRedisStore.set(`perm:${staffUserId}:${teamId}`, {
        value: 'STAFF',
        expireAt: Date.now() + 60000,
      });

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/ownership-transfer`,
        'POST',
        {
          targetUserId: staffUserId,
          password: ownerPassword,
        },
        ownerToken,
      );

      const res = await transferOwnershipRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { ok: boolean; newOwnerUserId: string };
      expect(body.ok).toBe(true);
      expect(body.newOwnerUserId).toBe(staffUserId);

      // Verify database state: former owner is MANAGER, target is OWNER, Team.ownerUserId updated
      const formerOwnerMem = mockMemberships.find((m) => m.userId === ownerUserId);
      const targetMem = mockMemberships.find((m) => m.userId === staffUserId);
      const team = mockTeams.find((t) => t.id === teamId);

      expect(formerOwnerMem?.role).toBe('MANAGER');
      expect(targetMem?.role).toBe('OWNER');
      expect(team?.ownerUserId).toBe(staffUserId);

      // Verify outbox entry written for OWNERSHIP_TRANSFERRED notification
      expect(mockOutboxEntries.some((o) => o.kind === 'notify.fanout')).toBe(true);

      // Verify permission cache deleted for BOTH users (FR-13)
      expect(mockRedisStore.has(`perm:${ownerUserId}:${teamId}`)).toBe(false);
      expect(mockRedisStore.has(`perm:${staffUserId}:${teamId}`)).toBe(false);
    });

    it('given wrong password, returns 401 AUTH_INVALID_CREDENTIALS (FR-13)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/ownership-transfer`,
        'POST',
        {
          targetUserId: staffUserId,
          password: 'WrongPassword123!',
        },
        ownerToken,
      );

      const res = await transferOwnershipRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('given target is not an active member, returns 404 NOT_FOUND (FR-13)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/ownership-transfer`,
        'POST',
        {
          targetUserId: outsiderUserId, // outsider
          password: ownerPassword,
        },
        ownerToken,
      );

      const res = await transferOwnershipRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('rejects manager trying to transfer ownership with 403 FORBIDDEN', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/ownership-transfer`,
        'POST',
        {
          targetUserId: staffUserId,
          password: 'password',
        },
        managerToken,
      );

      const res = await transferOwnershipRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(403);
    });

    it('succeeds even when the team is in READ_ONLY status (FR-13, B-14, L55)', async () => {
      const sub = mockSubscriptions[0];
      if (!sub) throw new Error('Sub missing');
      sub.status = 'READ_ONLY';

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/ownership-transfer`,
        'POST',
        {
          targetUserId: staffUserId,
          password: ownerPassword,
        },
        ownerToken,
      );

      const res = await transferOwnershipRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(200);

      const team = mockTeams.find((t) => t.id === teamId);
      expect(team?.ownerUserId).toBe(staffUserId);
    });
  });
});
