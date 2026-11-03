import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { handlePipelineTeamDailyStats } from '../../../worker/jobs/pipeline/team-daily-stats';
import { GET as getTeamStatsRoute } from '../../../app/v1/teams/[teamId]/stats/route';
import { createAccessToken } from '../../../lib/auth/jwt';

interface MockShift {
  id: string;
  teamId: string;
  assigneeUserId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'DRAFT' | 'PUBLISHED';
  deletedAt: Date | null;
}

interface MockSwap {
  id: string;
  teamId: string;
  status: 'OPEN' | 'ACCEPTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELED';
  createdAt: Date;
  decidedAt: Date | null;
  updatedAt: Date;
}

interface MockTeamDailyStats {
  id: string;
  teamId: string;
  date: Date;
  scheduledMinutes: number;
  shiftCount: number;
  swapsRequested: number;
  swapsApproved: number;
  swapsRejected: number;
  medianApprovalMinutes: number | null;
  computedAt: Date;
}

interface MockMemberWeeklyStats {
  id: string;
  teamId: string;
  userId: string;
  weekStart: Date;
  scheduledMinutes: number;
  computedAt: Date;
}

let mockShifts: MockShift[] = [];
let mockSwaps: MockSwap[] = [];
let mockDailyStats: MockTeamDailyStats[] = [];
let mockWeeklyStats: MockMemberWeeklyStats[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

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

vi.mock('../../../lib/data/router', () => ({
  getTeamShardIndex: vi.fn(async () => 0),
  shouldReadPrimary: vi.fn(async () => true),
}));

vi.mock('../../../lib/db', () => {
  const shardClient = {
    shift: {
      findMany: vi.fn(async ({ where }: { where: { startsAt?: { gte?: Date; lte?: Date } } }) => {
        return mockShifts.filter((s) => {
          if (s.status !== 'PUBLISHED' || s.deletedAt !== null) return false;
          if (where.startsAt?.gte && s.startsAt < where.startsAt.gte) return false;
          if (where.startsAt?.lte && s.startsAt > where.startsAt.lte) return false;
          return true;
        });
      }),
    },
    swapRequest: {
      count: vi.fn(
        async ({
          where,
        }: {
          where: {
            status?: string;
            createdAt?: { gte?: Date; lte?: Date };
            decidedAt?: { gte?: Date; lte?: Date };
          };
        }) => {
          return mockSwaps.filter((s) => {
            if (where.status && s.status !== where.status) return false;
            if (where.createdAt?.gte && s.createdAt < where.createdAt.gte) return false;
            if (where.createdAt?.lte && s.createdAt > where.createdAt.lte) return false;
            if (where.decidedAt?.gte && (!s.decidedAt || s.decidedAt < where.decidedAt.gte))
              return false;
            if (where.decidedAt?.lte && (!s.decidedAt || s.decidedAt > where.decidedAt.lte))
              return false;
            return true;
          }).length;
        },
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { status?: string; decidedAt?: { gte?: Date; lte?: Date } };
        }) => {
          return mockSwaps.filter((s) => {
            if (where.status && s.status !== where.status) return false;
            if (where.decidedAt?.gte && (!s.decidedAt || s.decidedAt < where.decidedAt.gte))
              return false;
            if (where.decidedAt?.lte && (!s.decidedAt || s.decidedAt > where.decidedAt.lte))
              return false;
            return true;
          });
        },
      ),
    },
    teamDailyStats: {
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Omit<MockTeamDailyStats, 'id' | 'computedAt'>;
          update: Partial<MockTeamDailyStats>;
        }) => {
          const existing = mockDailyStats.find(
            (d) => d.teamId === create.teamId && d.date.getTime() === create.date.getTime(),
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const created: MockTeamDailyStats = {
            id: crypto.randomUUID(),
            ...create,
            computedAt: new Date(),
          };
          mockDailyStats.push(created);
          return created;
        },
      ),
      findMany: vi.fn(async ({ where }: { where: { teamId: string; date?: { gte?: Date } } }) => {
        return mockDailyStats.filter((d) => {
          if (d.teamId !== where.teamId) return false;
          if (where.date?.gte && d.date < where.date.gte) return false;
          return true;
        });
      }),
    },
    memberWeeklyStats: {
      upsert: vi.fn(
        async ({
          create,
          update,
        }: {
          create: Omit<MockMemberWeeklyStats, 'id' | 'computedAt'>;
          update: Partial<MockMemberWeeklyStats>;
        }) => {
          const existing = mockWeeklyStats.find(
            (w) =>
              w.teamId === create.teamId &&
              w.userId === create.userId &&
              w.weekStart.getTime() === create.weekStart.getTime(),
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const created: MockMemberWeeklyStats = {
            id: crypto.randomUUID(),
            ...create,
            computedAt: new Date(),
          };
          mockWeeklyStats.push(created);
          return created;
        },
      ),
      findMany: vi.fn(
        async ({ where }: { where: { teamId: string; weekStart?: { gte?: Date } } }) => {
          return mockWeeklyStats.filter((w) => {
            if (w.teamId !== where.teamId) return false;
            if (where.weekStart?.gte && w.weekStart < where.weekStart.gte) return false;
            return true;
          });
        },
      ),
    },
  };

  const globalClient = {
    team: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return {
          id: where.id,
          name: 'City Clinic',
          timezone: 'America/New_York',
          weekStartsOn: 1, // Monday
          shardIndex: 0,
        };
      }),
    },
    membership: {
      findUnique: vi.fn(
        async ({ where }: { where: { teamId_userId: { teamId: string; userId: string } } }) => {
          if (where.teamId_userId.userId === 'user-owner') {
            return { role: 'OWNER', status: 'ACTIVE' };
          }
          if (where.teamId_userId.userId === 'user-manager') {
            return { role: 'MANAGER', status: 'ACTIVE' };
          }
          if (where.teamId_userId.userId === 'user-staff') {
            return { role: 'STAFF', status: 'ACTIVE' };
          }
          return null;
        },
      ),
    },
    subscription: {
      findUnique: vi.fn(async () => ({ status: 'ACTIVE' })),
    },
  };

  return {
    dbShard0: globalClient,
    getShardClient: vi.fn(() => shardClient),
  };
});

describe('FR-46 Nightly team stats & GET /v1/teams/:teamId/stats', () => {
  const teamId = '018f6e80-7711-7000-8000-000000000001';
  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;
  let outsiderToken: string;

  beforeEach(async () => {
    mockShifts = [];
    mockSwaps = [];
    mockDailyStats = [];
    mockWeeklyStats = [];
    mockRedisStore.clear();

    ownerToken = await createAccessToken('user-owner');
    managerToken = await createAccessToken('user-manager');
    staffToken = await createAccessToken('user-staff');
    outsiderToken = await createAccessToken('user-outsider');
  });

  describe('pipeline.team-daily-stats worker job (FR-46, PRD 6.2)', () => {
    it('computes daily hours, shift count, swap counts, median approval time and member weekly hours', async () => {
      // Create 2 shifts on 2026-11-03: one 8 hours (480 min), one 4 hours (240 min)
      const startsAt1 = new Date('2026-11-03T13:00:00Z'); // 08:00 EST
      const endsAt1 = new Date('2026-11-03T21:00:00Z'); // 16:00 EST (480 min)
      mockShifts.push({
        id: 'shift-1',
        teamId,
        assigneeUserId: 'user-staff',
        startsAt: startsAt1,
        endsAt: endsAt1,
        status: 'PUBLISHED',
        deletedAt: null,
      });

      const startsAt2 = new Date('2026-11-03T21:00:00Z'); // 16:00 EST
      const endsAt2 = new Date('2026-11-04T01:00:00Z'); // 20:00 EST (240 min)
      mockShifts.push({
        id: 'shift-2',
        teamId,
        assigneeUserId: 'user-manager',
        startsAt: startsAt2,
        endsAt: endsAt2,
        status: 'PUBLISHED',
        deletedAt: null,
      });

      // Create swaps on that day: 2 approved (durations: 30 min, 50 min -> median 40 min)
      mockSwaps.push({
        id: 'swap-1',
        teamId,
        status: 'APPROVED',
        createdAt: new Date('2026-11-03T14:00:00Z'),
        decidedAt: new Date('2026-11-03T14:30:00Z'), // 30 min
        updatedAt: new Date('2026-11-03T14:30:00Z'),
      });
      mockSwaps.push({
        id: 'swap-2',
        teamId,
        status: 'APPROVED',
        createdAt: new Date('2026-11-03T15:00:00Z'),
        decidedAt: new Date('2026-11-03T15:50:00Z'), // 50 min
        updatedAt: new Date('2026-11-03T15:50:00Z'),
      });
      mockSwaps.push({
        id: 'swap-3',
        teamId,
        status: 'REJECTED',
        createdAt: new Date('2026-11-03T16:00:00Z'),
        decidedAt: new Date('2026-11-03T16:20:00Z'),
        updatedAt: new Date('2026-11-03T16:20:00Z'),
      });

      const result = await handlePipelineTeamDailyStats({
        teamId,
        date: '2026-11-03',
      });

      expect(result.success).toBe(true);
      expect(mockDailyStats).toHaveLength(1);

      const daily = mockDailyStats[0];
      expect(daily?.shiftCount).toBe(2);
      expect(daily?.scheduledMinutes).toBe(720); // 480 + 240
      expect(daily?.swapsApproved).toBe(2);
      expect(daily?.swapsRejected).toBe(1);
      expect(daily?.medianApprovalMinutes).toBe(40); // (30 + 50) / 2 = 40

      // Member weekly stats
      expect(mockWeeklyStats).toHaveLength(2);
      const staffWeekly = mockWeeklyStats.find((w) => w.userId === 'user-staff');
      expect(staffWeekly?.scheduledMinutes).toBe(480);
    });
  });

  describe('GET /v1/teams/:teamId/stats endpoint (FR-46, PRD 7.2)', () => {
    beforeEach(() => {
      mockDailyStats.push({
        id: 'ds-1',
        teamId,
        date: new Date('2026-11-03T00:00:00Z'),
        scheduledMinutes: 720,
        shiftCount: 2,
        swapsRequested: 3,
        swapsApproved: 2,
        swapsRejected: 1,
        medianApprovalMinutes: 40,
        computedAt: new Date(),
      });

      mockWeeklyStats.push({
        id: 'ws-1',
        teamId,
        userId: '018f6e80-7711-7000-8000-000000000002',
        weekStart: new Date('2026-11-02T00:00:00Z'),
        scheduledMinutes: 2520, // 42 hours (> 40h)
        computedAt: new Date(),
      });
    });

    it('allows manager to view team stats, returning formatted daily and weekly items (FR-46)', async () => {
      const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/stats`, {
        method: 'GET',
        headers: { authorization: `Bearer ${managerToken}` },
      });

      const res = await getTeamStatsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        dailyStats: Array<{
          date: string;
          scheduledHours: number;
          shiftCount: number;
          medianApprovalMinutes: number;
        }>;
        memberWeeklyStats: Array<{
          userId: string;
          scheduledHours: number;
          overFortyHours: boolean;
        }>;
      };

      expect(body.dailyStats).toHaveLength(1);
      expect(body.dailyStats[0]?.scheduledHours).toBe(12); // 720 / 60
      expect(body.dailyStats[0]?.shiftCount).toBe(2);
      expect(body.dailyStats[0]?.medianApprovalMinutes).toBe(40);

      expect(body.memberWeeklyStats).toHaveLength(1);
      expect(body.memberWeeklyStats[0]?.scheduledHours).toBe(42); // 2520 / 60
      expect(body.memberWeeklyStats[0]?.overFortyHours).toBe(true);
    });

    it('allows owner to view team stats', async () => {
      const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/stats`, {
        method: 'GET',
        headers: { authorization: `Bearer ${ownerToken}` },
      });

      const res = await getTeamStatsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);
    });

    it('rejects staff with 403 FORBIDDEN', async () => {
      const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/stats`, {
        method: 'GET',
        headers: { authorization: `Bearer ${staffToken}` },
      });

      const res = await getTeamStatsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(403);
    });

    it('rejects non-member with 404 NOT_FOUND (B-19, FR-43)', async () => {
      const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/stats`, {
        method: 'GET',
        headers: { authorization: `Bearer ${outsiderToken}` },
      });

      const res = await getTeamStatsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(404);
    });
  });
});
