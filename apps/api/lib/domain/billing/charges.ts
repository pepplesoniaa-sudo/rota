import { dbShard0 } from '../../db';
import { CursorQuery } from '@rota/shared';

interface DecodedCursor {
  t: string;
  id: string;
}

function decodeCursor(cursor?: string): DecodedCursor | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { t?: string; id?: string };
    if (parsed.t && parsed.id) {
      return { t: parsed.t, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  const payload = {
    t: createdAt.toISOString(),
    id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Lists charges for team, newest first with cursor pagination (PRD 7.2 / FR-34).
 */
export async function listCharges(teamId: string, query: CursorQuery) {
  const limit = query.limit ?? 20;
  const decoded = decodeCursor(query.cursor);

  const whereClause: {
    teamId: string;
    OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
  } = {
    teamId,
  };

  if (decoded) {
    const cursorDate = new Date(decoded.t);
    whereClause.OR = [
      { createdAt: { lt: cursorDate } },
      { createdAt: cursorDate, id: { lt: decoded.id } },
    ];
  }

  const rawRows = await dbShard0.charge.findMany({
    where: whereClause,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      attempts: {
        select: {
          id: true,
          attemptNo: true,
          status: true,
          txRef: true,
          createdAt: true,
        },
        orderBy: { attemptNo: 'desc' },
      },
    },
  });

  const hasMore = rawRows.length > limit;
  const items = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

  return {
    items: items.map((c) => ({
      id: c.id,
      amountCents: c.amountCents,
      currency: c.currency,
      status: c.status,
      lineItems: c.lineItems,
      dueAt: c.dueAt.toISOString(),
      paidAt: c.paidAt ? c.paidAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      attemptsCount: c.attempts.length,
      lastAttempt: c.attempts[0]
        ? {
            attemptNo: c.attempts[0].attemptNo,
            status: c.attempts[0].status,
            txRef: c.attempts[0].txRef,
          }
        : null,
    })),
    nextCursor,
  };
}

/**
 * Lists ledger entries for team, newest first with cursor pagination (PRD 7.2 / FR-41).
 */
export async function listLedger(teamId: string, query: CursorQuery) {
  const limit = query.limit ?? 20;
  const decoded = decodeCursor(query.cursor);

  const whereClause: {
    teamId: string;
    OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
  } = {
    teamId,
  };

  if (decoded) {
    const cursorDate = new Date(decoded.t);
    whereClause.OR = [
      { createdAt: { lt: cursorDate } },
      { createdAt: cursorDate, id: { lt: decoded.id } },
    ];
  }

  const rawRows = await dbShard0.ledgerEntry.findMany({
    where: whereClause,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rawRows.length > limit;
  const items = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? encodeCursor(lastItem.createdAt, lastItem.id) : null;

  return {
    items: items.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amountCents: entry.amountCents,
      currency: entry.currency,
      description: entry.description,
      reversesEntryId: entry.reversesEntryId,
      occurredAt: entry.occurredAt.toISOString(),
      createdAt: entry.createdAt.toISOString(),
    })),
    nextCursor,
  };
}
