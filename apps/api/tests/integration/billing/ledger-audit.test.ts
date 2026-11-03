import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createLedgerEntry } from '../../../lib/billing/ledger';
import { LedgerEntryType } from '@prisma/client';

describe('Phase 5: Append-Only Ledger & Immutability Rules (Exit Criteria 3 / B-12, MB-1, MB-3, MB-9)', () => {
  it('Exit Criteria 3 / B-12: SQL constraints define append-only triggers and revoke UPDATE, DELETE, TRUNCATE from rota_app', () => {
    const rootDir = process.cwd();
    const sqlPath = path.join(rootDir, 'apps/api/prisma/sql/01_constraints.sql');
    expect(fs.existsSync(sqlPath)).toBe(true);

    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // 1. Verify trigger function exists and raises exception
    expect(sqlContent).toContain('CREATE OR REPLACE FUNCTION ledger_append_only()');
    expect(sqlContent).toContain("RAISE EXCEPTION 'ledger_entry is append-only'");

    // 2. Verify BEFORE UPDATE OR DELETE trigger
    expect(sqlContent).toContain('CREATE TRIGGER ledger_no_update_delete');
    expect(sqlContent).toContain('BEFORE UPDATE OR DELETE ON ledger_entry');
    expect(sqlContent).toContain('EXECUTE FUNCTION ledger_append_only()');

    // 3. Verify BEFORE TRUNCATE trigger
    expect(sqlContent).toContain('CREATE TRIGGER ledger_no_truncate');
    expect(sqlContent).toContain('BEFORE TRUNCATE ON ledger_entry');
    expect(sqlContent).toContain('EXECUTE FUNCTION ledger_append_only()');

    // 4. Verify rota_app permissions: REVOKE UPDATE, DELETE, TRUNCATE; GRANT SELECT, INSERT only
    expect(sqlContent).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entry FROM rota_app;');
    expect(sqlContent).toContain('GRANT SELECT, INSERT ON ledger_entry TO rota_app;');
  });

  it('MB-3: rejects non-safe integer amounts in createLedgerEntry', async () => {
    const mockTx = {
      ledgerEntry: {
        create: async () => ({ id: 'mock-id' }),
      },
    };

    // Fractional float
    await expect(
      createLedgerEntry(mockTx, {
        teamId: '018f3a2b-0000-7000-8000-000000000001',
        type: LedgerEntryType.CHARGE_SUBSCRIPTION,
        amountCents: 2000.5,
        idempotencyKey: 'charge:mock-1',
        description: 'Starter plan',
      }),
    ).rejects.toThrow('Amount in cents must be a safe integer');

    // NaN
    await expect(
      createLedgerEntry(mockTx, {
        teamId: '018f3a2b-0000-7000-8000-000000000001',
        type: LedgerEntryType.CHARGE_SUBSCRIPTION,
        amountCents: NaN,
        idempotencyKey: 'charge:mock-2',
        description: 'Starter plan',
      }),
    ).rejects.toThrow('Amount in cents must be a safe integer');

    // Infinity
    await expect(
      createLedgerEntry(mockTx, {
        teamId: '018f3a2b-0000-7000-8000-000000000001',
        type: LedgerEntryType.CHARGE_SUBSCRIPTION,
        amountCents: Infinity,
        idempotencyKey: 'charge:mock-3',
        description: 'Starter plan',
      }),
    ).rejects.toThrow('Amount in cents must be a safe integer');
  });

  it('MB-9 / PRD 8.7: createLedgerEntry inserts valid records with proper signs and idempotency keys', async () => {
    const createdEntries: Array<Record<string, unknown>> = [];
    const mockTx = {
      ledgerEntry: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdEntries.push(data);
          return { id: `entry-${createdEntries.length}`, ...data };
        },
      },
    };

    const teamId = '018f3a2b-0000-7000-8000-000000000001';
    const chargeId = '018f3a2b-0000-7000-8000-000000000002';

    // 1. Subscription charge (positive cents)
    await createLedgerEntry(mockTx, {
      teamId,
      chargeId,
      type: LedgerEntryType.CHARGE_SUBSCRIPTION,
      amountCents: 2000,
      currency: 'USD',
      idempotencyKey: `charge:${chargeId}`,
      description: 'Starter plan renewal',
    });

    // 2. Confirmed payment (negative cents)
    await createLedgerEntry(mockTx, {
      teamId,
      chargeId,
      type: LedgerEntryType.PAYMENT_CONFIRMED,
      amountCents: -2000,
      currency: 'USD',
      idempotencyKey: 'payment:flw-tx-12345',
      description: 'Payment confirmed',
    });

    // 3. Failed payment (0 cents)
    await createLedgerEntry(mockTx, {
      teamId,
      chargeId,
      type: LedgerEntryType.PAYMENT_FAILED,
      amountCents: 0,
      currency: 'USD',
      idempotencyKey: `failed:${chargeId}:1`,
      description: 'Card declined',
    });

    // 4. Correction via REVERSAL
    await createLedgerEntry(mockTx, {
      teamId,
      chargeId,
      type: LedgerEntryType.REVERSAL,
      amountCents: -2000, // Reverses positive charge
      currency: 'USD',
      reversesEntryId: 'entry-1',
      idempotencyKey: 'reversal:entry-1',
      description: 'Reversing erroneous charge',
    });

    expect(createdEntries).toHaveLength(4);
    expect(createdEntries[0]?.amountCents).toBe(2000);
    expect(createdEntries[0]?.idempotencyKey).toBe(`charge:${chargeId}`);
    expect(createdEntries[1]?.amountCents).toBe(-2000);
    expect(createdEntries[1]?.idempotencyKey).toBe('payment:flw-tx-12345');
    expect(createdEntries[2]?.amountCents).toBe(0);
    expect(createdEntries[3]?.type).toBe(LedgerEntryType.REVERSAL);
    expect(createdEntries[3]?.reversesEntryId).toBe('entry-1');
  });
});
