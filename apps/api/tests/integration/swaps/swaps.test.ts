import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as listSwapsRoute,
  POST as createSwapRoute,
} from '../../../app/v1/teams/[teamId]/swaps/route';
import { POST as acceptSwapRoute } from '../../../app/v1/teams/[teamId]/swaps/[swapId]/accept/route';
import { POST as declineSwapRoute } from '../../../app/v1/teams/[teamId]/swaps/[swapId]/decline/route';
import { POST as approveSwapRoute } from '../../../app/v1/teams/[teamId]/swaps/[swapId]/approve/route';
import { POST as rejectSwapRoute } from '../../../app/v1/teams/[teamId]/swaps/[swapId]/reject/route';
import { POST as cancelSwapRoute } from '../../../app/v1/teams/[teamId]/swaps/[swapId]/cancel/route';
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

interface MockSwap {
  id: string;
  teamId: string;
  type: 'TRADE' | 'GIVEAWAY';
  status:
    | 'PENDING_PEER'
    | 'PENDING_MANAGER'
    | 'APPROVED'
    | 'REJECTED'
    | 'DECLINED'
    | 'CANCELED'
    | 'EXPIRED';
  requesterUserId: string;
  requesterShiftId: string;
  requesterShiftVersion: number;
  targetUserId: string;
  targetShiftId: string | null;
  targetShiftVersion: number | null;
  message: string | null;
  peerRespondedAt: Date | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  expiresAt: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
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
let mockSwaps: MockSwap[] = [];
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
          id?: { not?: string };
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
          id?: { in: string[] };
          deletedAt: null;
        };
      }) => {
        return mockShifts
          .filter((s) => {
            if (s.teamId !== where.teamId) return false;
            if (s.deletedAt !== null) return false;
            if (where.id?.in && !where.id.in.includes(s.id)) return false;
            return true;
          })
          .map((s) => ({ ...s }));
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { assigneeUserId?: string; version?: { increment: number } };
      }) => {
        const found = mockShifts.find((s) => s.id === where.id);
        if (!found) throw new Error('Shift not found');
        if (data.assigneeUserId) found.assigneeUserId = data.assigneeUserId;
        if (data.version && 'increment' in data.version) {
          found.version += data.version.increment;
        }
        found.updatedAt = new Date();
        return { ...found };
      },
    ),
  };

  const swapRequestDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = mockSwaps.find((s) => s.id === where.id);
      return found ? { ...found } : null;
    }),
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: {
          teamId: string;
          status?: { in: string[] };
          OR?: Array<{ requesterShiftId?: string; targetShiftId?: string }>;
        };
      }) => {
        const found = mockSwaps.find((s) => {
          if (s.teamId !== where.teamId) return false;
          if (where.status?.in && !where.status.in.includes(s.status)) return false;
          if (where.OR) {
            return where.OR.some(
              (cond) =>
                (cond.requesterShiftId && s.requesterShiftId === cond.requesterShiftId) ||
                (cond.targetShiftId && s.targetShiftId === cond.targetShiftId),
            );
          }
          return true;
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
          status?: string;
          OR?: Array<{ requesterUserId: string } | { targetUserId: string }>;
        };
      }) => {
        return mockSwaps
          .filter((s) => {
            if (s.teamId !== where.teamId) return false;
            if (where.status && s.status !== where.status) return false;
            if (where.OR) {
              return where.OR.some(
                (cond) =>
                  ('requesterUserId' in cond && cond.requesterUserId === s.requesterUserId) ||
                  ('targetUserId' in cond && cond.targetUserId === s.targetUserId),
              );
            }
            return true;
          })
          .map((s) => ({ ...s }));
      },
    ),
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<
          MockSwap,
          | 'id'
          | 'createdAt'
          | 'updatedAt'
          | 'peerRespondedAt'
          | 'decidedByUserId'
          | 'decidedAt'
          | 'decisionNote'
        >;
      }) => {
        const swap: MockSwap = {
          id: `018f3a2b-b000-7000-8000-${String(mockSwaps.length + 1).padStart(12, '0')}`,
          teamId: data.teamId,
          type: data.type,
          status: data.status,
          requesterUserId: data.requesterUserId,
          requesterShiftId: data.requesterShiftId,
          requesterShiftVersion: data.requesterShiftVersion,
          targetUserId: data.targetUserId,
          targetShiftId: data.targetShiftId ?? null,
          targetShiftVersion: data.targetShiftVersion ?? null,
          message: data.message ?? null,
          peerRespondedAt: null,
          decidedByUserId: null,
          decidedAt: null,
          decisionNote: null,
          expiresAt: data.expiresAt,
          version: data.version ?? 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockSwaps.push(swap);
        return { ...swap };
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<MockSwap> & { version?: { increment: number } };
      }) => {
        const found = mockSwaps.find((s) => s.id === where.id);
        if (!found) throw new Error('Swap not found');
        if (data.status) found.status = data.status;
        if (data.peerRespondedAt) found.peerRespondedAt = data.peerRespondedAt;
        if (data.decidedByUserId) found.decidedByUserId = data.decidedByUserId;
        if (data.decidedAt) found.decidedAt = data.decidedAt;
        if (data.decisionNote !== undefined) found.decisionNote = data.decisionNote;
        if (data.version && 'increment' in data.version) {
          found.version += data.version.increment;
        }
        found.updatedAt = new Date();
        return { ...found };
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
    swapRequest: swapRequestDelegate,
    activityEvent: activityEventDelegate,
    outbox: outboxDelegate,
    $executeRawUnsafe: vi.fn(async () => 0),
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        shift: shiftDelegate,
        swapRequest: swapRequestDelegate,
        activityEvent: activityEventDelegate,
        outbox: outboxDelegate,
        $executeRawUnsafe: vi.fn(async () => 0),
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

describe('Swaps Workflow (FR-21 to FR-25, PRD 7.2)', () => {
  const teamId = '018f3a2b-1000-7000-8000-000000000001';
  const ownerUserId = '018f3a2b-2000-7000-8000-000000000001';
  const managerUserId = '018f3a2b-3000-7000-8000-000000000001';
  const staffUserId1 = '018f3a2b-4000-7000-8000-000000000001';
  const staffUserId2 = '018f3a2b-5000-7000-8000-000000000001';
  const staffUserId3 = '018f3a2b-6000-7000-8000-000000000001';

  let ownerToken: string;
  let managerToken: string;
  let staffToken1: string;
  let staffToken2: string;
  let staffToken3: string;

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
      { id: 'mem-3', teamId, userId: staffUserId1, role: 'STAFF', status: 'ACTIVE' },
      { id: 'mem-4', teamId, userId: staffUserId2, role: 'STAFF', status: 'ACTIVE' },
      { id: 'mem-5', teamId, userId: staffUserId3, role: 'STAFF', status: 'ACTIVE' },
    ];

    mockSubscriptions = [{ id: 'sub-1', teamId, status: 'ACTIVE' }];
    mockShifts = [];
    mockSwaps = [];
    mockActivityEvents = [];
    mockOutboxEntries = [];
    mockRedisStore.clear();
    mockQueueAdd.mockClear();

    ownerToken = await createAccessToken(ownerUserId);
    managerToken = await createAccessToken(managerUserId);
    staffToken1 = await createAccessToken(staffUserId1);
    staffToken2 = await createAccessToken(staffUserId2);
    staffToken3 = await createAccessToken(staffUserId3);
  });

  describe('POST /v1/teams/:teamId/swaps (FR-21, FR-24)', () => {
    it('creates a giveaway swap request, records versions, and queues notification', async () => {
      // 24 hours in the future
      const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000001',
        teamId,
        assigneeUserId: staffUserId1,
        startsAt,
        endsAt,
        position: 'Triage Nurse',
        location: 'ER A',
        notes: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 2,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockShifts.push(shift);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps`,
        'POST',
        {
          requesterShiftId: shift.id,
          targetUserId: staffUserId2,
          message: 'Can you cover my shift tomorrow?',
        },
        staffToken1,
      );

      const res = await createSwapRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(201);
      const json = await res.json();

      expect(json.swap).toMatchObject({
        type: 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId: staffUserId1,
        requesterShiftId: shift.id,
        requesterShiftVersion: 2,
        targetUserId: staffUserId2,
        targetShiftId: null,
        message: 'Can you cover my shift tomorrow?',
      });

      // Outbox and queue check
      expect(mockOutboxEntries).toHaveLength(1);
      expect(mockOutboxEntries[0]?.kind).toBe('notify.fanout');
      expect(mockOutboxEntries[0]?.sourceKey).toBe(`swap:${json.swap.id}:REQUESTED`);
      expect(mockQueueAdd).toHaveBeenCalledWith(
        'notify.fanout',
        expect.objectContaining({ type: 'SWAP_REQUESTED' }),
        expect.any(Object),
      );
    });

    it('rejects swap if requester shift starts in under 2 hours (409 SWAP_TOO_LATE)', async () => {
      const startsAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000002',
        teamId,
        assigneeUserId: staffUserId1,
        startsAt,
        endsAt,
        position: 'Nurse',
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
      mockShifts.push(shift);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps`,
        'POST',
        {
          requesterShiftId: shift.id,
          targetUserId: staffUserId2,
        },
        staffToken1,
      );

      const res = await createSwapRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('SWAP_TOO_LATE');
    });

    it('rejects swap if requester shift already has an open swap (409 SWAP_ALREADY_OPEN)', async () => {
      const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000003',
        teamId,
        assigneeUserId: staffUserId1,
        startsAt,
        endsAt,
        position: 'Nurse',
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
      mockShifts.push(shift);

      // Existing open swap
      mockSwaps.push({
        id: 'swap-existing-1',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId: staffUserId1,
        requesterShiftId: shift.id,
        requesterShiftVersion: 1,
        targetUserId: staffUserId3,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps`,
        'POST',
        {
          requesterShiftId: shift.id,
          targetUserId: staffUserId2,
        },
        staffToken1,
      );

      const res = await createSwapRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('SWAP_ALREADY_OPEN');
    });

    it('rejects swap if target user already has an overlapping shift (409 SWAP_OVERLAP)', async () => {
      const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const reqShift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000004',
        teamId,
        assigneeUserId: staffUserId1,
        startsAt,
        endsAt,
        position: 'Nurse',
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

      // Target user has a shift at the exact same time
      const targetOverlappingShift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000005',
        teamId,
        assigneeUserId: staffUserId2,
        startsAt,
        endsAt,
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
      mockShifts.push(reqShift, targetOverlappingShift);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps`,
        'POST',
        {
          requesterShiftId: reqShift.id,
          targetUserId: staffUserId2,
        },
        staffToken1,
      );

      const res = await createSwapRoute(req, { params: Promise.resolve({ teamId }) });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('SWAP_OVERLAP');
    });
  });

  describe('Coworker Accept / Decline / Cancel (FR-22, FR-25)', () => {
    it('coworker accepts swap: moves to PENDING_MANAGER and queues notification', async () => {
      const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000010',
        teamId,
        assigneeUserId: staffUserId1,
        startsAt,
        endsAt,
        position: 'Nurse',
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
      mockShifts.push(shift);

      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000010',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId: staffUserId1,
        requesterShiftId: shift.id,
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/accept`,
        'POST',
        {},
        staffToken2, // Target coworker
      );

      const res = await acceptSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.swap.status).toBe('PENDING_MANAGER');
      expect(swap.status).toBe('PENDING_MANAGER');

      expect(mockOutboxEntries).toHaveLength(1);
      expect(mockOutboxEntries[0]?.kind).toBe('notify.fanout');
      expect(mockOutboxEntries[0]?.sourceKey).toBe(`swap:${swap.id}:ACCEPTED`);
    });

    it('other user cannot accept swap (403 FORBIDDEN)', async () => {
      const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000011',
        teamId,
        assigneeUserId: staffUserId1,
        startsAt,
        endsAt,
        position: 'Nurse',
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
      mockShifts.push(shift);

      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000011',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId: staffUserId1,
        requesterShiftId: shift.id,
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/accept`,
        'POST',
        {},
        staffToken3, // Not target coworker
      );

      const res = await acceptSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(403);
    });

    it('coworker declines swap: moves to DECLINED and queues notification', async () => {
      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000019',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId: staffUserId1,
        requesterShiftId: 'shift-1',
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/decline`,
        'POST',
        {},
        staffToken2, // Target coworker
      );

      const res = await declineSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.swap.status).toBe('DECLINED');
      expect(swap.status).toBe('DECLINED');

      expect(mockOutboxEntries).toHaveLength(1);
      expect(mockOutboxEntries[0]?.kind).toBe('notify.fanout');
      expect(mockOutboxEntries[0]?.sourceKey).toBe(`swap:${swap.id}:DECLINED`);
    });

    it('requester cancels swap: moves to CANCELED', async () => {
      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000012',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId: staffUserId1,
        requesterShiftId: 'shift-1',
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/cancel`,
        'POST',
        {},
        staffToken1,
      );

      const res = await cancelSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.swap.status).toBe('CANCELED');
      expect(swap.status).toBe('CANCELED');

      expect(mockOutboxEntries).toHaveLength(1);
      expect(mockOutboxEntries[0]?.kind).toBe('notify.fanout');
      expect(mockOutboxEntries[0]?.sourceKey).toBe(`swap:${swap.id}:CANCELED`);
    });
  });

  describe('Manager Approval / Rejection (FR-23, FR-24)', () => {
    it('approves a trade swap: reassigns both shifts, defers constraints, creates feed event and queues notification', async () => {
      const startsAt = new Date(Date.now() + 36 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift1: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000021',
        teamId,
        assigneeUserId: staffUserId1,
        startsAt,
        endsAt,
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

      const shift2: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000022',
        teamId,
        assigneeUserId: staffUserId2,
        startsAt,
        endsAt,
        position: 'Emergency Nurse',
        location: null,
        notes: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 2,
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockShifts.push(shift1, shift2);

      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000020',
        teamId,
        type: 'TRADE',
        status: 'PENDING_MANAGER',
        requesterUserId: staffUserId1,
        requesterShiftId: shift1.id,
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: shift2.id,
        targetShiftVersion: 2,
        message: 'Direct trade',
        peerRespondedAt: new Date(),
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/approve`,
        'POST',
        { note: 'Approved by manager' },
        managerToken,
      );

      const res = await approveSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.swap.status).toBe('APPROVED');
      expect(json.swap.decidedByUserId).toBe(managerUserId);

      // Verify reassignment of shifts
      expect(shift1.assigneeUserId).toBe(staffUserId2);
      expect(shift1.version).toBe(2);
      expect(shift2.assigneeUserId).toBe(staffUserId1);
      expect(shift2.version).toBe(3);

      // Verify feed event
      expect(mockActivityEvents).toHaveLength(1);
      expect(mockActivityEvents[0]?.type).toBe('SHIFT_SWAPPED');
      expect(mockActivityEvents[0]?.payload.selfApproved).toBe(false);

      // Verify Outbox
      expect(mockOutboxEntries).toHaveLength(1);
      expect(mockOutboxEntries[0]?.sourceKey).toBe(`swap:${swap.id}:APPROVED`);
    });

    it('manager involved in swap cannot approve it (403 SWAP_SELF_DECISION)', async () => {
      const startsAt = new Date(Date.now() + 36 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000031',
        teamId,
        assigneeUserId: managerUserId, // Manager is requester!
        startsAt,
        endsAt,
        position: 'Supervisor',
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
      mockShifts.push(shift);

      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000030',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_MANAGER',
        requesterUserId: managerUserId,
        requesterShiftId: shift.id,
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: new Date(),
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/approve`,
        'POST',
        {},
        managerToken, // Manager approves own swap
      );

      const res = await approveSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe('SWAP_SELF_DECISION');
    });

    it('owner can approve a swap they are involved in and selfApproved is true', async () => {
      const startsAt = new Date(Date.now() + 36 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000041',
        teamId,
        assigneeUserId: ownerUserId, // Owner is requester!
        startsAt,
        endsAt,
        position: 'Doctor',
        location: null,
        notes: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 1,
        createdByUserId: ownerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockShifts.push(shift);

      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000040',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_MANAGER',
        requesterUserId: ownerUserId,
        requesterShiftId: shift.id,
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: new Date(),
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/approve`,
        'POST',
        {},
        ownerToken, // Owner approves own swap
      );

      const res = await approveSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.swap.status).toBe('APPROVED');

      expect(mockActivityEvents).toHaveLength(1);
      expect(mockActivityEvents[0]?.payload.selfApproved).toBe(true);
    });

    it('rejects stale swap if shift version changed (409 SWAP_STALE)', async () => {
      const startsAt = new Date(Date.now() + 36 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

      const shift: MockShift = {
        id: '018f3a2b-8000-7000-8000-000000000051',
        teamId,
        assigneeUserId: staffUserId1,
        startsAt,
        endsAt,
        position: 'Nurse',
        location: null,
        notes: null,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        version: 3, // Shift was edited and bumped to version 3!
        createdByUserId: managerUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      mockShifts.push(shift);

      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000050',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_MANAGER',
        requesterUserId: staffUserId1,
        requesterShiftId: shift.id,
        requesterShiftVersion: 1, // Swap expected version 1!
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: new Date(),
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/approve`,
        'POST',
        {},
        managerToken,
      );

      const res = await approveSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe('SWAP_STALE');
      expect(swap.status).toBe('CANCELED');
    });

    it('manager rejects swap with note: moves to REJECTED and queues notification', async () => {
      const swap: MockSwap = {
        id: '018f3a2b-b000-7000-8000-000000000060',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_MANAGER',
        requesterUserId: staffUserId1,
        requesterShiftId: 'shift-1',
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: new Date(),
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(Date.now() + 72 * 3600000),
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap);

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps/${swap.id}/reject`,
        'POST',
        { note: 'Coverage cannot be approved for this shift' },
        managerToken,
      );

      const res = await rejectSwapRoute(req, {
        params: Promise.resolve({ teamId, swapId: swap.id }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.swap.status).toBe('REJECTED');
      expect(json.swap.decisionNote).toBe('Coverage cannot be approved for this shift');
      expect(swap.status).toBe('REJECTED');

      expect(mockOutboxEntries).toHaveLength(1);
      expect(mockOutboxEntries[0]?.kind).toBe('notify.fanout');
      expect(mockOutboxEntries[0]?.sourceKey).toBe(`swap:${swap.id}:REJECTED`);
    });
  });

  describe('GET /v1/teams/:teamId/swaps (PRD 7.2)', () => {
    it('staff sees only their own swaps; manager sees all swaps', async () => {
      const swap1: MockSwap = {
        id: 'swap-user1-user2',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId: staffUserId1,
        requesterShiftId: 'shift-1',
        requesterShiftVersion: 1,
        targetUserId: staffUserId2,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const swap2: MockSwap = {
        id: 'swap-user2-user3',
        teamId,
        type: 'GIVEAWAY',
        status: 'PENDING_PEER',
        requesterUserId: staffUserId2,
        requesterShiftId: 'shift-2',
        requesterShiftVersion: 1,
        targetUserId: staffUserId3,
        targetShiftId: null,
        targetShiftVersion: null,
        message: null,
        peerRespondedAt: null,
        decidedByUserId: null,
        decidedAt: null,
        decisionNote: null,
        expiresAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockSwaps.push(swap1, swap2);

      // Staff 1 can only see swap1 (not swap2)
      const reqStaff = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps`,
        'GET',
        undefined,
        staffToken1,
      );
      const resStaff = await listSwapsRoute(reqStaff, { params: Promise.resolve({ teamId }) });
      expect(resStaff.status).toBe(200);
      const jsonStaff = await resStaff.json();
      expect(jsonStaff.swaps).toHaveLength(1);
      expect(jsonStaff.swaps[0].id).toBe(swap1.id);

      // Manager can see both swaps
      const reqManager = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/swaps`,
        'GET',
        undefined,
        managerToken,
      );
      const resManager = await listSwapsRoute(reqManager, { params: Promise.resolve({ teamId }) });
      expect(resManager.status).toBe(200);
      const jsonManager = await resManager.json();
      expect(jsonManager.swaps).toHaveLength(2);
    });
  });
});
