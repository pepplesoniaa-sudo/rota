import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as checkoutRoute } from '../../../app/v1/teams/[teamId]/billing/charges/[chargeId]/checkout/route';
import { GET as listChargesRoute } from '../../../app/v1/teams/[teamId]/billing/charges/route';
import { GET as listLedgerRoute } from '../../../app/v1/teams/[teamId]/billing/ledger/route';
import { createAccessToken } from '../../../lib/auth/jwt';
import { LedgerEntryType } from '@prisma/client';

interface MockMembership {
  id: string;
  teamId: string;
  userId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'INACTIVE';
}

interface MockCharge {
  id: string;
  teamId: string;
  subscriptionId: string;
  kind: string;
  status: string;
  amountCents: number;
  currency: string;
  createdAt: Date;
  dueAt: Date;
  paidAt?: Date | null;
  lineItems: unknown;
}

interface MockChargeAttempt {
  id: string;
  chargeId: string;
  attemptNo: number;
  txRef: string;
  method: 'CHECKOUT' | 'TOKEN';
  status: string;
  amountCents: number;
  checkoutUrl?: string | null;
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
  createdAt: Date;
}

let mockMemberships: MockMembership[] = [];
let mockCharges: MockCharge[] = [];
let mockChargeAttempts: MockChargeAttempt[] = [];
let mockLedgerEntries: MockLedgerEntry[] = [];

vi.mock('../../../lib/redis', () => ({
  redis: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}));

vi.mock('../../../lib/billing/flutterwave/client', () => ({
  createHostedPaymentLink: vi.fn(async ({ txRef }: { txRef: string }) => {
    return { link: `https://checkout.flutterwave.com/pay/${txRef}` };
  }),
}));

vi.mock('../../../lib/db', () => {
  const db = {
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
    },
    charge: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = mockCharges.find((c) => c.id === where.id);
        if (!found) return null;
        const attempts = mockChargeAttempts
          .filter((a) => a.chargeId === found.id)
          .sort((a, b) => b.attemptNo - a.attemptNo);
        return {
          ...found,
          attempts,
          team: {
            id: found.teamId,
            name: 'Dental Care',
            owner: { email: 'owner@example.com' },
          },
        };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; teamId: string } }) => {
        const found = mockCharges.find((c) => c.id === where.id && c.teamId === where.teamId);
        if (!found) return null;
        const attempts = mockChargeAttempts
          .filter((a) => a.chargeId === found.id)
          .sort((a, b) => b.attemptNo - a.attemptNo);
        return {
          ...found,
          attempts,
          team: {
            id: found.teamId,
            name: 'Dental Care',
            owner: { email: 'owner@example.com' },
          },
        };
      }),
      findMany: vi.fn(async ({ where, take }: { where: { teamId: string }; take: number }) => {
        const results = mockCharges
          .filter((c) => c.teamId === where.teamId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take);
        return results.map((c) => ({
          ...c,
          attempts: mockChargeAttempts.filter((a) => a.chargeId === c.id),
        }));
      }),
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
    ledgerEntry: {
      findMany: vi.fn(async ({ where, take }: { where: { teamId: string }; take: number }) => {
        return mockLedgerEntries
          .filter((l) => l.teamId === where.teamId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take);
      }),
    },
  };

  return {
    dbShard0: db,
    dbShard1: db,
    getShardDbForTeam: vi.fn(async () => db),
    getShardIndexForTeam: vi.fn(async () => 0),
  };
});

describe('Phase 5: Hosted Checkout & Billing History (FR-34, FR-35, B-11, B-16)', () => {
  const teamId = '018f3a2b-0000-7000-8000-000000000001';
  const ownerUserId = '018f3a2b-0000-7000-8000-000000000002';
  const staffUserId = '018f3a2b-0000-7000-8000-000000000003';
  const chargeId = '018f3a2b-0000-7000-8000-000000000004';
  let ownerToken: string;
  let staffToken: string;

  beforeEach(async () => {
    ownerToken = await createAccessToken(ownerUserId);
    staffToken = await createAccessToken(staffUserId);

    mockMemberships = [
      { id: 'm-1', teamId, userId: ownerUserId, role: 'OWNER', status: 'ACTIVE' },
      { id: 'm-2', teamId, userId: staffUserId, role: 'STAFF', status: 'ACTIVE' },
    ];

    mockCharges = [
      {
        id: chargeId,
        teamId,
        subscriptionId: 'sub-1',
        kind: 'SUBSCRIPTION',
        status: 'PENDING',
        amountCents: 2000,
        currency: 'USD',
        createdAt: new Date(),
        dueAt: new Date(),
        lineItems: [{ label: 'Starter plan', amountCents: 2000 }],
      },
    ];

    mockChargeAttempts = [];
    mockLedgerEntries = [];
    vi.clearAllMocks();
  });

  it('B-16: non-owner receives 403 FORBIDDEN on checkout endpoint', async () => {
    const req = new NextRequest(
      `http://localhost:3000/v1/teams/${teamId}/billing/charges/${chargeId}/checkout`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${staffToken}` },
      },
    );
    const res = await checkoutRoute(req, { params: Promise.resolve({ teamId, chargeId }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('FR-35 / B-11: creates initial ChargeAttempt with txRef = {chargeId}-1 and returns payment link', async () => {
    const req = new NextRequest(
      `http://localhost:3000/v1/teams/${teamId}/billing/charges/${chargeId}/checkout`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
      },
    );

    const res = await checkoutRoute(req, { params: Promise.resolve({ teamId, chargeId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.checkoutUrl).toBe(`https://checkout.flutterwave.com/pay/${chargeId}-1`);
    expect(body.txRef).toBe(`${chargeId}-1`);

    expect(mockChargeAttempts).toHaveLength(1);
    expect(mockChargeAttempts[0].attemptNo).toBe(1);
    expect(mockChargeAttempts[0].txRef).toBe(`${chargeId}-1`);
    expect(mockChargeAttempts[0].method).toBe('CHECKOUT');
    expect(mockChargeAttempts[0].amountCents).toBe(2000);
  });

  it('B-11: subsequent checkout creates new ChargeAttempt with incremented attemptNo', async () => {
    // Attempt 1 already exists
    mockChargeAttempts.push({
      id: 'att-1',
      chargeId,
      attemptNo: 1,
      txRef: `${chargeId}-1`,
      method: 'CHECKOUT',
      status: 'PENDING',
      amountCents: 2000,
    });

    const req = new NextRequest(
      `http://localhost:3000/v1/teams/${teamId}/billing/charges/${chargeId}/checkout`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
      },
    );

    const res = await checkoutRoute(req, { params: Promise.resolve({ teamId, chargeId }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.txRef).toBe(`${chargeId}-2`);
    expect(body.checkoutUrl).toBe(`https://checkout.flutterwave.com/pay/${chargeId}-2`);

    expect(mockChargeAttempts).toHaveLength(2);
    expect(mockChargeAttempts[1].attemptNo).toBe(2);
    expect(mockChargeAttempts[1].txRef).toBe(`${chargeId}-2`);
  });

  it('B-11: checkout on already PAID charge returns 400 VALIDATION_FAILED', async () => {
    mockCharges[0].status = 'PAID';

    const req = new NextRequest(
      `http://localhost:3000/v1/teams/${teamId}/billing/charges/${chargeId}/checkout`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${ownerToken}` },
      },
    );

    const res = await checkoutRoute(req, { params: Promise.resolve({ teamId, chargeId }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('FR-34: owner lists charges and ledger entries with cursor pagination', async () => {
    // Populate ledger entries
    mockLedgerEntries.push({
      id: 'led-1',
      teamId,
      chargeId,
      type: LedgerEntryType.CHARGE_SUBSCRIPTION,
      amountCents: 2000,
      currency: 'USD',
      idempotencyKey: `charge:${chargeId}`,
      description: 'Starter plan',
      occurredAt: new Date(),
      createdAt: new Date(),
    });

    // 1. List charges
    const reqCharges = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/billing/charges`, {
      method: 'GET',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const resCharges = await listChargesRoute(reqCharges, { params: Promise.resolve({ teamId }) });
    expect(resCharges.status).toBe(200);
    const chargesBody = await resCharges.json();
    expect(chargesBody.items).toHaveLength(1);
    expect(chargesBody.items[0].id).toBe(chargeId);

    // 2. List ledger
    const reqLedger = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/billing/ledger`, {
      method: 'GET',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const resLedger = await listLedgerRoute(reqLedger, { params: Promise.resolve({ teamId }) });
    expect(resLedger.status).toBe(200);
    const ledgerBody = await resLedger.json();
    expect(ledgerBody.items).toHaveLength(1);
    expect(ledgerBody.items[0].type).toBe('CHARGE_SUBSCRIPTION');
    expect(ledgerBody.items[0].amountCents).toBe(2000);
  });
});
