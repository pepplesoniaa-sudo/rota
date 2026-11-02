import { Worker } from 'bullmq';
import { env } from '../lib/config/env';
import { logger } from '../lib/log';
import { handleOutboxSweep } from './jobs/outbox/sweep';
import { getQueue } from './queues';

export async function startWorker() {
  logger.info('Starting Rota background worker...');

  // 1. Register outbox queue worker
  const outboxWorker = new Worker(
    'outbox',
    async (job) => {
      if (job.name === 'outbox.sweep') {
        return handleOutboxSweep(job.data);
      }
      logger.warn({ jobName: job.name }, 'Unknown job in outbox queue');
    },
    {
      connection: { url: env.REDIS_URL },
    },
  );

  outboxWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job in outbox queue failed');
  });

  // 2. Register repeatable outbox.sweep jobs for s0 and s1 every 60s (PRD 6.2)
  try {
    const outboxQueue = getQueue('outbox');
    await outboxQueue.add(
      'outbox.sweep',
      { database: 's0' },
      {
        repeat: { every: 60_000 },
        jobId: 'repeatable-outbox-sweep-s0',
      },
    );
    await outboxQueue.add(
      'outbox.sweep',
      { database: 's1' },
      {
        repeat: { every: 60_000 },
        jobId: 'repeatable-outbox-sweep-s1',
      },
    );
    logger.info('Registered repeatable outbox.sweep jobs for s0 and s1 (every 60s)');
  } catch (err) {
    logger.warn({ err }, 'Could not register repeatable outbox.sweep jobs in Redis at boot');
  }

  const shutdown = async () => {
    logger.info('Shutting down Rota background worker...');
    await outboxWorker.close();
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  return { outboxWorker, shutdown };
}

// Auto-run if executed directly via tsx worker/index.ts
if (process.env.NODE_ENV !== 'test') {
  void startWorker();
}
