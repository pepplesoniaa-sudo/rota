import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as getShiftsRoute,
  POST as createShiftRoute,
} from '../../../app/v1/teams/[teamId]/shifts/route';
import {
  DELETE as deleteShiftRoute,
  GET as getShiftRoute,
  PATCH as updateShiftRoute,
} from '../../../app/v1/teams/[teamId]/shifts/[shiftId]/route';
import { createAccessToken } from '../../../lib/auth/jwt';

interface MockTeam {
  id: string;
  name: string;
  timezone: string;
  shardIndex: number;
  ownerUserId: string;
  createdAt: Date;
  deletedAt: Date | null;
}

interface MockMembership {
  id: string;
  teamId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'REMOVED' | 'LEFT';
}

interface MockSubscription {
  id: string;
  teamId: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'CANCELED';
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

interface MockAvailabilityBlock {
  id: string;
  teamId: string;
  userId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface MockSwapRequest {
  id: string;
  teamId: string;
  status: 'PENDING_PEER' | 'PENDING_MANAGER' | 'APPROVED' | 'REJECTED' | 'DECLINED' | 'CANCELED';
  requesterShiftId: string;
  targetShiftId: string | null;
  version: number;
}

let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
let mockSubscriptions: MockSubscription[] = [];
let mockShifts: MockShift[] = [];
let mockAvailabilityBlocks: MockAvailabilityBlock[] = [];
let mockSwapRequests: MockSwapRequest[] = [];
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
    findMany: vi.fn(async ({ where }: { where: { teamId: string; userId?: { in: string[] } } }) => {
      return mockMemberships
        .filter((m) => {
          if (m.teamId !== where.teamId) return false;
          if (where.userId?.in && !where.userId.in.includes(m.userId)) return false;
          return true;
        })
        .map((m) => ({ ...m }));
    }),
  };

  const subscriptionDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { teamId: string } }) => {
      const found = mockSubscriptions.find((s) => s.teamId === where.teamId);
      return found ? { ...found } : null;
    }),
  };

  const shiftDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = mockShifts.find((s) => s.id === where.id);
      return found ? { ...found } : null;
    }),
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: {
          teamId: string;
          assigneeUserId: string;
          deletedAt: null;
          id?: { not: string };
          startsAt: { lt: Date };
          endsAt: { gt: Date };
        };
      }) => {
        const found = mockShifts.find((s) => {
          if (s.teamId !== where.teamId) return false;
          if (s.assigneeUserId !== where.assigneeUserId) return false;
          if (s.deletedAt !== null) return false;
          if (where.id?.not && s.id === where.id.not) return false;
          return s.startsAt < where.startsAt.lt && s.endsAt > where.endsAt.gt;
        });
        return found ? { ...found } : null;
      },
    ),
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          teamId: string;
          deletedAt: null;
          status?: string;
          startsAt?: { lte: Date };
          endsAt?: { gte: Date };
        };
      }) => {
        return mockShifts
          .filter((s) => {
            if (s.teamId !== where.teamId) return false;
            if (s.deletedAt !== null) return false;
            if (where.status && s.status !== where.status) return false;
            if (where.startsAt?.lte && s.startsAt > where.startsAt.lte) return false;
            if (where.endsAt?.gte && s.endsAt < where.endsAt.gte) return false;
            return true;
          })
          .map((s) => ({ ...s }));
      },
    ),
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<MockShift, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
      }) => {
        const record: MockShift = {
          id: `018f3a2b-8000-7000-8000-${String(mockShifts.length + 1).padStart(12, '0')}`,
          teamId: data.teamId,
          assigneeUserId: data.assigneeUserId,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          position: data.position,
          location: data.location ?? null,
          notes: data.notes ?? null,
          status: data.status,
          publishedAt: null,
          version: data.version ?? 1,
          createdByUserId: data.createdByUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        mockShifts.push(record);
        return { ...record };
      },
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const found = mockShifts.find((s) => s.id === where.id);
        if (!found) throw new Error('Shift not found');
        const updated = { ...found };
        for (const [key, val] of Object.entries(data)) {
          if (key === 'version' && typeof val === 'object' && val && 'increment' in val) {
            updated.version += (val as { increment: number }).increment;
          } else {
            (updated as Record<string, unknown>)[key] = val;
          }
        }
        updated.updatedAt = new Date();
        const index = mockShifts.findIndex((s) => s.id === where.id);
        mockShifts[index] = updated;
        return { ...updated };
      },
    ),
  };

  const availabilityDelegate = {
    findMany: vi.fn(async ({ where }: { where: { teamId: string; userId: string } }) => {
      return mockAvailabilityBlocks
        .filter((b) => b.teamId === where.teamId && b.userId === where.userId)
        .map((b) => ({ ...b }));
    }),
  };

  const swapRequestDelegate = {
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: {
          teamId: string;
          OR?: ({ requesterShiftId: string } | { targetShiftId: string })[];
          status?: { in: string[] };
        };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const swap of mockSwapRequests) {
          if (swap.teamId !== where.teamId) continue;
          if (where.status?.in && !where.status.in.includes(swap.status)) continue;
          let match = false;
          if (where.OR) {
            for (const cond of where.OR) {
              if ('requesterShiftId' in cond && swap.requesterShiftId === cond.requesterShiftId) {
                match = true;
              }
              if ('targetShiftId' in cond && swap.targetShiftId === cond.targetShiftId) {
                match = true;
              }
            }
          } else {
            match = true;
          }
          if (match) {
            if (data.status) swap.status = data.status as MockSwapRequest['status'];
            if (data.version && typeof data.version === 'object' && 'increment' in data.version) {
              swap.version += (data.version as { increment: number }).increment;
            }
            count++;
          }
        }
        return { count };
      },
    ),
  };

  const mockDbClient = {
    team: teamDelegate,
    membership: membershipDelegate,
    subscription: subscriptionDelegate,
    shift: shiftDelegate,
    availabilityBlock: availabilityDelegate,
    swapRequest: swapRequestDelegate,
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

describe('Shift Management (FR-15, FR-15c, FR-16, FR-18, FR-20)', () => {
  const teamId = '018f3a2b-1000-7000-8000-000000000001';
  const ownerUserId = '018f3a2b-2000-7000-8000-000000000001';
  const managerUserId = '018f3a2b-3000-7000-8000-000000000001';
  const staffUserId = '018f3a2b-4000-7000-8000-000000000001';
  const outsiderUserId = '018f3a2b-5000-7000-8000-000000000001';

  let ownerToken: string;
  let managerToken: string;
  let staffToken: string;
  let outsiderToken: string;

  beforeEach(async () => {
    mockTeams = [
      {
        id: teamId,
        name: 'Urgent Care Center',
        timezone: 'America/Chicago',
        shardIndex: 0,
        ownerUserId,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        deletedAt: null,
      },
    ];

    mockMemberships = [
      { id: 'mem-1', teamId, userId: ownerUserId, role: 'OWNER', status: 'ACTIVE' },
      { id: 'mem-2', teamId, userId: managerUserId, role: 'MANAGER', status: 'ACTIVE' },
      { id: 'mem-3', teamId, userId: staffUserId, role: 'STAFF', status: 'ACTIVE' },
    ];

    mockSubscriptions = [{ id: 'sub-1', teamId, status: 'ACTIVE' }];

    mockShifts = [];
    mockAvailabilityBlocks = [];
    mockSwapRequests = [];
    mockRedisStore.clear();

    ownerToken = await createAccessToken(ownerUserId);
    managerToken = await createAccessToken(managerUserId);
    staffToken = await createAccessToken(staffUserId);
    outsiderToken = await createAccessToken(outsiderUserId);
  });

  describe('POST /v1/teams/:teamId/shifts (FR-15, FR-15c)', () => {
    it('creates shift as DRAFT and resolves local wall-clock times to UTC instants', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T07:00:00',
          endsLocal: '2026-11-03T15:30:00',
          position: 'RN',
          location: 'Floor 2',
          notes: 'Covering triage',
        },
        managerToken,
      );

      const res = await createShiftRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.shift).toMatchObject({
        teamId,
        assigneeUserId: staffUserId,
        position: 'RN',
        location: 'Floor 2',
        notes: 'Covering triage',
        status: 'DRAFT',
        version: 1,
        startsLocal: '2026-11-03T07:00:00',
        endsLocal: '2026-11-03T15:30:00',
      });
      // In America/Chicago (-06:00 CST in November), 07:00 local is 13:00 UTC
      expect(json.shift.startsAt).toBe('2026-11-03T13:00:00.000Z');
      expect(json.shift.endsAt).toBe('2026-11-03T21:30:00.000Z');
      expect(mockShifts).toHaveLength(1);
    });

    it('rejects spring-forward non-existent time with 400 SHIFT_TIME_NONEXISTENT', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-03-08T02:30:00',
          endsLocal: '2026-03-08T10:00:00',
          position: 'RN',
        },
        managerToken,
      );

      const res = await createShiftRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.code).toBe('SHIFT_TIME_NONEXISTENT');
    });

    it('uses earlier instant for fall-back by default and later instant when requested', async () => {
      // 1. Earlier instant (default)
      const req1 = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-01T01:30:00',
          endsLocal: '2026-11-01T09:00:00',
          position: 'RN',
        },
        managerToken,
      );
      const res1 = await createShiftRoute(req1, { params: Promise.resolve({ teamId }) });
      expect(res1.status).toBe(201);
      const json1 = await res1.json();
      expect(json1.shift.startsAt).toBe('2026-11-01T06:30:00.000Z');

      // Clear shifts for clean state
      mockShifts = [];

      // 2. Later instant (startsUseLaterOffset: true)
      const req2 = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-01T01:30:00',
          endsLocal: '2026-11-01T09:00:00',
          startsUseLaterOffset: true,
          position: 'RN',
        },
        managerToken,
      );
      const res2 = await createShiftRoute(req2, { params: Promise.resolve({ teamId }) });
      expect(res2.status).toBe(201);
      const json2 = await res2.json();
      expect(json2.shift.startsAt).toBe('2026-11-01T07:30:00.000Z');
    });

    it('rejects duration under 15 minutes or over 16 hours with 400 SHIFT_DURATION_INVALID', async () => {
      // 10 minutes duration
      const reqUnder = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T07:00:00',
          endsLocal: '2026-11-03T07:10:00',
          position: 'RN',
        },
        managerToken,
      );
      const resUnder = await createShiftRoute(reqUnder, { params: Promise.resolve({ teamId }) });
      expect(resUnder.status).toBe(400);
      const jsonUnder = await resUnder.json();
      expect(jsonUnder.error.code).toBe('SHIFT_DURATION_INVALID');

      // 17 hours duration
      const reqOver = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T07:00:00',
          endsLocal: '2026-11-04T00:30:00',
          position: 'RN',
        },
        managerToken,
      );
      const resOver = await createShiftRoute(reqOver, { params: Promise.resolve({ teamId }) });
      expect(resOver.status).toBe(400);
      const jsonOver = await resOver.json();
      expect(jsonOver.error.code).toBe('SHIFT_DURATION_INVALID');
    });

    it('rejects overlapping shift with 409 SHIFT_OVERLAP', async () => {
      // Seed an existing shift
      mockShifts.push({
        id: 'shift-1',
        teamId,
        assigneeUserId: staffUserId,
        startsAt: new Date('2026-11-03T13:00:00.000Z'), // 07:00 Chicago
        endsAt: new Date('2026-11-03T21:00:00.000Z'), // 15:00 Chicago
        position: 'RN',
        location: null,
        notes: null,
        status: 'DRAFT',
        publishedAt: null,
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      // Try to create overlapping shift (09:00 to 17:00 Chicago)
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T09:00:00',
          endsLocal: '2026-11-03T17:00:00',
          position: 'RN',
        },
        managerToken,
      );
      const res = await createShiftRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('SHIFT_OVERLAP');
    });

    it('returns 409 AVAILABILITY_WARNING if assignee is not available unless acknowledged', async () => {
      // Tuesday 08:00 to 12:00 available (480 to 720)
      mockAvailabilityBlocks.push({
        id: 'block-1',
        teamId,
        userId: staffUserId,
        dayOfWeek: 2, // Tuesday (2026-11-03 is Tuesday)
        startMinute: 480,
        endMinute: 720,
      });

      // Shift is 07:00 to 15:00 (420 to 900) -> partially outside availability
      const req1 = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T07:00:00',
          endsLocal: '2026-11-03T15:00:00',
          position: 'RN',
        },
        managerToken,
      );
      const res1 = await createShiftRoute(req1, { params: Promise.resolve({ teamId }) });
      expect(res1.status).toBe(409);
      const json1 = await res1.json();
      expect(json1.error.code).toBe('AVAILABILITY_WARNING');

      // Now send with acknowledgeAvailability: true -> succeeds
      const req2 = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T07:00:00',
          endsLocal: '2026-11-03T15:00:00',
          position: 'RN',
          acknowledgeAvailability: true,
        },
        managerToken,
      );
      const res2 = await createShiftRoute(req2, { params: Promise.resolve({ teamId }) });
      expect(res2.status).toBe(201);
    });

    it('returns 403 FORBIDDEN when staff attempts to create shift', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T07:00:00',
          endsLocal: '2026-11-03T15:00:00',
          position: 'RN',
        },
        staffToken,
      );
      const res = await createShiftRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(403);
    });

    it('returns 404 NOT_FOUND for non-member of team (B-19)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T07:00:00',
          endsLocal: '2026-11-03T15:00:00',
          position: 'RN',
        },
        outsiderToken,
      );
      const res = await createShiftRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(404);
    });

    it('allows owner to create a shift (Manager+ power)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts`,
        'POST',
        {
          assigneeUserId: staffUserId,
          startsLocal: '2026-11-03T07:00:00',
          endsLocal: '2026-11-03T15:00:00',
          position: 'RN',
        },
        ownerToken,
      );
      const res = await createShiftRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(201);
    });
  });

  describe('GET & PATCH & DELETE /v1/teams/:teamId/shifts/:shiftId (FR-16, FR-18)', () => {
    const shiftId = '018f3a2b-8000-7000-8000-000000000001';

    beforeEach(() => {
      mockShifts.push({
        id: shiftId,
        teamId,
        assigneeUserId: staffUserId,
        startsAt: new Date('2026-11-03T13:00:00.000Z'),
        endsAt: new Date('2026-11-03T21:00:00.000Z'),
        position: 'RN',
        location: 'Clinic 1',
        notes: null,
        status: 'DRAFT',
        publishedAt: null,
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
    });

    it('hides DRAFT shift from staff (returns 404 NOT_FOUND)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/${shiftId}`,
        'GET',
        undefined,
        staffToken,
      );
      const res = await getShiftRoute(req, { params: Promise.resolve({ teamId, shiftId }) });
      expect(res.status).toBe(404);
    });

    it('allows manager to view DRAFT shift', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/${shiftId}`,
        'GET',
        undefined,
        managerToken,
      );
      const res = await getShiftRoute(req, { params: Promise.resolve({ teamId, shiftId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.shift.id).toBe(shiftId);
      expect(json.shift.status).toBe('DRAFT');
    });

    it('updates shift and increments version with 200', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/${shiftId}`,
        'PATCH',
        {
          position: 'Charge Nurse',
          location: 'ICU',
          version: 1,
        },
        managerToken,
      );
      const res = await updateShiftRoute(req, { params: Promise.resolve({ teamId, shiftId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.shift.position).toBe('Charge Nurse');
      expect(json.shift.location).toBe('ICU');
      expect(json.shift.version).toBe(2);
    });

    it('returns 409 VERSION_CONFLICT on optimistic version mismatch', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/${shiftId}`,
        'PATCH',
        {
          position: 'Charge Nurse',
          version: 99,
        },
        managerToken,
      );
      const res = await updateShiftRoute(req, { params: Promise.resolve({ teamId, shiftId }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('VERSION_CONFLICT');
    });

    it('cancels open swaps when shift time or assignee changes (FR-16)', async () => {
      // Seed open swap on this shift
      mockSwapRequests.push({
        id: 'swap-1',
        teamId,
        status: 'PENDING_PEER',
        requesterShiftId: shiftId,
        targetShiftId: null,
        version: 1,
      });

      // Change shift time
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/${shiftId}`,
        'PATCH',
        {
          startsLocal: '2026-11-03T08:00:00',
          endsLocal: '2026-11-03T16:00:00',
          version: 1,
        },
        managerToken,
      );
      const res = await updateShiftRoute(req, { params: Promise.resolve({ teamId, shiftId }) });
      expect(res.status).toBe(200);

      // Verify swap moved to CANCELED
      expect(mockSwapRequests[0]?.status).toBe('CANCELED');
    });

    it('deletes shift with version in query string (FR-16)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/${shiftId}?version=1`,
        'DELETE',
        undefined,
        managerToken,
      );
      const res = await deleteShiftRoute(req, { params: Promise.resolve({ teamId, shiftId }) });
      expect(res.status).toBe(200);

      const deleted = mockShifts.find((s) => s.id === shiftId);
      expect(deleted?.deletedAt).not.toBeNull();
      expect(deleted?.version).toBe(2);
    });
  });

  describe('GET /v1/teams/:teamId/shifts (FR-18)', () => {
    beforeEach(() => {
      mockShifts.push(
        {
          id: 'shift-draft',
          teamId,
          assigneeUserId: staffUserId,
          startsAt: new Date('2026-11-03T13:00:00.000Z'),
          endsAt: new Date('2026-11-03T21:00:00.000Z'),
          position: 'RN',
          location: null,
          notes: null,
          status: 'DRAFT',
          publishedAt: null,
          version: 1,
          createdByUserId: managerUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          id: 'shift-published',
          teamId,
          assigneeUserId: staffUserId,
          startsAt: new Date('2026-11-04T13:00:00.000Z'),
          endsAt: new Date('2026-11-04T21:00:00.000Z'),
          position: 'RN',
          location: null,
          notes: null,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-11-01T12:00:00.000Z'),
          version: 1,
          createdByUserId: managerUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      );
    });

    it('staff sees published shifts only', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts?from=2026-11-01&to=2026-11-07`,
        'GET',
        undefined,
        staffToken,
      );
      const res = await getShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.shifts).toHaveLength(1);
      expect(json.shifts[0]?.id).toBe('shift-published');
    });

    it('manager sees both drafts and published shifts', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts?from=2026-11-01&to=2026-11-07`,
        'GET',
        undefined,
        managerToken,
      );
      const res = await getShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.shifts).toHaveLength(2);
    });

    it('rejects range exceeding 31 days with 400 RANGE_TOO_LARGE', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts?from=2026-11-01&to=2026-12-15`,
        'GET',
        undefined,
        managerToken,
      );
      const res = await getShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error.code).toBe('RANGE_TOO_LARGE');
    });
  });
});
