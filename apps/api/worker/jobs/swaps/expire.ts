import { z } from 'zod';
import { dbShard0, dbShard1 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { writeOutbox, dispatchOutboxEntry } from '../../../lib/outbox/writer';
import { SwapStatus } from '@prisma/client';

export const swapsExpireJobSchema = z
  .object({
    swapId: z.string().uuid().optional(),
  })
  .strict()
  .default({});

export type SwapsExpireJobData = z.infer<typeof swapsExpireJobSchema>;

/**
 * Worker handler for swaps.expire (PRD 6.2, FR-25).
 * Repeatable every 5 minutes: sweeps open swaps with expiresAt passed and transitions to EXPIRED.
 * Runs in system tenant scope (B-20).
 */
export async function handleSwapsExpire(data: unknown = {}): Promise<{ expiredCount: number }> {
  const parsed = swapsExpireJobSchema.parse(data ?? {});
  const jobId = parsed.swapId ? `swap-expire:${parsed.swapId}` : `swap-expire:sweep:${Date.now()}`;

  return runInSystemScope(jobId, async () => {
    const now = new Date();
    let totalExpired = 0;

    const shards = [
      { name: 's0', client: dbShard0 },
      { name: 's1', client: dbShard1 },
    ];

    for (const shard of shards) {
      const whereClause = parsed.swapId
        ? {
            id: parsed.swapId,
            status: { in: [SwapStatus.PENDING_PEER, SwapStatus.PENDING_MANAGER] },
            expiresAt: { lte: now },
          }
        : {
            status: { in: [SwapStatus.PENDING_PEER, SwapStatus.PENDING_MANAGER] },
            expiresAt: { lte: now },
          };

      const expiredSwaps = await shard.client.swapRequest.findMany({
        where: whereClause,
        take: 100,
      });

      for (const swap of expiredSwaps) {
        try {
          const outboxEntry = await shard.client.$transaction(async (tx) => {
            const current = await tx.swapRequest.findUnique({
              where: { id: swap.id },
            });

            if (
              !current ||
              (current.status !== SwapStatus.PENDING_PEER &&
                current.status !== SwapStatus.PENDING_MANAGER)
            ) {
              return null;
            }

            // 1. Update swap to EXPIRED
            await tx.swapRequest.update({
              where: { id: swap.id },
              data: {
                status: SwapStatus.EXPIRED,
                version: { increment: 1 },
              },
            });

            // 2. Write Outbox row for notify.fanout (A-5, DB-12)
            const entry = await writeOutbox(tx, {
              kind: 'notify.fanout',
              sourceKey: `swap:${swap.id}:EXPIRED`,
              teamId: swap.teamId,
              payload: {
                sourceKey: `swap:${swap.id}:EXPIRED`,
                teamId: swap.teamId,
                type: 'SWAP_EXPIRED',
              },
            });

            return entry;
          });

          if (outboxEntry) {
            totalExpired++;
            await dispatchOutboxEntry(outboxEntry);
            logger.info({ swapId: swap.id }, 'Expired open swap past expiresAt (FR-25)');
          }
        } catch (err) {
          logger.error({ err, swapId: swap.id }, 'Failed to expire swap request');
        }
      }
    }

    return { expiredCount: totalExpired };
  });
}
