import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBillingOverdueScan } from '../../../worker/jobs/billing/overdue-scan';
import { handleBillingGraceStep } from '../../../worker/jobs/billing/grace-step';
import { handleBillingCharge } from '../../../worker/jobs/billing/charge';
import { checkTeamNotReadOnly } from '../../../lib/auth/permissions';
import { encryptCardToken } from '../../../lib/billing/flutterwave/encryption';
import { SubscriptionStatus, LedgerEntryType, ChargeStatus } from '@prisma/client';

interface MockSubscription {
  id: string;
  teamId: string;
  plan: string;
  status: SubscriptionStatus;
  paidSeats: number;
  graceEndsAt?: Date | null;
  failedAt?: Date | null;
  readOnlySince?: Date | null;
  version: number;
}

interface MockCharge {
  id: string;
  teamId: string;
  subscriptionId: string;
  kind: string;
  status: ChargeStatus;
  amountCents: number;
  currency: string;
  dueAt: Date;
  paidAt?: Date | null;
  failureCode?: string | null;
  lineItems: unknown;
}

interface MockChargeAttempt {
  id: string;
  chargeId: string;
  attemptNo: number;
  txRef: string;
  method: 'CHECKOUT' | 'TOKEN';
  status: ChargeStatus;
  amountCents: number;
  providerTxId?: string | null;
  failureCode?: string | null;
}

interface MockPaymentMethod {
  id: string;
  teamId: string;
  providerTokenEncrypted: string;
  cardBrand: string;
  cardLast4: string;
  expMonth: number;
  expYear: number;
  disabledAt: Date | null;
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

let mockSubscriptions: MockSubscription[] = [];
let mockCharges: MockCharge[] = [];
let mockChargeAttempts: MockChargeAttempt[] = [];
let mockPaymentMethods: MockPaymentMethod[] = [];
let mockLedgerEntries: MockLedgerEntry[] = [];
const enqueuedJobs: Array<{ queue: string; name: string; data: unknown; opts?: unknown }> = [];

// Mock card charge failure/declining card
const mockChargeTokenizedCard = vi.fn();
vi.mock('../../../lib/billing/flutterwave/client', () => ({
  chargeTokenizedCard: (...args: unknown[]) => mockChargeTokenizedCard(...args),
  verifyTransaction: vi.fn(),
  resendTransactionWebhook: vi.fn(),
  createHostedPaymentLink: vi.fn(),
}));

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
    add: vi.fn(async (name: string, data: unknown, opts?: unknown) => {
      enqueuedJobs.push({ queue: queueName, name, data, opts });
      return { id: 'mock-job-id' };
    }),
  }),
  JobId: {
    billingCharge: (chargeId: string, attempt: number) => `charge:${chargeId}:${attempt}`,
    billingGraceStep: (chargeId: string, step: number) => `grace:${chargeId}:step-${step}`,
  },
  JOB_RETRY_POLICIES: {
    'billing.charge': {},
    'billing.grace-step': {},
  },
}));

vi.mock('../../../lib/db', () => {
  const db = {
    charge: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { status: { in: ChargeStatus[] }; dueAt?: { lte?: Date; lt?: Date } };
        }) => {
          const threshold = where.dueAt?.lte ?? where.dueAt?.lt ?? new Date();
          return mockCharges
            .filter((c) => where.status.in.includes(c.status) && c.dueAt <= threshold)
            .map((c) => {
              const sub = mockSubscriptions.find((s) => s.id === c.subscriptionId);
              return {
                ...c,
                subscription: sub ? { ...sub } : null,
                team: {
                  id: c.teamId,
                  subscription: sub ? { ...sub } : null,
                  paymentMethods: mockPaymentMethods.filter(
                    (p) => p.teamId === c.teamId && p.disabledAt === null,
                  ),
                },
              };
            });
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = mockCharges.find((c) => c.id === where.id);
        if (!found) return null;
        const sub = mockSubscriptions.find((s) => s.id === found.subscriptionId);
        const attempts = mockChargeAttempts
          .filter((a) => a.chargeId === found.id)
          .sort((a, b) => b.attemptNo - a.attemptNo);
        return {
          ...found,
          attempts,
          subscription: sub ? { ...sub } : null,
          team: {
            id: found.teamId,
            owner: { email: 'owner@example.com' },
            subscription: sub ? { ...sub } : null,
            paymentMethods: mockPaymentMethods.filter(
              (p) => p.teamId === found.teamId && p.disabledAt === null,
            ),
          },
        };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<MockCharge> }) => {
          const found = mockCharges.find((c) => c.id === where.id);
          if (!found) throw new Error('Charge not found');
          Object.assign(found, data);
          return { ...found };
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status: { in: string[] } };
          data: Partial<MockCharge>;
        }) => {
          let count = 0;
          for (const c of mockCharges) {
            if (c.id === where.id && where.status.in.includes(c.status)) {
              Object.assign(c, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    chargeAttempt: {
      create: vi.fn(async ({ data }: { data: Omit<MockChargeAttempt, 'id'> }) => {
        const record: MockChargeAttempt = {
          id: `018f3a2b-0000-7000-8000-${String(mockChargeAttempts.length + 1).padStart(12, '0')}`,
          ...data,
        };
        mockChargeAttempts.push(record);
        return record;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<MockChargeAttempt> }) => {
          const found = mockChargeAttempts.find((a) => a.id === where.id);
          if (!found) throw new Error('Attempt not found');
          Object.assign(found, data);
          return { ...found };
        },
      ),
    },
    subscription: {
      findUnique: vi.fn(async ({ where }: { where: { teamId?: string; id?: string } }) => {
        const found = mockSubscriptions.find((s) =>
          where.teamId ? s.teamId === where.teamId : s.id === where.id,
        );
        return found ? { ...found } : null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; teamId?: string };
          data: Partial<MockSubscription>;
        }) => {
          const found = mockSubscriptions.find((s) =>
            where.id ? s.id === where.id : s.teamId === where.teamId,
          );
          if (!found) throw new Error('Subscription not found');
          Object.assign(found, data);
          return { ...found };
        },
      ),
    },
    paymentMethod: {
      findFirst: vi.fn(async ({ where }: { where: { teamId: string; disabledAt: null } }) => {
        const found = mockPaymentMethods.find(
          (p) => p.teamId === where.teamId && p.disabledAt === null,
        );
        return found ? { ...found } : null;
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

describe('Phase 5: Grace Flow & Overdue Processing (Exit Criteria 4 & 5 / FR-39, FR-40, B-11, B-12, B-13, B-14)', () => {
  const teamId = '018f3a2b-0000-7000-8000-000000000001';
  const subscriptionId = '018f3a2b-0000-7000-8000-000000000002';
  const chargeId = '018f3a2b-0000-7000-8000-000000000003';

  beforeEach(() => {
    mockSubscriptions = [
      {
        id: subscriptionId,
        teamId,
        plan: 'STARTER',
        status: SubscriptionStatus.ACTIVE,
        paidSeats: 1,
        graceEndsAt: null,
        failedAt: null,
        readOnlySince: null,
        version: 1,
      },
    ];

    // Charge due in the past
    mockCharges = [
      {
        id: chargeId,
        teamId,
        subscriptionId,
        kind: 'SUBSCRIPTION',
        status: 'PENDING',
        amountCents: 2000,
        currency: 'USD',
        dueAt: new Date(Date.now() - 3600 * 1000), // 1 hour overdue
        lineItems: [{ label: 'Starter plan', amountCents: 2000 }],
      },
    ];

    mockChargeAttempts = [
      {
        id: '018f3a2b-0000-7000-8000-000000000004',
        chargeId,
        attemptNo: 1,
        txRef: `${chargeId}-1`,
        method: 'CHECKOUT',
        status: 'PENDING',
        amountCents: 2000,
      },
    ];

    mockPaymentMethods = [
      {
        id: 'pm-1',
        teamId,
        providerTokenEncrypted: encryptCardToken('declining-card-token'),
        cardBrand: 'VISA',
        cardLast4: '0002', // Declining card
        expMonth: 12,
        expYear: 2028,
        disabledAt: null,
      },
    ];

    mockLedgerEntries = [];
    enqueuedJobs.length = 0;
    vi.clearAllMocks();
  });

  it('Exit Criteria 4 / FR-07 / FR-39 / FR-40: overdue scan marks charge FAILED, writes $0 PAYMENT_FAILED ledger, and starts 7-day grace', async () => {
    const sweepResult = await handleBillingOverdueScan();
    expect(sweepResult.overdueCount).toBe(1);

    // 1. Charge marked FAILED
    expect(mockCharges[0]?.status).toBe('FAILED');
    expect(mockCharges[0]?.failureCode).toBe('OVERDUE');

    // 2. PAYMENT_FAILED ledger entry with amount 0 (B-12, PRD 8.7)
    expect(mockLedgerEntries).toHaveLength(1);
    expect(mockLedgerEntries[0]?.type).toBe(LedgerEntryType.PAYMENT_FAILED);
    expect(mockLedgerEntries[0]?.amountCents).toBe(0);
    expect(mockLedgerEntries[0]?.idempotencyKey).toBe(`payment-failed:overdue:${chargeId}`);

    // 3. Subscription status transitions to PAST_DUE with graceEndsAt 7 days later (B-13)
    expect(mockSubscriptions[0]?.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(mockSubscriptions[0]?.graceEndsAt).toBeInstanceOf(Date);
    expect(mockSubscriptions[0]?.graceEndsAt?.getTime()).toBeGreaterThan(Date.now());

    // 4. Grace-step jobs queued for days 1, 3, 5, 7
    const graceJobs = enqueuedJobs.filter((j) => j.name === 'billing.grace-step');
    expect(graceJobs).toHaveLength(4);
    const steps = graceJobs.map((j) => (j.data as { step: number }).step);
    expect(steps).toEqual([1, 3, 5, 7]);
  });

  it('Exit Criteria 5 / FR-40 / B-11 / B-13: grace flow retries with declining card using new tx_ref, ending in READ_ONLY on day 7', async () => {
    // Put subscription into PAST_DUE
    const sub0 = mockSubscriptions[0];
    if (sub0) {
      sub0.status = SubscriptionStatus.PAST_DUE;
      sub0.failedAt = new Date();
      sub0.graceEndsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    }

    // Simulate Step 1 (Day 1 retry)
    const step1Result = await handleBillingGraceStep({
      subscriptionId,
      chargeId,
      step: 1,
    });
    expect(step1Result.action).toBe('retry');

    // Queued billing.charge
    const chargeJobs = enqueuedJobs.filter((j) => j.name === 'billing.charge');
    expect(chargeJobs).toHaveLength(1);

    // Simulate execution of billing.charge with declining card
    mockChargeTokenizedCard.mockResolvedValueOnce({
      success: false,
      data: { status: 'failed', message: 'Card declined' },
    });

    const chargeResult = await handleBillingCharge({ chargeId });
    expect(chargeResult.success).toBe(false);

    // New ChargeAttempt created with txRef = {chargeId}-2 (B-11)
    expect(mockChargeAttempts).toHaveLength(2);
    expect(mockChargeAttempts[1]?.attemptNo).toBe(2);
    expect(mockChargeAttempts[1]?.txRef).toBe(`${chargeId}-2`);
    expect(mockChargeAttempts[1]?.status).toBe('FAILED');
    expect(mockCharges[0]?.status).toBe('FAILED');

    // Simulate Step 3 (Day 3 retry)
    const step3Result = await handleBillingGraceStep({
      subscriptionId,
      chargeId,
      step: 3,
    });
    expect(step3Result.action).toBe('retry');

    // Simulate Step 5 (Day 5 retry)
    const step5Result = await handleBillingGraceStep({
      subscriptionId,
      chargeId,
      step: 5,
    });
    expect(step5Result.action).toBe('retry');

    // Simulate Step 7 (Day 7 grace expired unpaid)
    const step7Result = await handleBillingGraceStep({
      subscriptionId,
      chargeId,
      step: 7,
    });
    expect(step7Result.action).toBe('read_only');

    // Subscription transitioned to READ_ONLY (B-13, FR-40)
    expect(mockSubscriptions[0]?.status).toBe(SubscriptionStatus.READ_ONLY);
    expect(mockSubscriptions[0]?.readOnlySince).toBeDefined();

    // Verify team writes are blocked with 403 TEAM_READ_ONLY (B-14)
    await expect(checkTeamNotReadOnly(teamId)).rejects.toThrowError(
      expect.objectContaining({ code: 'TEAM_READ_ONLY', status: 403 }),
    );
  });
});
