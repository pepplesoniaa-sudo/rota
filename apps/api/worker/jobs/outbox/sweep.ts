import { z } from 'zod';
import { dbShard0, dbShard1 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { dispatchOutboxEntry, OutboxEntry } from '../../../lib/outbox/writer';
import { runInSystemScope } from '../../../lib/data/scope';

/**
 * Strict schema for outbox.sweep job data per UP-7 / SEC-5.
 */
export const outboxSweepDataSchema = z
  .object({
    database: z.enum(['s0', 's1']).default('s0'),
  })
  .strict();

export type OutboxSweepData = z.infer<typeof outboxSweepDataSchema>;

/**
 * Sweeps unprocessed Outbox rows older than 30 seconds for a specific database shard.
 * PRD 6.2: outbox.sweep runs every 60s on each database.
 */
export async function sweepOutboxDatabase(database: 's0' | 's1'): Promise<number> {
  const client = database === 's1' ? dbShard1 : dbShard0;
  const cutoff = new Date(Date.now() - 30_000);

  const pendingRows = await client.outbox.findMany({
    where: {
      processedAt: null,
      createdAt: { lte: cutoff },
    },
    take: 100,
    orderBy: { createdAt: 'asc' },
  });

  if (pendingRows.length === 0) {
    return 0;
  }

  logger.info(
    { database, count: pendingRows.length },
    'Sweeping pending outbox rows older than 30s',
  );

  for (const row of pendingRows) {
    await dispatchOutboxEntry(row as OutboxEntry);
  }

  return pendingRows.length;
}

/**
 * Worker job handler for outbox.sweep.
 * Runs in system tenant scope (B-20).
 */
export async function handleOutboxSweep(data: unknown): Promise<{ swept: number }> {
  const parsed = outboxSweepDataSchema.parse(data ?? {});
  const nowMinute = new Date().toISOString().slice(0, 16);
  const jobId = `outbox-sweep:${parsed.database}:${nowMinute}`;

  return runInSystemScope(jobId, async () => {
    const swept = await sweepOutboxDatabase(parsed.database);
    return { swept };
  });
}
