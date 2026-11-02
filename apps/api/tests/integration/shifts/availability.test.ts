import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getAvailabilityRoute } from '../../../app/v1/teams/[teamId]/availability/route';
import { PUT as replaceAvailabilityRoute } from '../../../app/v1/teams/[teamId]/availability/me/route';
import { createAccessToken } from '../../../lib/auth/jwt';

interface MockTeam {
  id: string;
  name: string;
  timezone: string;
  shardIndex: number;
  ownerUserId: string;
  deletedAt: Date | null;
}

interface MockMembership {
  id: string;
  teamId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'REMOVED' | 'LEFT';
}

interface MockAvailabilityBlock {
  id: string;
  teamId: string;
  userId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  createdAt: Date;
}

interface MockSubscription {
  id: string;
  teamId: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'CANCELED';
}

let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
let mockBlocks: MockAvailabilityBlock[] = [];
let mockSubscriptions: MockSubscription[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../lib/db', () => {
  const teamDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = mockTeams.find((t) => t.id === where.id);
      return found ? { ...found } : null;
    }),
  };

  const membershipDelegate = {
    findUnique: vi.fn(
      async ({ where }: { where: { teamId_userId?: { teamId: string; userId: string } } }) => {
        if (where.teamId_userId) {
          const found = mockMemberships.find(
            (m) =>
              m.teamId === where.teamId_userId?.teamId && m.userId === where.teamId_userId?.userId,
          );
          return found ? { ...found } : null;
        }
        return null;
      },
    ),
  };

  const availabilityDelegate = {
    findMany: vi.fn(async ({ where }: { where: { teamId: string; userId?: string } }) => {
      return mockBlocks
        .filter((b) => {
          if (b.teamId !== where.teamId) return false;
          if (where.userId && b.userId !== where.userId) return false;
          return true;
        })
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute)
        .map((b) => ({ ...b }));
    }),
    deleteMany: vi.fn(async ({ where }: { where: { teamId: string; userId: string } }) => {
      let count = 0;
      mockBlocks = mockBlocks.filter((b) => {
        if (b.teamId === where.teamId && b.userId === where.userId) {
          count++;
          return false;
        }
        return true;
      });
      return { count };
    }),
    createMany: vi.fn(
      async ({ data }: { data: Omit<MockAvailabilityBlock, 'id' | 'createdAt'>[] }) => {
        for (const item of data) {
          mockBlocks.push({
            id: `block-${mockBlocks.length + 1}`,
            teamId: item.teamId,
            userId: item.userId,
            dayOfWeek: item.dayOfWeek,
            startMinute: item.startMinute,
            endMinute: item.endMinute,
            createdAt: new Date(),
          });
        }
        return { count: data.length };
      },
    ),
  };

  const subscriptionDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { teamId: string } }) => {
      const found = mockSubscriptions.find((s) => s.teamId === where.teamId);
      return found ? { ...found } : null;
    }),
  };

  const mockDbClient = {
    team: teamDelegate,
    membership: membershipDelegate,
    subscription: subscriptionDelegate,
    availabilityBlock: availabilityDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        availabilityBlock: availabilityDelegate,
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
    set: vi.fn(async (key: string, value: string) => {
      mockRedisStore.set(key, { value, expireAt: Date.now() + 300000 });
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      mockRedisStore.delete(key);
      return 1;
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

describe('Weekly Availability (FR-19, FR-20, PRD 7.2)', () => {
  const teamId = '018f3a2b-1000-7000-8000-000000000001';
  const ownerUserId = '018f3a2b-2000-7000-8000-000000000001';
  const managerUserId = '018f3a2b-3000-7000-8000-000000000001';
  const staffUserId = '018f3a2b-4000-7000-8000-000000000001';
  const otherStaffUserId = '018f3a2b-5000-7000-8000-000000000001';

  let managerToken: string;
  let staffToken: string;

  beforeEach(async () => {
    mockTeams = [
      {
        id: teamId,
        name: 'Urgent Care Center',
        timezone: 'America/Chicago',
        shardIndex: 0,
        ownerUserId,
        deletedAt: null,
      },
    ];

    mockMemberships = [
      { id: 'mem-1', teamId, userId: ownerUserId, role: 'OWNER', status: 'ACTIVE' },
      { id: 'mem-2', teamId, userId: managerUserId, role: 'MANAGER', status: 'ACTIVE' },
      { id: 'mem-3', teamId, userId: staffUserId, role: 'STAFF', status: 'ACTIVE' },
      { id: 'mem-4', teamId, userId: otherStaffUserId, role: 'STAFF', status: 'ACTIVE' },
    ];

    mockBlocks = [];
    mockSubscriptions = [
      {
        id: 'sub-1',
        teamId,
        status: 'ACTIVE',
      },
    ];
    mockRedisStore.clear();

    managerToken = await createAccessToken(managerUserId);
    staffToken = await createAccessToken(staffUserId);
  });

  describe('PUT /v1/teams/:teamId/availability/me (FR-19)', () => {
    it('saves availability blocks and merges touching or overlapping blocks on the same day', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability/me`,
        'PUT',
        {
          blocks: [
            // Touching blocks on Monday
            { dayOfWeek: 1, startMinute: 480, endMinute: 720 },
            { dayOfWeek: 1, startMinute: 720, endMinute: 960 },
            // Overlapping block on Monday
            { dayOfWeek: 1, startMinute: 600, endMinute: 840 },
            // Thursday block
            { dayOfWeek: 4, startMinute: 1020, endMinute: 1380 },
          ],
        },
        staffToken,
      );

      const res = await replaceAvailabilityRoute(req, { params: Promise.resolve({ teamId }) });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.blocks).toHaveLength(2);

      // Monday blocks merged into 480 to 960 (08:00 to 16:00)
      expect(json.blocks[0]).toMatchObject({
        teamId,
        userId: staffUserId,
        dayOfWeek: 1,
        startMinute: 480,
        endMinute: 960,
      });

      // Thursday block untouched
      expect(json.blocks[1]).toMatchObject({
        teamId,
        userId: staffUserId,
        dayOfWeek: 4,
        startMinute: 1020,
        endMinute: 1380,
      });
    });

    it('splits a block that crosses midnight into two blocks (FR-19)', async () => {
      // Sunday night from 22:00 (1320) to 04:00 (1680)
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability/me`,
        'PUT',
        {
          blocks: [{ dayOfWeek: 7, startMinute: 1320, endMinute: 1680 }],
        },
        staffToken,
      );

      const res = await replaceAvailabilityRoute(req, { params: Promise.resolve({ teamId }) });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.blocks).toHaveLength(2);

      // Monday: 00:00 to 04:00 (0 to 240)
      expect(json.blocks[0]).toMatchObject({
        dayOfWeek: 1,
        startMinute: 0,
        endMinute: 240,
      });

      // Sunday: 22:00 to 24:00 (1320 to 1440)
      expect(json.blocks[1]).toMatchObject({
        dayOfWeek: 7,
        startMinute: 1320,
        endMinute: 1440,
      });
    });

    it('replaces the whole set of blocks on subsequent save', async () => {
      // First save
      const req1 = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability/me`,
        'PUT',
        {
          blocks: [{ dayOfWeek: 1, startMinute: 480, endMinute: 720 }],
        },
        staffToken,
      );
      await replaceAvailabilityRoute(req1, { params: Promise.resolve({ teamId }) });

      // Second save replaces with different day
      const req2 = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability/me`,
        'PUT',
        {
          blocks: [{ dayOfWeek: 5, startMinute: 540, endMinute: 900 }],
        },
        staffToken,
      );
      const res2 = await replaceAvailabilityRoute(req2, { params: Promise.resolve({ teamId }) });
      expect(res2.status).toBe(200);

      const json = await res2.json();
      expect(json.blocks).toHaveLength(1);
      expect(json.blocks[0].dayOfWeek).toBe(5);
    });

    it('rejects end before or equal to start with 400 VALIDATION_FAILED (FR-19)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability/me`,
        'PUT',
        {
          blocks: [{ dayOfWeek: 1, startMinute: 600, endMinute: 500 }],
        },
        staffToken,
      );
      const res = await replaceAvailabilityRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects more than 28 blocks with 400 VALIDATION_FAILED (FR-19, L-36)', async () => {
      // Build 29 disjoint blocks
      const blocks = [];
      for (let day = 1; day <= 7; day++) {
        for (let i = 0; i < 5; i++) {
          if (blocks.length >= 29) break;
          blocks.push({
            dayOfWeek: day,
            startMinute: i * 120,
            endMinute: i * 120 + 60,
          });
        }
      }

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability/me`,
        'PUT',
        { blocks },
        staffToken,
      );
      const res = await replaceAvailabilityRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('GET /v1/teams/:teamId/availability (PRD 5.1)', () => {
    beforeEach(() => {
      mockBlocks.push(
        {
          id: 'b-staff',
          teamId,
          userId: staffUserId,
          dayOfWeek: 1,
          startMinute: 480,
          endMinute: 960,
          createdAt: new Date(),
        },
        {
          id: 'b-other',
          teamId,
          userId: otherStaffUserId,
          dayOfWeek: 2,
          startMinute: 540,
          endMinute: 1020,
          createdAt: new Date(),
        },
      );
    });

    it('staff can retrieve their own availability', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability`,
        'GET',
        undefined,
        staffToken,
      );
      const res = await getAvailabilityRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.blocks).toHaveLength(1);
      expect(json.blocks[0].userId).toBe(staffUserId);
    });

    it('staff cannot view another members availability (403 FORBIDDEN)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability?userId=${otherStaffUserId}`,
        'GET',
        undefined,
        staffToken,
      );
      const res = await getAvailabilityRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('FORBIDDEN');
    });

    it('manager can view all members availability or query specific member', async () => {
      // All members
      const reqAll = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability`,
        'GET',
        undefined,
        managerToken,
      );
      const resAll = await getAvailabilityRoute(reqAll, { params: Promise.resolve({ teamId }) });
      expect(resAll.status).toBe(200);
      const jsonAll = await resAll.json();
      expect(jsonAll.blocks).toHaveLength(2);

      // Specific member
      const reqSpecific = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/availability?userId=${otherStaffUserId}`,
        'GET',
        undefined,
        managerToken,
      );
      const resSpecific = await getAvailabilityRoute(reqSpecific, {
        params: Promise.resolve({ teamId }),
      });
      expect(resSpecific.status).toBe(200);
      const jsonSpecific = await resSpecific.json();
      expect(jsonSpecific.blocks).toHaveLength(1);
      expect(jsonSpecific.blocks[0].userId).toBe(otherStaffUserId);
    });
  });
});
