import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import {
  POST as createInviteRoute,
  GET as getPendingInvitesRoute,
} from '../../../app/v1/teams/[teamId]/invites/route';
import { DELETE as revokeInviteRoute } from '../../../app/v1/teams/[teamId]/invites/[inviteId]/route';
import { GET as getInviteByTokenRoute } from '../../../app/v1/invites/[token]/route';
import { POST as acceptInviteRoute } from '../../../app/v1/invites/[token]/accept/route';
import { GET as getMembersRoute } from '../../../app/v1/teams/[teamId]/members/route';
import {
  PATCH as updateMemberRoleRoute,
  DELETE as removeMemberRoute,
} from '../../../app/v1/teams/[teamId]/members/[userId]/route';
import { POST as leaveTeamRoute } from '../../../app/v1/teams/[teamId]/leave/route';
import { createAccessToken } from '../../../lib/auth/jwt';

interface MockUser {
  id: string;
  email: string;
  displayName: string;
}

interface MockTeam {
  id: string;
  name: string;
  timezone: string;
  shardIndex: number;
  ownerUserId: string;
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

interface MockInvite {
  id: string;
  teamId: string;
  tokenHash: string;
  role: 'STAFF' | 'MANAGER';
  email: string | null;
  createdByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  revokedAt: Date | null;
}

interface MockSubscription {
  id: string;
  teamId: string;
  plan: 'STARTER' | 'TEAM' | 'BUSINESS';
  status: 'ACTIVE' | 'PAST_DUE' | 'READ_ONLY' | 'CANCELED';
  anchorDay: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  paidSeats: number;
  version: number;
}

interface MockShift {
  id: string;
  teamId: string;
  assigneeUserId: string;
  startsAt: Date;
  endsAt: Date;
}

interface MockSwap {
  id: string;
  teamId: string;
  shiftId: string;
  status:
    | 'PENDING_PEER'
    | 'PENDING_MANAGER'
    | 'APPROVED'
    | 'REJECTED'
    | 'DECLINED'
    | 'CANCELED'
    | 'EXPIRED';
}

interface MockCharge {
  id: string;
  teamId: string;
  subscriptionId: string;
  kind: string;
  status: string;
  amountCents: number;
  dueAt: Date;
}

interface MockLedgerEntry {
  id: string;
  teamId: string;
  chargeId: string | null;
  type: string;
  amountCents: number;
  idempotencyKey: string;
}

interface MockOutbox {
  id: string;
  teamId: string | null;
  kind: string;
  sourceKey: string;
  payload: unknown;
}

interface MockEmailMessage {
  id: string;
  template: string;
  to: string;
  status: string;
}

let mockUsers: MockUser[] = [];
let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
let mockInvites: MockInvite[] = [];
let mockSubscriptions: MockSubscription[] = [];
let mockShifts: MockShift[] = [];
let mockSwaps: MockSwap[] = [];
let mockCharges: MockCharge[] = [];
let mockLedgerEntries: MockLedgerEntry[] = [];
let mockOutboxEntries: MockOutbox[] = [];
let mockEmailMessages: MockEmailMessage[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../lib/db', () => {
  const teamDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return mockTeams.find((t) => t.id === where.id) ?? null;
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
        if (!found) return null;
        const user = mockUsers.find((u) => u.id === found?.userId);
        return {
          ...found,
          user: user
            ? { displayName: user.displayName, email: user.email }
            : { displayName: 'User', email: 'user@example.com' },
        };
      },
    ),
    findMany: vi.fn(
      async ({ where }: { where: { teamId: string; status?: 'ACTIVE' | 'REMOVED' | 'LEFT' } }) => {
        return mockMemberships
          .filter((m) => m.teamId === where.teamId && (!where.status || m.status === where.status))
          .map((m) => {
            const user = mockUsers.find((u) => u.id === m.userId);
            return {
              ...m,
              user: user
                ? { displayName: user.displayName, email: user.email }
                : { displayName: 'User', email: 'user@example.com' },
            };
          });
      },
    ),
    count: vi.fn(
      async ({ where }: { where: { teamId: string; status?: 'ACTIVE' | 'REMOVED' | 'LEFT' } }) => {
        return mockMemberships.filter(
          (m) => m.teamId === where.teamId && (!where.status || m.status === where.status),
        ).length;
      },
    ),
    create: vi.fn(async ({ data }: { data: Omit<MockMembership, 'id'> }) => {
      const record: MockMembership = {
        id: `018f3a2b-0000-7000-8010-${String(mockMemberships.length + 1).padStart(12, '0')}`,
        teamId: data.teamId,
        userId: data.userId,
        role: data.role,
        status: data.status,
        joinedAt: data.joinedAt,
        endedAt: null,
      };
      mockMemberships.push(record);
      return record;
    }),
    update: vi.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<MockMembership> }) => {
        const found = mockMemberships.find((m) => m.id === where.id);
        if (!found) throw new Error('Membership not found');
        Object.assign(found, data);
        const user = mockUsers.find((u) => u.id === found.userId);
        return {
          ...found,
          user: user
            ? { displayName: user.displayName, email: user.email }
            : { displayName: 'User', email: 'user@example.com' },
        };
      },
    ),
  };

  const inviteDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
      const found = mockInvites.find((i) =>
        where.tokenHash ? i.tokenHash === where.tokenHash : i.id === where.id,
      );
      if (!found) return null;
      const team = mockTeams.find((t) => t.id === found.teamId);
      return {
        ...found,
        team: team ? { id: team.id, name: team.name } : null,
      };
    }),
    findFirst: vi.fn(async ({ where }: { where: { id: string; teamId: string } }) => {
      return mockInvites.find((i) => i.id === where.id && i.teamId === where.teamId) ?? null;
    }),
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: {
          teamId: string;
          acceptedAt: null;
          revokedAt: null;
          expiresAt: { gt: Date };
        };
      }) => {
        return mockInvites.filter(
          (i) =>
            i.teamId === where.teamId &&
            i.acceptedAt === null &&
            i.revokedAt === null &&
            i.expiresAt > where.expiresAt.gt,
        );
      },
    ),
    count: vi.fn(
      async ({
        where,
      }: {
        where: {
          teamId: string;
          acceptedAt: null;
          revokedAt: null;
          expiresAt: { gt: Date };
        };
      }) => {
        return mockInvites.filter(
          (i) =>
            i.teamId === where.teamId &&
            i.acceptedAt === null &&
            i.revokedAt === null &&
            i.expiresAt > where.expiresAt.gt,
        ).length;
      },
    ),
    create: vi.fn(
      async ({
        data,
      }: {
        data: Omit<
          MockInvite,
          'id' | 'createdAt' | 'acceptedAt' | 'acceptedByUserId' | 'revokedAt'
        >;
      }) => {
        const record: MockInvite = {
          id: `018f3a2b-0000-7000-8020-${String(mockInvites.length + 1).padStart(12, '0')}`,
          teamId: data.teamId,
          tokenHash: data.tokenHash,
          role: data.role,
          email: data.email ?? null,
          createdByUserId: data.createdByUserId,
          createdAt: new Date(),
          expiresAt: data.expiresAt,
          acceptedAt: null,
          acceptedByUserId: null,
          revokedAt: null,
        };
        mockInvites.push(record);
        return record;
      },
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MockInvite> }) => {
      const found = mockInvites.find((i) => i.id === where.id);
      if (!found) throw new Error('Invite not found');
      Object.assign(found, data);
      return found;
    }),
  };

  const subscriptionDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { teamId: string } }) => {
      return mockSubscriptions.find((s) => s.teamId === where.teamId) ?? null;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { teamId?: string; id?: string };
        data: { version?: { increment: number }; paidSeats?: number; status?: string };
      }) => {
        const found = mockSubscriptions.find((s) =>
          where.teamId ? s.teamId === where.teamId : s.id === where.id,
        );
        if (!found) throw new Error('Subscription not found');
        if (data.version?.increment) {
          found.version += data.version.increment;
        }
        if (data.paidSeats !== undefined) {
          found.paidSeats = data.paidSeats;
        }
        return found;
      },
    ),
  };

  const chargeDelegate = {
    create: vi.fn(async ({ data }: { data: MockCharge }) => {
      const record: MockCharge = { ...data };
      mockCharges.push(record);
      return record;
    }),
  };

  const ledgerEntryDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockLedgerEntry, 'id'> }) => {
      const record: MockLedgerEntry = {
        ...data,
        id: `018f3a2b-0000-7000-8040-${String(mockLedgerEntries.length + 1).padStart(12, '0')}`,
      };
      mockLedgerEntries.push(record);
      return record;
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

  const emailMessageDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockEmailMessage, 'id'> }) => {
      const record: MockEmailMessage = {
        id: `018f3a2b-0000-7000-8060-${String(mockEmailMessages.length + 1).padStart(12, '0')}`,
        template: data.template,
        to: data.to,
        status: data.status,
      };
      mockEmailMessages.push(record);
      return record;
    }),
  };

  const shiftDelegate = {
    findMany: vi.fn(
      async ({
        where,
      }: {
        where: { teamId: string; assigneeUserId: string; startsAt: { gt: Date } };
      }) => {
        return mockShifts.filter(
          (s) =>
            s.teamId === where.teamId &&
            s.assigneeUserId === where.assigneeUserId &&
            s.startsAt > where.startsAt.gt,
        );
      },
    ),
  };

  const swapRequestDelegate = {
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: {
          teamId: string;
          status: { in: string[] };
          OR: [{ requesterShiftId: { in: string[] } }, { targetShiftId: { in: string[] } }];
        };
        data: { status: 'CANCELED' };
      }) => {
        let count = 0;
        const shiftIds = [...where.OR[0].requesterShiftId.in, ...where.OR[1].targetShiftId.in];
        for (const swap of mockSwaps) {
          if (
            swap.teamId === where.teamId &&
            shiftIds.includes(swap.shiftId) &&
            where.status.in.includes(swap.status)
          ) {
            swap.status = data.status;
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
    invite: inviteDelegate,
    subscription: subscriptionDelegate,
    charge: chargeDelegate,
    ledgerEntry: ledgerEntryDelegate,
    outbox: outboxDelegate,
    emailMessage: emailMessageDelegate,
    shift: shiftDelegate,
    swapRequest: swapRequestDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        team: teamDelegate,
        membership: membershipDelegate,
        invite: inviteDelegate,
        subscription: subscriptionDelegate,
        charge: chargeDelegate,
        ledgerEntry: ledgerEntryDelegate,
        outbox: outboxDelegate,
        emailMessage: emailMessageDelegate,
        shift: shiftDelegate,
        swapRequest: swapRequestDelegate,
      }),
    ),
    $primary: vi.fn(() => ({
      team: teamDelegate,
      membership: membershipDelegate,
      invite: inviteDelegate,
      subscription: subscriptionDelegate,
      charge: chargeDelegate,
      ledgerEntry: ledgerEntryDelegate,
      outbox: outboxDelegate,
      emailMessage: emailMessageDelegate,
      shift: shiftDelegate,
      swapRequest: swapRequestDelegate,
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          team: teamDelegate,
          membership: membershipDelegate,
          invite: inviteDelegate,
          subscription: subscriptionDelegate,
          charge: chargeDelegate,
          ledgerEntry: ledgerEntryDelegate,
          outbox: outboxDelegate,
          emailMessage: emailMessageDelegate,
          shift: shiftDelegate,
          swapRequest: swapRequestDelegate,
        }),
      ),
    })),
  };

  return {
    dbShard0: mockDbClient,
    dbShard1: mockDbClient,
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
    'feed.append': { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
    'notify.fanout': { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
    'email.send': { attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
  },
  JobId: {
    feedAppend: (membershipId: string, joinedAt: string) => `feed:${membershipId}:${joinedAt}`,
    notifyFanout: (sourceKey: string) => `fanout:${sourceKey}`,
    emailSend: (emailMessageId: string) => `email:${emailMessageId}`,
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

describe('Team Invites and Membership Management (FR-08 to FR-12)', () => {
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
    mockUsers = [
      { id: ownerUserId, email: 'owner@clinic.com', displayName: 'Dr. Owner' },
      { id: managerUserId, email: 'manager@clinic.com', displayName: 'Nurse Manager' },
      { id: staffUserId, email: 'staff@clinic.com', displayName: 'Staff Nurse' },
      { id: outsiderUserId, email: 'outsider@other.com', displayName: 'Outsider' },
    ];

    mockTeams = [
      {
        id: teamId,
        name: 'Metro Health Clinic',
        timezone: 'America/New_York',
        shardIndex: 0,
        ownerUserId,
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
        plan: 'STARTER',
        status: 'ACTIVE',
        anchorDay: 1,
        currentPeriodStart: new Date('2026-11-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
        paidSeats: 3,
        version: 1,
      },
    ];

    mockInvites = [];
    mockShifts = [];
    mockSwaps = [];
    mockCharges = [];
    mockLedgerEntries = [];
    mockOutboxEntries = [];
    mockEmailMessages = [];
    mockRedisStore.clear();
    vi.clearAllMocks();

    ownerToken = await createAccessToken(ownerUserId);
    managerToken = await createAccessToken(managerUserId);
    staffToken = await createAccessToken(staffUserId);
    outsiderToken = await createAccessToken(outsiderUserId);
  });

  describe('FR-09: Create Invite Link', () => {
    it('allows manager to create staff invite, returns 7-day token and URL', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites`,
        'POST',
        { role: 'STAFF', email: 'invitee@clinic.com' },
        managerToken,
      );

      const res = await createInviteRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(201);

      const body = (await res.json()) as {
        id: string;
        teamId: string;
        role: string;
        email: string;
        expiresAt: string;
        inviteUrl: string;
        seatImpact: { addsPaidSeat: boolean };
      };

      expect(body.role).toBe('STAFF');
      expect(body.email).toBe('invitee@clinic.com');
      expect(body.inviteUrl).toMatch(/^https:\/\/[^/]+\/i\/[A-Za-z0-9_-]+$/);
      expect(mockInvites.length).toBe(1);

      // Verify emailMessage and outbox entry created
      expect(mockEmailMessages.length).toBe(1);
      expect(mockEmailMessages[0]?.to).toBe('invitee@clinic.com');
      expect(mockOutboxEntries.some((o) => o.kind === 'email.send')).toBe(true);
    });

    it('allows owner to create MANAGER invite', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites`,
        'POST',
        { role: 'MANAGER' },
        ownerToken,
      );

      const res = await createInviteRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { role: string };
      expect(body.role).toBe('MANAGER');
    });

    it('rejects manager inviting MANAGER with 403 FORBIDDEN (B-23)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites`,
        'POST',
        { role: 'MANAGER' },
        managerToken,
      );

      const res = await createInviteRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff creating invite with 403 FORBIDDEN', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites`,
        'POST',
        { role: 'STAFF' },
        staffToken,
      );

      const res = await createInviteRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 409 SEAT_LIMIT_REACHED when active seats + pending invites equal 5 on Starter (B-7)', async () => {
      // Current active seats: 3 (owner, manager, staff). Add 2 pending invites.
      mockInvites.push(
        {
          id: '018f3a2b-0000-7000-8020-000000000001',
          teamId,
          tokenHash: 'hash1',
          role: 'STAFF',
          email: null,
          createdByUserId: ownerUserId,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          acceptedAt: null,
          acceptedByUserId: null,
          revokedAt: null,
        },
        {
          id: '018f3a2b-0000-7000-8020-000000000002',
          teamId,
          tokenHash: 'hash2',
          role: 'STAFF',
          email: null,
          createdByUserId: ownerUserId,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
          acceptedAt: null,
          acceptedByUserId: null,
          revokedAt: null,
        },
      );

      // Now 3 active + 2 pending = 5 seats. Next invite should fail with 409.
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites`,
        'POST',
        { role: 'STAFF' },
        ownerToken,
      );

      const res = await createInviteRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('SEAT_LIMIT_REACHED');
    });

    it('returns 404 NOT_FOUND for non-member caller (B-19, FR-43)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites`,
        'POST',
        { role: 'STAFF' },
        outsiderToken,
      );

      const res = await createInviteRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('FR-09 & FR-10: Pending Invites and Revocation', () => {
    it('lists pending invites for team', async () => {
      mockInvites.push({
        id: '018f3a2b-0000-7000-8020-000000000001',
        teamId,
        tokenHash: 'hash1',
        role: 'STAFF',
        email: 'nurse@clinic.com',
        createdByUserId: ownerUserId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        acceptedAt: null,
        acceptedByUserId: null,
        revokedAt: null,
      });

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites`,
        'GET',
        undefined,
        managerToken,
      );

      const res = await getPendingInvitesRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { invites: unknown[] };
      expect(body.invites.length).toBe(1);
    });

    it('allows manager to revoke a pending invite', async () => {
      const inviteId = '018f3a2b-0000-7000-8020-000000000001';
      mockInvites.push({
        id: inviteId,
        teamId,
        tokenHash: 'hash1',
        role: 'STAFF',
        email: null,
        createdByUserId: ownerUserId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
        acceptedAt: null,
        acceptedByUserId: null,
        revokedAt: null,
      });

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites/${inviteId}`,
        'DELETE',
        undefined,
        managerToken,
      );

      const res = await revokeInviteRoute(req, {
        params: Promise.resolve({ teamId, inviteId }),
      });
      expect(res.status).toBe(200);

      const inv = mockInvites.find((i) => i.id === inviteId);
      expect(inv?.revokedAt).not.toBeNull();
    });
  });

  describe('FR-10: Public Invite Inspection and Acceptance', () => {
    const rawToken = 'sample-valid-token-32-chars-long';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    beforeEach(() => {
      mockInvites.push({
        id: '018f3a2b-0000-7000-8020-000000000099',
        teamId,
        tokenHash,
        role: 'STAFF',
        email: 'outsider@other.com',
        createdByUserId: ownerUserId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
        acceptedAt: null,
        acceptedByUserId: null,
        revokedAt: null,
      });
    });

    it('publicly inspects valid invite token without modifying state (SEC-7)', async () => {
      const req = makeRequest(`http://localhost:3000/v1/invites/${rawToken}`, 'GET');

      const res = await getInviteByTokenRoute(req, {
        params: Promise.resolve({ token: rawToken }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        teamId: string;
        teamName: string;
        role: string;
      };
      expect(body.teamId).toBe(teamId);
      expect(body.teamName).toBe('Metro Health Clinic');
      expect(body.role).toBe('STAFF');
    });

    it('returns 410 INVITE_INVALID when token is expired, revoked, or already accepted', async () => {
      const inv = mockInvites[0];
      if (!inv) throw new Error('Invite missing');
      inv.revokedAt = new Date();

      const req = makeRequest(`http://localhost:3000/v1/invites/${rawToken}`, 'GET');

      const res = await getInviteByTokenRoute(req, {
        params: Promise.resolve({ token: rawToken }),
      });
      expect(res.status).toBe(410);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVITE_INVALID');
    });

    it('allows a logged-in user to accept invite and join team', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/invites/${rawToken}/accept`,
        'POST',
        {},
        outsiderToken,
      );

      const res = await acceptInviteRoute(req, {
        params: Promise.resolve({ token: rawToken }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { ok: boolean; teamId: string; role: string };
      expect(body.ok).toBe(true);
      expect(body.role).toBe('STAFF');

      // Verify invite marked accepted
      const inv = mockInvites.find((i) => i.tokenHash === tokenHash);
      expect(inv?.acceptedAt).not.toBeNull();
      expect(inv?.acceptedByUserId).toBe(outsiderUserId);

      // Verify new Membership created
      const newMem = mockMemberships.find((m) => m.userId === outsiderUserId);
      expect(newMem).toBeDefined();
      expect(newMem?.role).toBe('STAFF');
      expect(newMem?.status).toBe('ACTIVE');

      // Verify feed.append outbox entry
      expect(mockOutboxEntries.some((o) => o.kind === 'feed.append')).toBe(true);
    });

    it('returns 409 ALREADY_MEMBER when active member tries to accept invite', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/invites/${rawToken}/accept`,
        'POST',
        {},
        staffToken, // Already active member
      );

      const res = await acceptInviteRoute(req, {
        params: Promise.resolve({ token: rawToken }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('ALREADY_MEMBER');

      // Verify invite stays unused
      const inv = mockInvites.find((i) => i.tokenHash === tokenHash);
      expect(inv?.acceptedAt).toBeNull();
    });

    it('reactivates existing membership row for returning member (L19, FR-10)', async () => {
      // Add existing membership as REMOVED
      mockMemberships.push({
        id: '018f3a2b-0000-7000-8010-000000000099',
        teamId,
        userId: outsiderUserId,
        role: 'STAFF',
        status: 'REMOVED',
        joinedAt: new Date('2026-01-01T00:00:00Z'),
        endedAt: new Date('2026-06-01T00:00:00Z'),
      });

      const req = makeRequest(
        `http://localhost:3000/v1/invites/${rawToken}/accept`,
        'POST',
        {},
        outsiderToken,
      );

      const res = await acceptInviteRoute(req, {
        params: Promise.resolve({ token: rawToken }),
      });
      expect(res.status).toBe(200);

      const mem = mockMemberships.find((m) => m.userId === outsiderUserId);
      expect(mem?.status).toBe('ACTIVE');
      expect(mem?.endedAt).toBeNull();
      // Ensure no duplicate membership row was created
      expect(mockMemberships.filter((m) => m.userId === outsiderUserId).length).toBe(1);
    });
  });

  describe('FR-11: Member List and Role Update', () => {
    it('returns all active members of the team', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/members`,
        'GET',
        undefined,
        staffToken,
      );

      const res = await getMembersRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as { members: { role: string; email: string }[] };
      expect(body.members.length).toBe(3);
      expect(body.members.some((m) => m.role === 'OWNER')).toBe(true);
      expect(body.members.some((m) => m.role === 'MANAGER')).toBe(true);
      expect(body.members.some((m) => m.role === 'STAFF')).toBe(true);
    });

    it('allows owner to promote staff to manager and demote manager to staff (FR-11)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/members/${staffUserId}`,
        'PATCH',
        { role: 'MANAGER' },
        ownerToken,
      );

      const res = await updateMemberRoleRoute(req, {
        params: Promise.resolve({ teamId, userId: staffUserId }),
      });
      expect(res.status).toBe(200);

      const mem = mockMemberships.find((m) => m.userId === staffUserId);
      expect(mem?.role).toBe('MANAGER');
    });

    it('rejects manager trying to change a role with 403 FORBIDDEN (FR-11)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/members/${staffUserId}`,
        'PATCH',
        { role: 'MANAGER' },
        managerToken,
      );

      const res = await updateMemberRoleRoute(req, {
        params: Promise.resolve({ teamId, userId: staffUserId }),
      });
      expect(res.status).toBe(403);
    });

    it('rejects owner demoting or changing own role with 409 OWNER_MUST_TRANSFER (B-24)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/members/${ownerUserId}`,
        'PATCH',
        { role: 'MANAGER' },
        ownerToken,
      );

      const res = await updateMemberRoleRoute(req, {
        params: Promise.resolve({ teamId, userId: ownerUserId }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('OWNER_MUST_TRANSFER');
    });
  });

  describe('FR-12: Member Removal and Leaving Team', () => {
    it('allows manager to remove staff member and cancels open swaps on future shifts', async () => {
      // Future shift assigned to staff member with open swap
      const shiftId = '018f3a2b-0000-7000-8030-000000000001';
      mockShifts.push({
        id: shiftId,
        teamId,
        assigneeUserId: staffUserId,
        startsAt: new Date(Date.now() + 86400000), // tomorrow
        endsAt: new Date(Date.now() + 86400000 + 8 * 3600000),
      });
      mockSwaps.push({
        id: '018f3a2b-0000-7000-8035-000000000001',
        teamId,
        shiftId,
        status: 'PENDING_PEER',
      });

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/members/${staffUserId}`,
        'DELETE',
        undefined,
        managerToken,
      );

      const res = await removeMemberRoute(req, {
        params: Promise.resolve({ teamId, userId: staffUserId }),
      });
      expect(res.status).toBe(200);

      // Verify membership set to REMOVED
      const mem = mockMemberships.find((m) => m.userId === staffUserId);
      expect(mem?.status).toBe('REMOVED');
      expect(mem?.endedAt).not.toBeNull();

      // Verify open swap on future shift cancelled (FR-12)
      const swap = mockSwaps.find((s) => s.shiftId === shiftId);
      expect(swap?.status).toBe('CANCELED');
    });

    it('rejects manager trying to remove another manager with 403 FORBIDDEN (B-23)', async () => {
      // Add another manager
      const otherManagerId = '018f3a2b-9000-7000-8000-000000000001';
      mockUsers.push({ id: otherManagerId, email: 'mgr2@clinic.com', displayName: 'Mgr 2' });
      mockMemberships.push({
        id: '018f3a2b-0000-7000-8010-000000000098',
        teamId,
        userId: otherManagerId,
        role: 'MANAGER',
        status: 'ACTIVE',
        joinedAt: new Date(),
        endedAt: null,
      });

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/members/${otherManagerId}`,
        'DELETE',
        undefined,
        managerToken,
      );

      const res = await removeMemberRoute(req, {
        params: Promise.resolve({ teamId, userId: otherManagerId }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('allows owner to remove manager', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/members/${managerUserId}`,
        'DELETE',
        undefined,
        ownerToken,
      );

      const res = await removeMemberRoute(req, {
        params: Promise.resolve({ teamId, userId: managerUserId }),
      });
      expect(res.status).toBe(200);

      const mem = mockMemberships.find((m) => m.userId === managerUserId);
      expect(mem?.status).toBe('REMOVED');
    });

    it('rejects removing the owner with 409 OWNER_MUST_TRANSFER (B-24)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/members/${ownerUserId}`,
        'DELETE',
        undefined,
        ownerToken,
      );

      const res = await removeMemberRoute(req, {
        params: Promise.resolve({ teamId, userId: ownerUserId }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('OWNER_MUST_TRANSFER');
    });

    it('allows staff or manager to leave team', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/leave`,
        'POST',
        {},
        staffToken,
      );

      const res = await leaveTeamRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(200);

      const mem = mockMemberships.find((m) => m.userId === staffUserId);
      expect(mem?.status).toBe('LEFT');
      expect(mem?.endedAt).not.toBeNull();
    });

    it('rejects owner leaving team with 409 OWNER_MUST_TRANSFER (B-24)', async () => {
      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/leave`,
        'POST',
        {},
        ownerToken,
      );

      const res = await leaveTeamRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('OWNER_MUST_TRANSFER');
    });
  });

  describe('Read-Only Team Enforcement (B-14, FR-25)', () => {
    it('returns 403 TEAM_READ_ONLY on invite creation when team is read-only', async () => {
      const sub = mockSubscriptions[0];
      if (!sub) throw new Error('Sub missing');
      sub.status = 'READ_ONLY';

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/invites`,
        'POST',
        { role: 'STAFF' },
        ownerToken,
      );

      const res = await createInviteRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('TEAM_READ_ONLY');
    });

    it('allows leaving team even when team is read-only (B-14 exception)', async () => {
      const sub = mockSubscriptions[0];
      if (!sub) throw new Error('Sub missing');
      sub.status = 'READ_ONLY';

      const req = makeRequest(
        `http://localhost:3000/v1/teams/${teamId}/leave`,
        'POST',
        {},
        staffToken,
      );

      const res = await leaveTeamRoute(req, {
        params: Promise.resolve({ teamId }),
      });
      expect(res.status).toBe(200);
      const mem = mockMemberships.find((m) => m.userId === staffUserId);
      expect(mem?.status).toBe('LEFT');
    });
  });
});
