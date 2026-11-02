import { Prisma } from '@prisma/client';
import { logger } from '../log';
import { getQueue, JOB_RETRY_POLICIES, JobId, JobName, QueueName } from '../../worker/queues';
import { validateOutboxPayload } from './schemas';

export interface WriteOutboxParams {
  kind: JobName;
  sourceKey: string;
  payload: unknown;
  teamId?: string;
}

export interface OutboxEntry {
  id: string;
  teamId: string | null;
  sourceKey: string;
  kind: string;
  payload: unknown;
  createdAt: Date;
  processedAt: Date | null;
}

export type TxWithOutbox = {
  outbox: {
    create: (args: Prisma.OutboxCreateArgs) => Promise<unknown>;
    updateMany?: (args: Prisma.OutboxUpdateManyArgs) => Promise<unknown>;
  };
};

/**
 * Writes an Outbox row in the current transaction.
 * A-5 / A-6 / DB-12: Must run in the same transaction as state changes.
 * NEVER call queue.add inside the transaction callback.
 */
export async function writeOutbox(
  tx: Prisma.TransactionClient | TxWithOutbox,
  params: WriteOutboxParams,
): Promise<OutboxEntry> {
  const validatedPayload = validateOutboxPayload(params.kind, params.payload);

  const entry = (await tx.outbox.create({
    data: {
      kind: params.kind,
      sourceKey: params.sourceKey,
      payload: validatedPayload as Prisma.InputJsonValue,
      teamId: params.teamId,
    },
  })) as OutboxEntry;

  return entry;
}

/**
 * Maps outbox kind to target queue name.
 */
export function getQueueForKind(kind: string): QueueName {
  if (kind.startsWith('feed.')) return 'feed';
  if (kind.startsWith('notify.')) return 'notify';
  if (kind.startsWith('email.')) return 'email';
  if (kind.startsWith('swaps.')) return 'swaps';
  if (kind.startsWith('billing.')) return 'billing';
  if (kind.startsWith('maintenance.')) return 'maintenance';
  if (kind.startsWith('pipeline.')) return 'pipeline';
  return 'outbox';
}

/**
 * Dispatches an Outbox row to BullMQ after transaction commit.
 * A-5: Set each job's jobId to its idempotency key.
 */
export async function dispatchOutboxEntry(entry: OutboxEntry): Promise<void> {
  const queueName = getQueueForKind(entry.kind);
  const queue = getQueue(queueName);
  const retryPolicy = JOB_RETRY_POLICIES[entry.kind as keyof typeof JOB_RETRY_POLICIES];

  let jobId: string;
  if (entry.kind === 'notify.fanout') {
    jobId = JobId.notifyFanout(entry.sourceKey);
  } else if (entry.kind === 'feed.append') {
    const p = entry.payload as { membershipId: string; joinedAt: string };
    jobId = JobId.feedAppend(p.membershipId, p.joinedAt);
  } else if (entry.kind === 'email.send') {
    const p = entry.payload as { emailMessageId: string };
    jobId = JobId.emailSend(p.emailMessageId);
  } else {
    jobId = entry.sourceKey;
  }

  try {
    await queue.add(entry.kind, entry.payload, {
      jobId,
      ...retryPolicy,
    });
    logger.debug({ jobId, queueName, kind: entry.kind }, 'Dispatched outbox job');
  } catch (err) {
    logger.warn(
      { err, jobId, kind: entry.kind },
      'Failed to dispatch outbox job immediately; will be retried by outbox.sweep',
    );
  }
}

/**
 * Marks an Outbox row as processed in the database.
 */
export async function markOutboxProcessed(
  db:
    | Prisma.TransactionClient
    | { outbox: { updateMany: (args: Prisma.OutboxUpdateManyArgs) => Promise<unknown> } },
  sourceKey: string,
): Promise<void> {
  await db.outbox.updateMany({
    where: { sourceKey },
    data: { processedAt: new Date() },
  });
}
