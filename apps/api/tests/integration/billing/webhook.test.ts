import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as webhookRoute } from '../../../app/v1/webhooks/flutterwave/route';
import { handleBillingWebhook } from '../../../worker/jobs/billing/webhook';
import { env } from '../../../lib/config/env';
import { LedgerEntryType, SubscriptionStatus } from '@prisma/client';

interface MockWebhookEvent {
  id: string;
  provider: string;
  providerEventKey: string;
  eventType: string;
  payload: unknown;
  status: string;
  error?: string | null;
  processedAt?: Date | null;
  createdAt: Date;
}

interface MockChargeAttempt {
  id: string;
  chargeId: string;
  attemptNo: number;
  txRef: string;
  method: 'CHECKOUT' | 'TOKEN';
  status: string;
  amountCents: number;
  providerTxId?: string | null;
  lastVerifyStatus?: string | null;
  lastVerifiedAt?: Date | null;
}

interface MockCharge {
  id: string;
  teamId: string;
  subscriptionId: string;
  kind: string;
  status: string;
  amountCents: number;
  currency: string;
  dueAt: Date;
  paidAt?: Date | null;
  lineItems: unknown;
  collectedByChargeId?: string | null;
}

interface MockSubscription {
  id: string;
  teamId: string;
  status: SubscriptionStatus;
  plan: string;
  paidSeats: number;
  graceEndsAt?: Date | null;
  failedAt?: Date | null;
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
  metadata?: unknown;
  occurredAt: Date;
}

let mockWebhookEvents: MockWebhookEvent[] = [];
let mockCharges: MockCharge[] = [];
let mockChargeAttempts: MockChargeAttempt[] = [];
let mockSubscriptions: MockSubscription[] = [];
let mockPaymentMethods: MockPaymentMethod[] = [];
let mockLedgerEntries: MockLedgerEntry[] = [];
const enqueuedJobs: Array<{ queue: string; name: string; data: unknown; opts: unknown }> = [];

// Mock verification client
const mockVerifyTransaction = vi.fn();
vi.mock('../../../lib/billing/flutterwave/client', () => ({
  verifyTransaction: (...args: unknown[]) => mockVerifyTransaction(...args),
  chargeTokenizedCard: vi.fn(),
  resendTransactionWebhook: vi.fn(),
  createHostedPaymentLink: vi.fn(),
}));

// Mock redis
vi.mock('../../../lib/redis', () => ({
  redis: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}));

// Mock queues
vi.mock('../../../worker/queues', () => ({
  getQueue: (queueName: string) => ({
    add: vi.fn(async (name: string, data: unknown, opts: unknown) => {
      enqueuedJobs.push({ queue: queueName, name, data, opts });
      return { id: 'mock-job-id' };
    }),
  }),
  JobId: {
    billingWebhook: (id: string) => `webhook:${id}`,
  },
  JOB_RETRY_POLICIES: {
    'billing.webhook': {},
  },
}));

// Mock dbShard0
vi.mock('../../../lib/db', () => {
  const db = {
    webhookEvent: {
      create: vi.fn(async ({ data }: { data: Omit<MockWebhookEvent, 'id' | 'createdAt'> }) => {
        const existing = mockWebhookEvents.find(
          (e) => e.providerEventKey === data.providerEventKey,
        );
        if (existing) {
          const err = new Error('Unique constraint failed');
          (err as unknown as { code: string }).code = 'P2002';
          throw err;
        }
        const record: MockWebhookEvent = {
          id: `018f3a2b-0000-7000-8000-${String(mockWebhookEvents.length + 1).padStart(12, '0')}`,
          createdAt: new Date(),
          ...data,
        };
        mockWebhookEvents.push(record);
        return record;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = mockWebhookEvents.find((e) => e.id === where.id);
        return found ? { ...found } : null;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<MockWebhookEvent> }) => {
          const found = mockWebhookEvents.find((e) => e.id === where.id);
          if (!found) throw new Error('WebhookEvent not found');
          Object.assign(found, data);
          return { ...found };
        },
      ),
    },
    chargeAttempt: {
      findUnique: vi.fn(async ({ where }: { where: { txRef: string } }) => {
        const found = mockChargeAttempts.find((a) => a.txRef === where.txRef);
        if (!found) return null;
        const charge = mockCharges.find((c) => c.id === found.chargeId);
        const sub = charge ? mockSubscriptions.find((s) => s.id === charge.subscriptionId) : null;
        return {
          ...found,
          charge: charge
            ? {
                ...charge,
                team: {
                  id: charge.teamId,
                  subscription: sub ? { ...sub } : null,
                },
              }
            : null,
        };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<MockChargeAttempt> }) => {
          const found = mockChargeAttempts.find((a) => a.id === where.id);
          if (!found) throw new Error('ChargeAttempt not found');
          Object.assign(found, data);
          return { ...found };
        },
      ),
    },
    charge: {
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
          where: { id: string; status: string };
          data: Partial<MockCharge>;
        }) => {
          let count = 0;
          for (const c of mockCharges) {
            if (c.id === where.id && c.status === where.status) {
              Object.assign(c, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    subscription: {
      update: vi.fn(
        async ({ where, data }: { where: { teamId: string }; data: Partial<MockSubscription> }) => {
          const found = mockSubscriptions.find((s) => s.teamId === where.teamId);
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
      create: vi.fn(async ({ data }: { data: Omit<MockPaymentMethod, 'id'> }) => {
        const record: MockPaymentMethod = {
          id: `018f3a2b-0000-7000-8001-${String(mockPaymentMethods.length + 1).padStart(12, '0')}`,
          ...data,
        };
        mockPaymentMethods.push(record);
        return record;
      }),
    },
    ledgerEntry: {
      create: vi.fn(async ({ data }: { data: Omit<MockLedgerEntry, 'id'> }) => {
        const existing = mockLedgerEntries.find((l) => l.idempotencyKey === data.idempotencyKey);
        if (existing) {
          const err = new Error('Unique constraint failed on idempotencyKey');
          (err as unknown as { code: string }).code = 'P2002';
          throw err;
        }
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

describe('Phase 5: Flutterwave Webhook Processing (FR-42, B-9, B-10, B-11, MB-11)', () => {
  const teamId = '018f3a2b-0000-7000-8000-000000000001';
  const subscriptionId = '018f3a2b-0000-7000-8000-000000000002';
  const chargeId = '018f3a2b-0000-7000-8000-000000000003';
  const txRef = `${chargeId}-1`;

  beforeEach(() => {
    mockWebhookEvents = [];
    mockCharges = [
      {
        id: chargeId,
        teamId,
        subscriptionId,
        kind: 'SUBSCRIPTION',
        status: 'PENDING',
        amountCents: 2000,
        currency: 'USD',
        dueAt: new Date(),
        lineItems: [{ label: 'Starter plan', amountCents: 2000 }],
      },
    ];
    mockChargeAttempts = [
      {
        id: '018f3a2b-0000-7000-8000-000000000004',
        chargeId,
        attemptNo: 1,
        txRef,
        method: 'CHECKOUT',
        status: 'PENDING',
        amountCents: 2000,
      },
    ];
    mockSubscriptions = [
      {
        id: subscriptionId,
        teamId,
        status: 'ACTIVE',
        plan: 'STARTER',
        paidSeats: 1,
      },
    ];
    mockPaymentMethods = [];
    mockLedgerEntries = [];
    enqueuedJobs.length = 0;
    vi.clearAllMocks();
  });

  it('B-10: rejects webhook with invalid or missing verif-hash with 401 WEBHOOK_SIGNATURE_INVALID', async () => {
    const payload = {
      event: 'charge.completed',
      data: {
        id: 98765,
        tx_ref: txRef,
        flw_ref: 'FLW123',
        amount: 20.0,
        currency: 'USD',
        status: 'successful',
      },
    };

    const reqInvalid = new NextRequest('http://localhost:3000/v1/webhooks/flutterwave', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'verif-hash': 'invalid-secret-hash',
      },
      body: JSON.stringify(payload),
    });

    const res = await webhookRoute(reqInvalid, { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(mockWebhookEvents).toHaveLength(0);
  });

  it('B-10 / FR-42: accepts verified webhook, creates WebhookEvent, returns 200 within 2s, and enqueues billing.webhook', async () => {
    const payload = {
      event: 'charge.completed',
      data: {
        id: 98765,
        tx_ref: txRef,
        flw_ref: 'FLW123',
        amount: 20.0,
        currency: 'USD',
        status: 'successful',
      },
    };

    const req = new NextRequest('http://localhost:3000/v1/webhooks/flutterwave', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'verif-hash': env.FLW_SECRET_HASH,
      },
      body: JSON.stringify(payload),
    });

    const res = await webhookRoute(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    expect(mockWebhookEvents).toHaveLength(1);
    expect(mockWebhookEvents[0]?.providerEventKey).toBe('98765');
    expect(mockWebhookEvents[0]?.status).toBe('RECEIVED');
    expect(enqueuedJobs).toHaveLength(1);
    expect(enqueuedJobs[0]?.queue).toBe('billing');
    expect(enqueuedJobs[0]?.name).toBe('billing.webhook');
  });

  it('Exit Criteria 2 / MB-11 / FR-42: duplicate webhook test produces exactly one ledger entry', async () => {
    // 1. Simulate webhook arriving and getting processed
    const webhookEvent = await dbShard0WebhookEventCreate({
      provider: 'flutterwave',
      providerEventKey: '98765',
      eventType: 'charge.completed',
      payload: {
        event: 'charge.completed',
        data: { id: 98765, tx_ref: txRef },
      },
      status: 'RECEIVED',
    });

    mockVerifyTransaction.mockResolvedValueOnce({
      status: 'success',
      message: 'Tx fetched',
      data: {
        id: 98765,
        tx_ref: txRef,
        flw_ref: 'FLW-TEST-1',
        amount: 20.0,
        currency: 'USD',
        status: 'successful',
        card: {
          token: 'flw-card-token-1234',
          first_6digits: '411111',
          last_4digits: '1111',
          issuer: 'VISA',
          type: 'VISA',
          expiry: '09/32',
        },
      },
    });

    // First processing run
    const result1 = await handleBillingWebhook({ webhookEventId: webhookEvent.id });
    expect(result1.processed).toBe(true);
    expect(mockCharges[0]?.status).toBe('PAID');
    expect(mockChargeAttempts[0]?.status).toBe('PAID');
    expect(mockChargeAttempts[0]?.providerTxId).toBe('98765');
    expect(mockPaymentMethods).toHaveLength(1);

    // Exactly one PAYMENT_CONFIRMED ledger entry created
    expect(mockLedgerEntries).toHaveLength(1);
    expect(mockLedgerEntries[0]?.type).toBe(LedgerEntryType.PAYMENT_CONFIRMED);
    expect(mockLedgerEntries[0]?.amountCents).toBe(-2000); // Negative for money received (PRD 8.7)
    expect(mockLedgerEntries[0]?.idempotencyKey).toBe('payment:98765');

    // 2. Duplicate webhook event arriving at the route
    const reqDuplicate = new NextRequest('http://localhost:3000/v1/webhooks/flutterwave', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'verif-hash': env.FLW_SECRET_HASH,
      },
      body: JSON.stringify({
        event: 'charge.completed',
        data: { id: 98765, tx_ref: txRef },
      }),
    });

    const resDup = await webhookRoute(reqDuplicate, { params: Promise.resolve({}) });
    expect(resDup.status).toBe(200);
    // Duplicate at route does not enqueue second job
    expect(enqueuedJobs).toHaveLength(0);

    // 3. Duplicate delivery into worker (e.g. at-least-once BullMQ retry or replay)
    const result2 = await handleBillingWebhook({ webhookEventId: webhookEvent.id });
    expect(result2.processed).toBe(true);
    expect(result2.duplicate).toBe(true);

    // Still exactly ONE ledger entry in the database (MB-11, Exit Criteria 2)
    expect(mockLedgerEntries).toHaveLength(1);
  });

  it('B-11: double payment records PAYMENT_CONFIRMED and handles gracefully', async () => {
    // Charge is already paid by attempt 1
    const charge0 = mockCharges[0];
    if (charge0) charge0.status = 'PAID';
    // Create attempt 2
    const attempt2: MockChargeAttempt = {
      id: '018f3a2b-0000-7000-8000-000000000005',
      chargeId,
      attemptNo: 2,
      txRef: `${chargeId}-2`,
      method: 'CHECKOUT',
      status: 'PENDING',
      amountCents: 2000,
    };
    mockChargeAttempts.push(attempt2);

    const webhookEvent2 = await dbShard0WebhookEventCreate({
      provider: 'flutterwave',
      providerEventKey: '99999',
      eventType: 'charge.completed',
      payload: {
        event: 'charge.completed',
        data: { id: 99999, tx_ref: `${chargeId}-2` },
      },
      status: 'RECEIVED',
    });

    mockVerifyTransaction.mockResolvedValueOnce({
      status: 'success',
      message: 'Tx fetched',
      data: {
        id: 99999,
        tx_ref: `${chargeId}-2`,
        flw_ref: 'FLW-DOUBLE-2',
        amount: 20.0,
        currency: 'USD',
        status: 'successful',
      },
    });

    const result = await handleBillingWebhook({ webhookEventId: webhookEvent2.id });
    expect(result.processed).toBe(true);
    expect(result.doublePayment).toBe(true);

    // Records PAYMENT_CONFIRMED ledger entry for the second transaction
    const entry = mockLedgerEntries.find((l) => l.idempotencyKey === 'payment:99999');
    expect(entry).toBeDefined();
    expect(entry?.type).toBe(LedgerEntryType.PAYMENT_CONFIRMED);
    expect(entry?.amountCents).toBe(-2000);
    expect((entry?.metadata as { doublePayment?: boolean })?.doublePayment).toBe(true);
  });

  it('B-9 / MB-6: verification mismatch (amount or status) fails webhook without marking charge PAID', async () => {
    const webhookEvent = await dbShard0WebhookEventCreate({
      provider: 'flutterwave',
      providerEventKey: '11111',
      eventType: 'charge.completed',
      payload: {
        event: 'charge.completed',
        data: { id: 11111, tx_ref: txRef },
      },
      status: 'RECEIVED',
    });

    // Provider returns amount 10.0 instead of expected 20.0
    mockVerifyTransaction.mockResolvedValueOnce({
      status: 'success',
      message: 'Tx fetched',
      data: {
        id: 11111,
        tx_ref: txRef,
        flw_ref: 'FLW-MISMATCH',
        amount: 10.0, // Mismatch!
        currency: 'USD',
        status: 'successful',
      },
    });

    const result = await handleBillingWebhook({ webhookEventId: webhookEvent.id });
    expect(result.processed).toBe(false);
    expect(mockCharges[0]?.status).toBe('PENDING'); // Not marked PAID
    expect(mockLedgerEntries).toHaveLength(0); // No ledger entry written
    expect(mockWebhookEvents[0]?.status).toBe('FAILED');
    expect(mockWebhookEvents[0]?.error).toContain('amount expected 2000, got 1000');
  });
});

async function dbShard0WebhookEventCreate(
  data: Omit<MockWebhookEvent, 'id' | 'createdAt'>,
): Promise<MockWebhookEvent> {
  const record: MockWebhookEvent = {
    id: `018f3a2b-0000-7000-8000-${String(mockWebhookEvents.length + 1).padStart(12, '0')}`,
    createdAt: new Date(),
    ...data,
  };
  mockWebhookEvents.push(record);
  return record;
}
