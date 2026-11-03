import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getBillingOverviewRoute } from '../../../app/v1/teams/[teamId]/billing/route';
import { POST as previewPlanRoute } from '../../../app/v1/teams/[teamId]/billing/preview/route';
import { POST as changePlanRoute } from '../../../app/v1/teams/[teamId]/billing/plan/route';
import { DELETE as cancelScheduledChangeRoute } from '../../../app/v1/teams/[teamId]/billing/scheduled-change/route';
import { createAccessToken } from '../../../lib/auth/jwt';
import { Plan, SubscriptionStatus, LedgerEntryType } from '@prisma/client';

interface MockMembership {
  id: string;
  teamId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'INACTIVE';
}

interface MockSubscription {
  id: string;
  teamId: string;
  plan: Plan;
  status: SubscriptionStatus;
  anchorDay: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  paidSeats: number;
  scheduledPlan?: Plan | null;
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
  dueAt: Date;
  lineItems: unknown;
}

interface MockLedgerEntry {
  id: string;
  teamId: string;
  chargeId: string | null;
  type: LedgerEntryType;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  description: string;
  occurredAt: Date;
}

interface MockTeam {
  id: string;
  name: string;
}

let mockTeam: MockTeam;
let mockMemberships: MockMembership[] = [];
let mockSubscription: MockSubscription;
let mockCharges: MockCharge[] = [];
let mockLedgerEntries: MockLedgerEntry[] = [];
const enqueuedJobs: Array<{ queue: string; name: string; data: unknown }> = [];

vi.mock('../../../lib/redis', () => ({
  redis: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}));

vi.mock('../../../worker/queues', () => ({
  getQueue: (queueName: string) => ({
    add: vi.fn(async (name: string, data: unknown) => {
      enqueuedJobs.push({ queue: queueName, name, data });
      return { id: 'mock-job-id' };
    }),
  }),
  JobId: {
    billingCharge: () => 'mock-job-id',
  },
  JOB_RETRY_POLICIES: {
    'billing.charge': {},
  },
}));

vi.mock('../../../lib/db', () => {
  const db = {
    subscription: {
      findUnique: vi.fn(async ({ where }: { where: { teamId: string } }) => {
        if (where.teamId !== mockTeam.id) return null;
        return {
          ...mockSubscription,
          team: {
            id: mockTeam.id,
            name: mockTeam.name,
            memberships: mockMemberships.filter((m) => m.status === 'ACTIVE'),
            paymentMethods: [],
          },
          charges: mockCharges.filter((c) => ['PENDING', 'FAILED', 'DEFERRED'].includes(c.status)),
        };
      }),
      update: vi.fn(
        async ({
          data,
        }: {
          where?: { id?: string; teamId?: string };
          data: Partial<MockSubscription>;
        }) => {
          Object.assign(mockSubscription, data);
          return {
            ...mockSubscription,
            team: {
              id: mockTeam.id,
              name: mockTeam.name,
              memberships: mockMemberships.filter((m) => m.status === 'ACTIVE'),
              paymentMethods: [],
            },
          };
        },
      ),
    },
    membership: {
      findUnique: vi.fn(
        async ({ where }: { where: { teamId_userId: { teamId: string; userId: string } } }) => {
          const found = mockMemberships.find(
            (m) =>
              m.teamId === where.teamId_userId.teamId && m.userId === where.teamId_userId.userId,
          );
          return found ? { ...found } : null;
        },
      ),
      count: vi.fn(async ({ where }: { where: { teamId: string; status: string } }) => {
        return mockMemberships.filter((m) => m.teamId === where.teamId && m.status === where.status)
          .length;
      }),
    },
    team: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== mockTeam.id) return null;
        return { ...mockTeam, subscription: { ...mockSubscription } };
      }),
    },
    charge: {
      create: vi.fn(async ({ data }: { data: Omit<MockCharge, 'id'> & { id?: string } }) => {
        const record: MockCharge = {
          id:
            data.id ??
            `018f3a2b-0000-7000-8000-${String(mockCharges.length + 1).padStart(12, '0')}`,
          ...data,
        };
        mockCharges.push(record);
        return record;
      }),
    },
    ledgerEntry: {
      create: vi.fn(async ({ data }: { data: Omit<MockLedgerEntry, 'id'> }) => {
        const record: MockLedgerEntry = {
          id: `018f3a2b-0000-7000-8002-${String(mockLedgerEntries.length + 1).padStart(12, '0')}`,
          ...data,
        };
        mockLedgerEntries.push(record);
        return record;
      }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(db)),
  };

  return {
    dbShard0: db,
    dbShard1: db,
    getShardDbForTeam: vi.fn(async () => db),
    getShardIndexForTeam: vi.fn(async () => 0),
  };
});

describe('Phase 5: Plan Preview, Plan Changes, and Downgrades (FR-34, FR-36, FR-37, B-4, B-5, B-6, B-7, B-16)', () => {
  const teamId = '018f3a2b-0000-7000-8000-000000000001';
  const ownerUserId = '018f3a2b-0000-7000-8000-000000000002';
  const managerUserId = '018f3a2b-0000-7000-8000-000000000003';
  let ownerToken: string;
  let managerToken: string;

  const periodStart = new Date('2026-11-01T00:00:00.000Z');
  const periodEnd = new Date('2026-12-01T00:00:00.000Z');

  beforeEach(async () => {
    ownerToken = await createAccessToken(ownerUserId);
    managerToken = await createAccessToken(managerUserId);

    mockTeam = { id: teamId, name: 'Dental Clinic' };
    mockMemberships = [
      { id: 'm-1', teamId, userId: ownerUserId, role: 'OWNER', status: 'ACTIVE' },
      { id: 'm-2', teamId, userId: managerUserId, role: 'MANAGER', status: 'ACTIVE' },
      { id: 'm-3', teamId, userId: 'u-3', role: 'STAFF', status: 'ACTIVE' },
    ];
    mockSubscription = {
      id: 'sub-1',
      teamId,
      plan: Plan.STARTER,
      status: SubscriptionStatus.ACTIVE,
      anchorDay: 1,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      paidSeats: 3,
      scheduledPlan: null,
      version: 1,
    };
    mockCharges = [];
    mockLedgerEntries = [];
    enqueuedJobs.length = 0;
    vi.clearAllMocks();
  });

  it('B-16: non-owner (MANAGER or STAFF) receives 403 FORBIDDEN on billing endpoints', async () => {
    const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/billing`, {
      method: 'GET',
      headers: { authorization: `Bearer ${managerToken}` },
    });
    const res = await getBillingOverviewRoute(req, { params: Promise.resolve({ teamId }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('FR-34: owner views billing overview with accurate active seats, paid seats, and tier savings', async () => {
    // Expand memberships to 40 seats on Team plan to trigger "betterTierSavings"
    mockSubscription.plan = Plan.TEAM;
    mockSubscription.paidSeats = 40;
    for (let i = 4; i <= 40; i++) {
      mockMemberships.push({
        id: `m-${i}`,
        teamId,
        userId: `u-${i}`,
        role: 'STAFF',
        status: 'ACTIVE',
      });
    }

    const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/billing`, {
      method: 'GET',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const res = await getBillingOverviewRoute(req, { params: Promise.resolve({ teamId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.plan).toBe('TEAM');
    expect(body.activeSeats).toBe(40);
    // At 40 seats: Team is 5000 + 25 * 300 = 12500 cents. Business is 12000 base for 40 seats.
    // Business saves $5.00 (500 cents)
    expect(body.betterTierSavings).toBeDefined();
    expect(body.betterTierSavings?.suggestedPlan).toBe('BUSINESS');
    expect(body.betterTierSavings?.savingsMonthlyCents).toBe(500);
    expect(body.betterTierSavings?.message).toContain('Business would cost $5.00 less per month');
  });

  it('POST /billing/preview matches PRD 8.4 calculation without mutating subscription', async () => {
    const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/billing/preview`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ plan: 'TEAM' }),
    });

    const res = await previewPlanRoute(req, { params: Promise.resolve({ teamId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.currentPlan).toBe('STARTER');
    expect(body.newPlan).toBe('TEAM');
    expect(body.isUpgrade).toBe(true);
    expect(body.appliesAt).toBe('IMMEDIATELY');
    expect(body.prorationCents).toBeGreaterThan(0);
    // Subscription not modified
    expect(mockSubscription.plan).toBe('STARTER');
    expect(mockCharges).toHaveLength(0);
  });

  it('B-6 / FR-37: rejects downgrade to Starter when active seats exceed 5 with 409 SEAT_LIMIT_REACHED', async () => {
    mockSubscription.plan = Plan.TEAM;
    mockSubscription.paidSeats = 6;
    for (let i = 4; i <= 6; i++) {
      mockMemberships.push({
        id: `m-${i}`,
        teamId,
        userId: `u-${i}`,
        role: 'STAFF',
        status: 'ACTIVE',
      });
    }

    const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/billing/plan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ plan: 'STARTER' }),
    });

    const res = await changePlanRoute(req, { params: Promise.resolve({ teamId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('SEAT_LIMIT_REACHED');
    expect(mockSubscription.plan).toBe('TEAM');
    expect(mockSubscription.scheduledPlan).toBeNull();
  });

  it('FR-37: schedules downgrade for period end without immediate charge or refund', async () => {
    mockSubscription.plan = Plan.TEAM;
    mockSubscription.paidSeats = 3;

    const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/billing/plan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ plan: 'STARTER' }),
    });

    const res = await changePlanRoute(req, { params: Promise.resolve({ teamId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.isUpgrade).toBe(false);
    expect(body.appliesAt).toBe('PERIOD_END');
    expect(body.prorationCents).toBe(0);
    // Subscription still on TEAM, with scheduledPlan set
    expect(mockSubscription.plan).toBe('TEAM');
    expect(mockSubscription.scheduledPlan).toBe('STARTER');
    expect(mockCharges).toHaveLength(0);

    // Cancel scheduled downgrade
    const reqCancel = new NextRequest(
      `http://localhost:3000/v1/teams/${teamId}/billing/scheduled-change`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${ownerToken}` },
      },
    );
    const resCancel = await cancelScheduledChangeRoute(reqCancel, {
      params: Promise.resolve({ teamId }),
    });
    expect(resCancel.status).toBe(200);
    expect(mockSubscription.scheduledPlan).toBeNull();
  });

  it('FR-36 / B-5 / B-12: applies upgrade immediately, creating proration charge and ledger entry', async () => {
    const req = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/billing/plan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ plan: 'TEAM' }),
    });

    const res = await changePlanRoute(req, { params: Promise.resolve({ teamId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.isUpgrade).toBe(true);
    expect(body.appliesAt).toBe('IMMEDIATELY');
    expect(body.prorationCents).toBeGreaterThan(0);

    // Plan updated immediately
    expect(mockSubscription.plan).toBe('TEAM');

    // Charge created
    expect(mockCharges).toHaveLength(1);
    expect(mockCharges[0].kind).toBe('UPGRADE_PRORATION');
    expect(mockCharges[0].amountCents).toBe(body.prorationCents);

    // Ledger entry recorded
    expect(mockLedgerEntries).toHaveLength(1);
    expect(mockLedgerEntries[0].type).toBe(LedgerEntryType.CHARGE_UPGRADE_PRORATION);
    expect(mockLedgerEntries[0].amountCents).toBe(body.prorationCents);
    expect(mockLedgerEntries[0].idempotencyKey).toBe(`charge:${mockCharges[0].id}`);
  });
});
