import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getFeedRoute } from '../../../app/v1/teams/[teamId]/feed/route';
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

interface MockActivityEvent {
  id: string;
  teamId: string;
  type: string;
  actorUserId: string | null;
  subjectShiftId: string | null;
  subjectUserId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
let mockEvents: MockActivityEvent[] = [];
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
      async ({
        where,
      }: {
        where: { teamId_userId?: { teamId: string; userId: string }; id?: string };
      }) => {
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

  const activityEventDelegate = {
    findMany: vi.fn(
      async ({
        where,
        take,
      }: {
        where: {
          teamId: string;
          OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
        };
        take?: number;
      }) => {
        let list = mockEvents.filter((e) => e.teamId === where.teamId);

        if (where.OR && where.OR.length >= 2) {
          const firstCond = where.OR[0];
          const secondCond = where.OR[1];
          const ltDate =
            firstCond && 'lt' in firstCond.createdAt ? firstCond.createdAt.lt : undefined;
          const eqDate =
            secondCond && 'createdAt' in secondCond ? (secondCond.createdAt as Date) : undefined;
          const ltId = secondCond && 'id' in secondCond ? secondCond.id.lt : undefined;

          list = list.filter((e) => {
            if (ltDate && e.createdAt < ltDate) return true;
            if (eqDate && ltId && e.createdAt.getTime() === eqDate.getTime() && e.id < ltId) {
              return true;
            }
            return false;
          });
        }

        list.sort((a, b) => {
          const diffTime = b.createdAt.getTime() - a.createdAt.getTime();
          if (diffTime !== 0) return diffTime;
          return b.id.localeCompare(a.id);
        });

        if (take !== undefined) {
          list = list.slice(0, take);
        }

        return list.map((e) => ({ ...e }));
      },
    ),
  };

  const mockDbClient = {
    team: teamDelegate,
    membership: membershipDelegate,
    activityEvent: activityEventDelegate,
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

function makeRequest(url: string, method: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return new NextRequest(url, {
    method,
    headers,
  });
}

describe('Activity Feed with Keyset Pagination (FR-26, PRD 7.10)', () => {
  const teamId = '018f3a2b-1000-7000-8000-000000000001';
  const memberUserId = '018f3a2b-2000-7000-8000-000000000001';
  const nonMemberUserId = '018f3a2b-3000-7000-8000-000000000001';

  let memberToken: string;
  let nonMemberToken: string;

  beforeEach(async () => {
    mockTeams = [
      {
        id: teamId,
        name: 'Urgent Care Center',
        timezone: 'America/Chicago',
        shardIndex: 0,
        ownerUserId: memberUserId,
        deletedAt: null,
      },
    ];

    mockMemberships = [
      { id: 'mem-1', teamId, userId: memberUserId, role: 'STAFF', status: 'ACTIVE' },
    ];

    mockEvents = [];
    mockRedisStore.clear();

    memberToken = await createAccessToken(memberUserId);
    nonMemberToken = await createAccessToken(nonMemberUserId);
  });

  it('returns 404 NOT_FOUND for non-members (B-19, FR-43)', async () => {
    const req = makeRequest(`http://localhost:3000/v1/teams/${teamId}/feed`, 'GET', nonMemberToken);
    const res = await getFeedRoute(req, { params: Promise.resolve({ teamId }) });
    expect(res.status).toBe(404);
  });

  it('returns 400 CURSOR_INVALID when given a malformed cursor', async () => {
    const req = makeRequest(
      `http://localhost:3000/v1/teams/${teamId}/feed?cursor=not-a-valid-base64-json`,
      'GET',
      memberToken,
    );
    const res = await getFeedRoute(req, { params: Promise.resolve({ teamId }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('CURSOR_INVALID');
  });

  it('pages cleanly through 45 events created in the same transaction without repeating or skipping (FR-26)', async () => {
    // 45 events created at the exact same millisecond timestamp
    const sharedTimestamp = new Date('2026-11-02T12:00:00.000Z');
    for (let i = 1; i <= 45; i++) {
      mockEvents.push({
        id: `018f3a2b-9000-7000-8000-${String(i).padStart(12, '0')}`,
        teamId,
        type: 'SHIFT_CREATED',
        actorUserId: memberUserId,
        subjectShiftId: null,
        subjectUserId: null,
        payload: { shiftIndex: i },
        createdAt: sharedTimestamp,
      });
    }

    // Page 1: default limit 20
    const reqPage1 = makeRequest(
      `http://localhost:3000/v1/teams/${teamId}/feed`,
      'GET',
      memberToken,
    );
    const resPage1 = await getFeedRoute(reqPage1, { params: Promise.resolve({ teamId }) });
    expect(resPage1.status).toBe(200);
    const json1 = await resPage1.json();
    expect(json1.events).toHaveLength(20);
    expect(json1.nextCursor).not.toBeNull();

    // Page 2: pass nextCursor from page 1
    const reqPage2 = makeRequest(
      `http://localhost:3000/v1/teams/${teamId}/feed?cursor=${encodeURIComponent(json1.nextCursor)}`,
      'GET',
      memberToken,
    );
    const resPage2 = await getFeedRoute(reqPage2, { params: Promise.resolve({ teamId }) });
    expect(resPage2.status).toBe(200);
    const json2 = await resPage2.json();
    expect(json2.events).toHaveLength(20);
    expect(json2.nextCursor).not.toBeNull();

    // Page 3: final 5 events
    const reqPage3 = makeRequest(
      `http://localhost:3000/v1/teams/${teamId}/feed?cursor=${encodeURIComponent(json2.nextCursor)}`,
      'GET',
      memberToken,
    );
    const resPage3 = await getFeedRoute(reqPage3, { params: Promise.resolve({ teamId }) });
    expect(resPage3.status).toBe(200);
    const json3 = await resPage3.json();
    expect(json3.events).toHaveLength(5);
    expect(json3.nextCursor).toBeNull();

    // Verify all 45 events are unique and present
    const allIds = [
      ...json1.events.map((e: { id: string }) => e.id),
      ...json2.events.map((e: { id: string }) => e.id),
      ...json3.events.map((e: { id: string }) => e.id),
    ];
    expect(allIds).toHaveLength(45);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(45);
  });
});
