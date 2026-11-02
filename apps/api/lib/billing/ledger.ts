import { LedgerEntryType, Prisma } from '@prisma/client';

export type TxWithLedger = {
  ledgerEntry: {
    create: (args: Prisma.LedgerEntryCreateArgs) => Promise<unknown>;
  };
};

export interface CreateLedgerEntryParams {
  teamId: string;
  chargeId?: string | null;
  type: LedgerEntryType;
  amountCents: number;
  currency?: string;
  idempotencyKey: string;
  reversesEntryId?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * MB-1: Ledger rows come from one function in ledger.ts.
 * MB-3: Safe integer validation on every cents value.
 * MB-9: Deterministic idempotencyKey per PRD 8.7 & decisions.md.
 */
export async function createLedgerEntry(
  tx: Prisma.TransactionClient | TxWithLedger,
  params: CreateLedgerEntryParams,
) {
  if (!Number.isSafeInteger(params.amountCents)) {
    throw new Error('Amount in cents must be a safe integer');
  }

  return tx.ledgerEntry.create({
    data: {
      teamId: params.teamId,
      chargeId: params.chargeId ?? null,
      type: params.type,
      amountCents: params.amountCents,
      currency: params.currency ?? 'USD',
      idempotencyKey: params.idempotencyKey,
      reversesEntryId: params.reversesEntryId ?? null,
      description: params.description,
      metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
      occurredAt: params.occurredAt ?? new Date(),
    },
  });
}
