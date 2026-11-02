import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getMyShiftsRoute } from '../../../app/v1/me/shifts/route';
import { createAccessToken } from '../../../lib/auth/jwt';

interface MockTeam {
  id: string;
  name: string;
  timezone: string;
  shardIndex: number;
  deletedAt: Date | null;
}

interface MockMembership {
  id: string;
  teamId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'REMOVED' | 'LEFT';
  team: MockTeam;
}

interface MockShift {
  id: string;
  teamId: string;
  assigneeUserId: string;
  startsAt: Date;
  endsAt: Date;
  position: string;
  location: string | null;
  notes: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: Date | null;
  version: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

let mockMemberships: MockMembership[] = [];
let mockShard0Shifts: MockShift[] = [];
let mockShard1Shifts: MockShift[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../lib/db', () => {
  const membershipDelegate = {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: { userId: string; status: string; team?: { deletedAt: null } };
      }) => {
        return mockMemberships
          .filter((m) => {
            if (m.userId !== where.userId) return false;
            if (m.status !== where.status) return false;
            if (where.team?.deletedAt === null && m.team.deletedAt !== null) return false;
            return true;
          })
          .map((m) => ({ ...m }));
      },
    ),
  };

  const createShiftDelegate = (getStore: () => MockShift[]) => ({
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          teamId: { in: string[] };
          assigneeUserId: string;
          deletedAt: null;
          status: string;
          startsAt?: { gte?: Date; lte?: Date };
        };
      }) => {
        return getStore()
          .filter((s) => {
            if (!where.teamId.in.includes(s.teamId)) return false;
            if (s.assigneeUserId !== where.assigneeUserId) return false;
            if (s.deletedAt !== null) return false;
            if (s.status !== where.status) return false;
            if (where.startsAt?.gte && s.startsAt < where.startsAt.gte) return false;
            if (where.startsAt?.lte && s.startsAt > where.startsAt.lte) return false;
            return true;
          })
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map((s) => ({ ...s }));
      },
    ),
  });

  const client0 = {
    membership: membershipDelegate,
    shift: createShiftDelegate(() => mockShard0Shifts),
  };

  const client1 = {
    shift: createShiftDelegate(() => mockShard1Shifts),
  };

  return {
    dbShard0: client0,
    getShardClient: (shardIndex: number) => (shardIndex === 1 ? client1 : client0),
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

describe('My Shifts across All Teams (FR-17, PRD 7.2)', () => {
  const userId = '018f3a2b-1000-7000-8000-000000000001';
  const team1Id = '018f3a2b-2000-7000-8000-000000000001'; // Shard 0, America/New_York
  const team2Id = '018f3a2b-3000-7000-8000-000000000002'; // Shard 1, America/Chicago

  let userToken: string;

  beforeEach(async () => {
    mockMemberships = [
      {
        id: 'mem-1',
        teamId: team1Id,
        userId,
        role: 'STAFF',
        status: 'ACTIVE',
        team: {
          id: team1Id,
          name: 'City Clinic NY',
          timezone: 'America/New_York',
          shardIndex: 0,
          deletedAt: null,
        },
      },
      {
        id: 'mem-2',
        teamId: team2Id,
        userId,
        role: 'STAFF',
        status: 'ACTIVE',
        team: {
          id: team2Id,
          name: 'Metro Urgent Care Chicago',
          timezone: 'America/Chicago',
          shardIndex: 1,
          deletedAt: null,
        },
      },
    ];

    mockShard0Shifts = [];
    mockShard1Shifts = [];
    mockRedisStore.clear();

    userToken = await createAccessToken(userId);
  });

  it('queries both shards in parallel, excludes drafts, formats in team timezone, and detects cross-team overlaps (FR-17)', async () => {
    // Team 1 (NY, UTC-4): 2026-11-05 08:00 NY -> 12:00 UTC to 20:00 UTC
    const shiftTeam1Published: MockShift = {
      id: '018f3a2b-8000-7000-8000-000000000001',
      teamId: team1Id,
      assigneeUserId: userId,
      startsAt: new Date('2026-11-05T12:00:00Z'),
      endsAt: new Date('2026-11-05T20:00:00Z'),
      position: 'Staff Nurse',
      location: 'Ward 3',
      notes: null,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      version: 1,
      createdByUserId: 'creator-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    // Team 1 Draft shift (must be excluded per FR-17)
    const shiftTeam1Draft: MockShift = {
      id: '018f3a2b-8000-7000-8000-000000000002',
      teamId: team1Id,
      assigneeUserId: userId,
      startsAt: new Date('2026-11-06T12:00:00Z'),
      endsAt: new Date('2026-11-06T20:00:00Z'),
      position: 'Staff Nurse',
      location: null,
      notes: null,
      status: 'DRAFT',
      publishedAt: null,
      version: 1,
      createdByUserId: 'creator-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    mockShard0Shifts.push(shiftTeam1Published, shiftTeam1Draft);

    // Team 2 (Chicago, UTC-5): overlapping shift on 2026-11-05 14:00 UTC to 22:00 UTC
    const shiftTeam2Published: MockShift = {
      id: '018f3a2b-8000-7000-8000-000000000010',
      teamId: team2Id,
      assigneeUserId: userId,
      startsAt: new Date('2026-11-05T14:00:00Z'),
      endsAt: new Date('2026-11-05T22:00:00Z'),
      position: 'ER Nurse',
      location: 'ER Floor',
      notes: null,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      version: 1,
      createdByUserId: 'creator-2',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    mockShard1Shifts.push(shiftTeam2Published);

    const req = makeRequest('http://localhost:3000/v1/me/shifts', 'GET', userToken);
    const res = await getMyShiftsRoute(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const json = await res.json();

    // Draft is excluded -> exactly 2 published shifts returned
    expect(json.shifts).toHaveLength(2);

    const shift1 = json.shifts[0];
    expect(shift1.id).toBe(shiftTeam1Published.id);
    expect(shift1.teamName).toBe('City Clinic NY');
    expect(shift1.teamTimezone).toBe('America/New_York');
    // 12:00 UTC is 07:00 EST / 08:00 EDT in NY timezone
    expect(shift1.startsLocal).toContain('T07:00:00');
    expect(shift1.hasOverlapAcrossTeams).toBe(true);
    expect(shift1.overlappingTeamNames).toContain('Metro Urgent Care Chicago');

    const shift2 = json.shifts[1];
    expect(shift2.id).toBe(shiftTeam2Published.id);
    expect(shift2.teamName).toBe('Metro Urgent Care Chicago');
    expect(shift2.teamTimezone).toBe('America/Chicago');
    expect(shift2.hasOverlapAcrossTeams).toBe(true);
    expect(shift2.overlappingTeamNames).toContain('City Clinic NY');
  });

  it('returns empty list when user has no active memberships', async () => {
    mockMemberships = [];
    const req = makeRequest('http://localhost:3000/v1/me/shifts', 'GET', userToken);
    const res = await getMyShiftsRoute(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.shifts).toEqual([]);
  });
});
