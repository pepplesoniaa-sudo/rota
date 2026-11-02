import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createTeamRoute } from '../../../app/v1/teams/route';
import { createAccessToken } from '../../../lib/auth/jwt';
import { computeShardIndex } from '../../../lib/data/router';

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
  status: 'ACTIVE' | 'INACTIVE';
  joinedAt: Date;
  endedAt: Date | null;
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

interface MockCharge {
  id: string;
  teamId: string;
  subscriptionId: string;
  kind: string;
  status: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  lineItems: unknown;
  dueAt: Date;
}

interface MockLedgerEntry {
  id: string;
  teamId: string;
  chargeId: string | null;
  type: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  description: string;
  metadata: unknown;
  occurredAt: Date;
}

interface MockOutbox {
  id: string;
  teamId: string | null;
  kind: string;
  sourceKey: string;
  payload: unknown;
}

let mockTeams: MockTeam[] = [];
let mockMemberships: MockMembership[] = [];
let mockSubscriptions: MockSubscription[] = [];
let mockCharges: MockCharge[] = [];
let mockLedgerEntries: MockLedgerEntry[] = [];
let mockOutboxEntries: MockOutbox[] = [];
const mockRedisStore = new Map<string, { value: string; expireAt: number }>();

vi.mock('../../../lib/db', () => {
  const mockTeamDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockTeam, 'updatedAt' | 'deletedAt'> }) => {
      const record: MockTeam = {
        id: data.id,
        name: data.name,
        timezone: data.timezone,
        shardIndex: data.shardIndex,
        weekStartsOn: data.weekStartsOn,
        ownerUserId: data.ownerUserId,
        createdAt: data.createdAt,
        updatedAt: data.createdAt,
        deletedAt: null,
      };
      mockTeams.push(record);
      return record;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = mockTeams.find((t) => t.id === where.id);
      return found ? { ...found } : null;
    }),
  };

  const mockMembershipDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockMembership, 'id' | 'endedAt'> }) => {
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
  };

  const mockSubscriptionDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockSubscription, 'id'> }) => {
      const record: MockSubscription = {
        id: `018f3a2b-0000-7000-8020-${String(mockSubscriptions.length + 1).padStart(12, '0')}`,
        teamId: data.teamId,
        plan: data.plan,
        status: data.status,
        anchorDay: data.anchorDay,
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
        paidSeats: data.paidSeats,
        version: data.version,
      };
      mockSubscriptions.push(record);
      return record;
    }),
  };

  const mockChargeDelegate = {
    create: vi.fn(async ({ data }: { data: MockCharge }) => {
      const record: MockCharge = { ...data };
      mockCharges.push(record);
      return record;
    }),
  };

  const mockLedgerEntryDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockLedgerEntry, 'id'> }) => {
      const record: MockLedgerEntry = {
        id: `018f3a2b-0000-7000-8030-${String(mockLedgerEntries.length + 1).padStart(12, '0')}`,
        teamId: data.teamId,
        chargeId: data.chargeId ?? null,
        type: data.type,
        amountCents: data.amountCents,
        currency: data.currency,
        idempotencyKey: data.idempotencyKey,
        description: data.description,
        metadata: data.metadata,
        occurredAt: data.occurredAt,
      };
      mockLedgerEntries.push(record);
      return record;
    }),
  };

  const mockOutboxDelegate = {
    create: vi.fn(async ({ data }: { data: Omit<MockOutbox, 'id'> }) => {
      const record: MockOutbox = {
        id: `018f3a2b-0000-7000-8040-${String(mockOutboxEntries.length + 1).padStart(12, '0')}`,
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
    team: mockTeamDelegate,
    membership: mockMembershipDelegate,
    subscription: mockSubscriptionDelegate,
    charge: mockChargeDelegate,
    ledgerEntry: mockLedgerEntryDelegate,
    outbox: mockOutboxDelegate,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        team: mockTeamDelegate,
        membership: mockMembershipDelegate,
        subscription: mockSubscriptionDelegate,
        charge: mockChargeDelegate,
        ledgerEntry: mockLedgerEntryDelegate,
        outbox: mockOutboxDelegate,
      }),
    ),
    $primary: vi.fn(() => ({
      team: mockTeamDelegate,
      membership: mockMembershipDelegate,
      subscription: mockSubscriptionDelegate,
      charge: mockChargeDelegate,
      ledgerEntry: mockLedgerEntryDelegate,
      outbox: mockOutboxDelegate,
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          team: mockTeamDelegate,
          membership: mockMembershipDelegate,
          subscription: mockSubscriptionDelegate,
          charge: mockChargeDelegate,
          ledgerEntry: mockLedgerEntryDelegate,
          outbox: mockOutboxDelegate,
        }),
      ),
    })),
  };

  return {
    dbShard0: mockDbClient,
    getDbShard0: () => mockDbClient,
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
  },
  JobId: {
    feedAppend: (membershipId: string, joinedAt: string) => `feed:${membershipId}:${joinedAt}`,
  },
}));

function makeRequest(body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  return new NextRequest('http://localhost:3000/v1/teams', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /v1/teams (FR-07)', () => {
  const testUserId = '018f3a2b-1111-7000-8000-000000000001';
  let validToken: string;

  beforeEach(async () => {
    mockTeams = [];
    mockMemberships = [];
    mockSubscriptions = [];
    mockCharges = [];
    mockLedgerEntries = [];
    mockOutboxEntries = [];
    mockRedisStore.clear();
    vi.clearAllMocks();

    validToken = await createAccessToken(testUserId);
  });

  it('FR-07: given valid name and timezone, creates team, assigns OWNER, starts trial, creates charge & ledger entry', async () => {
    const req = makeRequest(
      {
        name: 'Evergreen Health Clinic',
        timezone: 'America/New_York',
        weekStartsOn: 1,
      },
      validToken,
    );

    const res = await createTeamRoute(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      id: string;
      name: string;
      timezone: string;
      shardIndex: number;
      weekStartsOn: number;
      role: string;
      createdAt: string;
    };

    expect(body.id).toBeDefined();
    expect(body.name).toBe('Evergreen Health Clinic');
    expect(body.timezone).toBe('America/New_York');
    expect(body.role).toBe('OWNER');
    expect(body.weekStartsOn).toBe(1);

    // Verify shardIndex deterministic calculation (PRD 7.6)
    const expectedShard = computeShardIndex(body.id);
    expect(body.shardIndex).toBe(expectedShard);

    // Verify Team stored on Shard 0 with ownerUserId
    expect(mockTeams.length).toBe(1);
    const storedTeam = mockTeams[0];
    if (!storedTeam) throw new Error('Team missing');
    expect(storedTeam.ownerUserId).toBe(testUserId);
    expect(storedTeam.shardIndex).toBe(expectedShard);

    // Verify creator Membership created as ACTIVE OWNER (B-22)
    expect(mockMemberships.length).toBe(1);
    const storedMembership = mockMemberships[0];
    if (!storedMembership) throw new Error('Membership missing');
    expect(storedMembership.userId).toBe(testUserId);
    expect(storedMembership.teamId).toBe(body.id);
    expect(storedMembership.role).toBe('OWNER');
    expect(storedMembership.status).toBe('ACTIVE');

    // Verify Starter Subscription created (B-8, FR-07)
    expect(mockSubscriptions.length).toBe(1);
    const storedSub = mockSubscriptions[0];
    if (!storedSub) throw new Error('Subscription missing');
    expect(storedSub.teamId).toBe(body.id);
    expect(storedSub.plan).toBe('STARTER');
    expect(storedSub.paidSeats).toBe(1);
    expect(storedSub.status).toBe('ACTIVE');

    // Verify first Charge created with dueAt 14 days later (14-day trial) (FR-07, B-8)
    expect(mockCharges.length).toBe(1);
    const storedCharge = mockCharges[0];
    if (!storedCharge) throw new Error('Charge missing');
    expect(storedCharge.teamId).toBe(body.id);
    expect(storedCharge.amountCents).toBe(2000); // Starter $20.00
    expect(storedCharge.status).toBe('PENDING');

    const trialDurationMs = storedCharge.dueAt.getTime() - storedSub.currentPeriodStart.getTime();
    expect(trialDurationMs).toBe(14 * 24 * 60 * 60 * 1000);

    // Verify CHARGE_SUBSCRIPTION ledger entry appended (MB-8, MB-9, PRD 8.7)
    expect(mockLedgerEntries.length).toBe(1);
    const storedLedger = mockLedgerEntries[0];
    if (!storedLedger) throw new Error('Ledger entry missing');
    expect(storedLedger.teamId).toBe(body.id);
    expect(storedLedger.chargeId).toBe(storedCharge.id);
    expect(storedLedger.type).toBe('CHARGE_SUBSCRIPTION');
    expect(storedLedger.amountCents).toBe(2000);
    expect(storedLedger.idempotencyKey).toBe(`charge:${storedCharge.id}`);

    // Verify outbox entry created for member joined on shard
    expect(mockOutboxEntries.length).toBe(1);
    const outbox = mockOutboxEntries[0];
    if (!outbox) throw new Error('Outbox entry missing');
    expect(outbox.kind).toBe('feed.append');

    // Verify Redis permission cache warmed with OWNER (L-32)
    const cachedPerm = mockRedisStore.get(`perm:${testUserId}:${body.id}`);
    expect(cachedPerm?.value).toBe('OWNER');
  });

  it('FR-07: given an invalid IANA timezone such as America/Chicag, returns 400 VALIDATION_FAILED', async () => {
    const req = makeRequest(
      {
        name: 'Invalid Zone Clinic',
        timezone: 'America/Chicag', // invalid timezone
      },
      validToken,
    );

    const res = await createTeamRoute(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);

    const data = (await res.json()) as { error: { code: string; message: string } };
    expect(data.error.code).toBe('VALIDATION_FAILED');
  });

  it('FR-07: given a name under 2 characters or over 80 characters, returns 400 VALIDATION_FAILED', async () => {
    // Under 2 characters
    const reqShort = makeRequest(
      {
        name: 'A',
        timezone: 'UTC',
      },
      validToken,
    );
    const resShort = await createTeamRoute(reqShort, { params: Promise.resolve({}) });
    expect(resShort.status).toBe(400);

    // Over 80 characters
    const reqLong = makeRequest(
      {
        name: 'A'.repeat(81),
        timezone: 'UTC',
      },
      validToken,
    );
    const resLong = await createTeamRoute(reqLong, { params: Promise.resolve({}) });
    expect(resLong.status).toBe(400);
  });

  it('FR-07: given unexpected extra fields, returns 400 VALIDATION_FAILED (strict check CS-10)', async () => {
    const reqExtra = makeRequest(
      {
        name: 'Valid Team',
        timezone: 'UTC',
        unexpectedField: 'forbidden',
      },
      validToken,
    );

    const resExtra = await createTeamRoute(reqExtra, { params: Promise.resolve({}) });
    expect(resExtra.status).toBe(400);

    const data = (await resExtra.json()) as { error: { code: string; message: string } };
    expect(data.error.code).toBe('VALIDATION_FAILED');
  });

  it('FR-07 & SEC-1: given no token or invalid authorization header, returns 401 AUTH_TOKEN_EXPIRED', async () => {
    const reqNoAuth = makeRequest({
      name: 'Valid Team',
      timezone: 'UTC',
    });

    const resNoAuth = await createTeamRoute(reqNoAuth, { params: Promise.resolve({}) });
    expect(resNoAuth.status).toBe(401);

    const data = (await resNoAuth.json()) as { error: { code: string; message: string } };
    expect(data.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });
});
