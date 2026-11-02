import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as publishShiftsRoute } from '../../../app/v1/teams/[teamId]/shifts/publish/route';
import { POST as copyWeekRoute } from '../../../app/v1/teams/[teamId]/shifts/copy-week/route';
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

interface MockActivityEvent {
  id: string;
  teamId: string;
  type: string;
  actorUserId: string | null;
  subjectShiftId: string | null;
  subjectUserId: string | null;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  createdAt: Date;
}

interface MockOutbox {
  id: string;
  teamId: string | null;
  sourceKey: string;
  kind: string;
  payload: unknown;
  createdAt: Date;
  processedAt: Date | null;
}

let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
let mockSubscriptions: MockSubscription[] = [];
let mockShifts: MockShift[] = [];
let mockActivityEvents: MockActivityEvent[] = [];
let mockOutboxEntries: MockOutbox[] = [];
const mockQueueAdd = vi.fn();
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../worker/queues', () => ({
  getQueue: vi.fn(() => ({
    add: mockQueueAdd,
  })),
  JOB_RETRY_POLICIES: {
    'notify.fanout': { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
  },
  JobId: {
    notifyFanout: (key: string) => `fanout:${key}`,
  },
}));

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
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          teamId: string;
          id?: { in: string[] };
          deletedAt: null;
          status?: string;
          startsAt?: { gte?: Date; lte?: Date; lt?: Date };
          endsAt?: { gt?: Date };
        };
      }) => {
        return mockShifts
          .filter((s) => {
            if (s.teamId !== where.teamId) return false;
            if (s.deletedAt !== null) return false;
            if (where.id?.in && !where.id.in.includes(s.id)) return false;
            if (where.status && s.status !== where.status) return false;
            if (where.startsAt?.gte && s.startsAt < where.startsAt.gte) return false;
            if (where.startsAt?.lte && s.startsAt > where.startsAt.lte) return false;
            if (where.startsAt?.lt && s.startsAt >= where.startsAt.lt) return false;
            if (where.endsAt?.gt && s.endsAt <= where.endsAt.gt) return false;
            return true;
          })
          .map((s) => ({ ...s }));
      },
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { teamId: string; id: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const s of mockShifts) {
          if (s.teamId === where.teamId && where.id.in.includes(s.id)) {
            if (data.status) s.status = data.status as MockShift['status'];
            if (data.publishedAt !== undefined) s.publishedAt = data.publishedAt as Date;
            s.updatedAt = new Date();
            count++;
          }
        }
        return { count };
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
  };

  const activityEventDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockActivityEvent, 'id' | 'createdAt'> }) => {
      const event: MockActivityEvent = {
        id: `018f3a2b-9000-7000-8000-${String(mockActivityEvents.length + 1).padStart(12, '0')}`,
        teamId: data.teamId,
        type: data.type,
        actorUserId: data.actorUserId,
        subjectShiftId: data.subjectShiftId,
        subjectUserId: data.subjectUserId,
        payload: data.payload,
        dedupeKey: data.dedupeKey ?? null,
        createdAt: new Date(),
      };
      mockActivityEvents.push(event);
      return { ...event };
    }),
  };

  const outboxDelegate = {
    create: vi.fn(
      async ({ data }: { data: Omit<MockOutbox, 'id' | 'createdAt' | 'processedAt'> }) => {
        const entry: MockOutbox = {
          id: `018f3a2b-a000-7000-8000-${String(mockOutboxEntries.length + 1).padStart(12, '0')}`,
          teamId: data.teamId ?? null,
          sourceKey: data.sourceKey,
          kind: data.kind,
          payload: data.payload,
          createdAt: new Date(),
          processedAt: null,
        };
        mockOutboxEntries.push(entry);
        return { ...entry };
      },
    ),
  };

  const mockDbClient = {
    team: teamDelegate,
    membership: membershipDelegate,
    subscription: subscriptionDelegate,
    shift: shiftDelegate,
    activityEvent: activityEventDelegate,
    outbox: outboxDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        shift: shiftDelegate,
        activityEvent: activityEventDelegate,
        outbox: outboxDelegate,
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

describe('Publish Shifts and Copy Week (FR-15b, FR-15c, PRD 7.2)', () => {
  const teamId = '018f3a2b-1000-7000-8000-000000000001';
  const ownerUserId = '018f3a2b-2000-7000-8000-000000000001';
  const managerUserId = '018f3a2b-3000-7000-8000-000000000001';
  const staffUserId = '018f3a2b-4000-7000-8000-000000000001';
  const staffUserId2 = '018f3a2b-5000-7000-8000-000000000001';
  const nonMemberUserId = '018f3a2b-6000-7000-8000-000000000001';

  let managerToken: string;
  let staffToken: string;
  let nonMemberToken: string;

  beforeEach(async () => {
    mockTeams = [
      {
        id: teamId,
        name: 'Urgent Care Center',
        timezone: 'America/Chicago',
        shardIndex: 0,
        ownerUserId,
        createdAt: new Date(),
        deletedAt: null,
      },
    ];

    mockMemberships = [
      { id: 'mem-1', teamId, userId: ownerUserId, role: 'OWNER', status: 'ACTIVE' },
      { id: 'mem-2', teamId, userId: managerUserId, role: 'MANAGER', status: 'ACTIVE' },
      { id: 'mem-3', teamId, userId: staffUserId, role: 'STAFF', status: 'ACTIVE' },
      { id: 'mem-4', teamId, userId: staffUserId2, role: 'STAFF', status: 'ACTIVE' },
    ];

    mockSubscriptions = [{ id: 'sub-1', teamId, status: 'ACTIVE' }];
    mockShifts = [];
    mockActivityEvents = [];
    mockOutboxEntries = [];
    mockRedisStore.clear();
    mockQueueAdd.mockClear();

    managerToken = await createAccessToken(managerUserId);
    staffToken = await createAccessToken(staffUserId);
    nonMemberToken = await createAccessToken(nonMemberUserId);
  });

  describe('POST /v1/teams/:teamId/shifts/publish (FR-15c)', () => {
    it('returns 403 FORBIDDEN if requester is a STAFF member', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/publish`,
        'POST',
        { from: '2026-11-02', to: '2026-11-08' },
        staffToken,
      );
      const res = await publishShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(403);
    });

    it('returns 404 NOT_FOUND if requester is not a member (B-19, FR-43)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/publish`,
        'POST',
        { from: '2026-11-02', to: '2026-11-08' },
        nonMemberToken,
      );
      const res = await publishShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(404);
    });

    it('returns 400 VALIDATION_FAILED if neither (from and to) nor shiftIds is provided', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/publish`,
        'POST',
        {},
        managerToken,
      );
      const res = await publishShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(400);
    });

    it('publishes shifts by shiftIds: updates to PUBLISHED, creates feed events, outbox and dispatches notification', async () => {
      // Create 2 draft shifts and 1 already published shift
      const draftShift1: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000001',
        teamId,
        assigneeUserId: staffUserId,
        startsAt: new Date('2026-11-02T13:00:00Z'),
        endsAt: new Date('2026-11-02T21:00:00Z'),
        position: 'Triage Nurse',
        location: 'ER Floor 1',
        notes: null,
        status: 'DRAFT',
        publishedAt: null,
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      const draftShift2: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000002',
        teamId,
        assigneeUserId: staffUserId2,
        startsAt: new Date('2026-11-03T13:00:00Z'),
        endsAt: new Date('2026-11-03T21:00:00Z'),
        position: 'Medical Assistant',
        location: 'Room 102',
        notes: null,
        status: 'DRAFT',
        publishedAt: null,
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      const publishedShift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000003',
        teamId,
        assigneeUserId: staffUserId,
        startsAt: new Date('2026-11-04T13:00:00Z'),
        endsAt: new Date('2026-11-04T21:00:00Z'),
        position: 'Triage Nurse',
        location: null,
        notes: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockShifts.push(draftShift1, draftShift2, publishedShift);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/publish`,
        'POST',
        { shiftIds: [draftShift1.id, draftShift2.id, publishedShift.id] },
        managerToken,
      );
      const res = await publishShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true, publishedCount: 2 });

      // Check shifts status
      expect(draftShift1.status).toBe('PUBLISHED');
      expect(draftShift1.publishedAt).not.toBeNull();
      expect(draftShift2.status).toBe('PUBLISHED');
      expect(draftShift2.publishedAt).not.toBeNull();

      // Check activity events: 2 SHIFT_CREATED (with fromPublish: true) + 1 SCHEDULE_PUBLISHED
      expect(mockActivityEvents).toHaveLength(3);
      const shiftCreatedEvents = mockActivityEvents.filter((e) => e.type === 'SHIFT_CREATED');
      expect(shiftCreatedEvents).toHaveLength(2);
      expect(shiftCreatedEvents[0]?.payload.fromPublish).toBe(true);
      expect(shiftCreatedEvents[1]?.payload.fromPublish).toBe(true);

      const schedPublishedEvent = mockActivityEvents.find((e) => e.type === 'SCHEDULE_PUBLISHED');
      expect(schedPublishedEvent).toBeDefined();
      expect(schedPublishedEvent?.payload.shiftCount).toBe(2);
      expect(schedPublishedEvent?.payload.affectedUserIds).toEqual(
        expect.arrayContaining([staffUserId, staffUserId2]),
      );

      // Check Outbox: exactly 1 outbox entry for SCHEDULE_PUBLISHED
      expect(mockOutboxEntries).toHaveLength(1);
      expect(mockOutboxEntries[0]).toMatchObject({
        teamId,
        kind: 'notify.fanout',
        sourceKey: `event:${schedPublishedEvent?.id}`,
      });

      // Dispatched to queue
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'notify.fanout',
        expect.objectContaining({
          type: 'SCHEDULE_PUBLISHED',
          teamId,
          sourceKey: `event:${schedPublishedEvent?.id}`,
        }),
        expect.objectContaining({
          jobId: `fanout:event:${schedPublishedEvent?.id}`,
        }),
      );
    });

    it('publishes shifts by date range { from, to }', async () => {
      // 1 draft shift on 2026-11-05
      const draftShift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000010',
        teamId,
        assigneeUserId: staffUserId,
        startsAt: new Date('2026-11-05T14:00:00Z'),
        endsAt: new Date('2026-11-05T22:00:00Z'),
        position: 'Triage Nurse',
        location: null,
        notes: null,
        status: 'DRAFT',
        publishedAt: null,
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockShifts.push(draftShift);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/publish`,
        'POST',
        { from: '2026-11-01', to: '2026-11-07' },
        managerToken,
      );
      const res = await publishShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true, publishedCount: 1 });
      expect(draftShift.status).toBe('PUBLISHED');
    });

    it('returns publishedCount 0 when no draft shifts exist in range', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/publish`,
        'POST',
        { from: '2026-11-15', to: '2026-11-20' },
        managerToken,
      );
      const res = await publishShiftsRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true, publishedCount: 0 });
      expect(mockActivityEvents).toHaveLength(0);
      expect(mockOutboxEntries).toHaveLength(0);
    });
  });

  describe('POST /v1/teams/:teamId/shifts/copy-week (FR-15b)', () => {
    it('returns 403 FORBIDDEN if requester is a STAFF member', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/copy-week`,
        'POST',
        { fromWeekStart: '2026-11-02' },
        staffToken,
      );
      const res = await copyWeekRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(403);
    });

    it('returns 404 NOT_FOUND if requester is not a member', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/copy-week`,
        'POST',
        { fromWeekStart: '2026-11-02' },
        nonMemberToken,
      );
      const res = await copyWeekRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(404);
    });

    it('successfully copies shifts 7 days later as drafts and skips inactive assignees and overlaps', async () => {
      // Set up source week: 2026-11-02 to 2026-11-08 (Mon to Sun) in America/Chicago
      // Mon 08:00 to 16:00 (Chicago is UTC-6 on Nov 2)
      // startsAt: 2026-11-02T14:00:00Z (08:00 local), endsAt: 2026-11-02T22:00:00Z (16:00 local)
      const validShift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000021',
        teamId,
        assigneeUserId: staffUserId,
        startsAt: new Date('2026-11-02T14:00:00Z'),
        endsAt: new Date('2026-11-02T22:00:00Z'),
        position: 'Triage Nurse',
        location: 'ER A',
        notes: 'Source notes',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      // Inactive assignee shift in source week
      const removedUserId = '018f3a2b-7000-7000-8000-000000000001';
      mockMemberships.push({
        id: 'mem-5',
        teamId,
        userId: removedUserId,
        role: 'STAFF',
        status: 'REMOVED',
      });
      const inactiveShift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000022',
        teamId,
        assigneeUserId: removedUserId,
        startsAt: new Date('2026-11-03T14:00:00Z'),
        endsAt: new Date('2026-11-03T22:00:00Z'),
        position: 'Medical Assistant',
        location: null,
        notes: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      // Overlap candidate shift: source shift on 2026-11-04, but target week (2026-11-11) already has a shift for staffUserId2
      const overlapCandidateShift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000023',
        teamId,
        assigneeUserId: staffUserId2,
        startsAt: new Date('2026-11-04T14:00:00Z'),
        endsAt: new Date('2026-11-04T22:00:00Z'),
        position: 'Lab Tech',
        location: null,
        notes: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      // Pre-existing shift on target week (2026-11-11) for staffUserId2
      // (Note: on Nov 8, US daylight saving ended, so UTC-6 became UTC-6 standard time)
      const existingTargetShift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000030',
        teamId,
        assigneeUserId: staffUserId2,
        startsAt: new Date('2026-11-11T14:00:00Z'),
        endsAt: new Date('2026-11-11T20:00:00Z'),
        position: 'Lab Tech Existing',
        location: null,
        notes: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 1,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      mockShifts.push(validShift, inactiveShift, overlapCandidateShift, existingTargetShift);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/copy-week`,
        'POST',
        { fromWeekStart: '2026-11-02' },
        managerToken,
      );
      const res = await copyWeekRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.copiedCount).toBe(1);
      expect(json.skippedCount).toBe(2);
      expect(json.skippedShifts).toEqual(
        expect.arrayContaining([
          { shiftId: inactiveShift.id, reason: 'ASSIGNEE_INACTIVE' },
          { shiftId: overlapCandidateShift.id, reason: 'OVERLAP' },
        ]),
      );

      // Verify newly created shift
      // Initial mockShifts had 4, now 5
      expect(mockShifts).toHaveLength(5);
      const newShift = mockShifts[4];
      expect(newShift).toBeDefined();
      if (!newShift) throw new Error('Expected newShift to be defined');
      expect(newShift.status).toBe('DRAFT');
      expect(newShift.publishedAt).toBeNull();
      expect(newShift.assigneeUserId).toBe(staffUserId);
      expect(newShift.position).toBe('Triage Nurse');
      expect(newShift.location).toBe('ER A');
      expect(newShift.notes).toBe('Source notes');
      expect(newShift.createdByUserId).toBe(managerUserId);

      // Copied shifts are drafts: notify nobody and write no feed events (FR-15c)
      expect(mockActivityEvents).toHaveLength(0);
      expect(mockOutboxEntries).toHaveLength(0);
    });

    it('returns empty result when source week has no shifts', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/shifts/copy-week`,
        'POST',
        { fromWeekStart: '2026-12-01' },
        managerToken,
      );
      const res = await copyWeekRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        copiedCount: 0,
        skippedCount: 0,
        skippedShifts: [],
      });
    });
  });
});
