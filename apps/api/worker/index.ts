import { Worker } from 'bullmq';
import { env } from '../lib/config/env';
import { logger } from '../lib/log';
import { handleOutboxSweep } from './jobs/outbox/sweep';
import { handleNotifyFanout } from './jobs/notify/fanout';
import { handleNotifyDeliver } from './jobs/notify/deliver';
import { handleNotifyRelease } from './jobs/notify/release';
import { handleNotifyReschedule } from './jobs/notify/reschedule';
import { handleSwapsExpire } from './jobs/swaps/expire';
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

  // 2. Register notify queue worker
  const notifyWorker = new Worker(
    'notify',
    async (job, token) => {
      switch (job.name) {
        case 'notify.fanout':
          return handleNotifyFanout(job.data);
        case 'notify.deliver':
          return handleNotifyDeliver(job.data, job, token);
        case 'notify.release':
          return handleNotifyRelease(job.data);
        case 'notify.reschedule':
          return handleNotifyReschedule(job.data);
        default:
          logger.warn({ jobName: job.name }, 'Unknown job in notify queue');
      }
    },
    {
      connection: { url: env.REDIS_URL },
    },
  );

  notifyWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job in notify queue failed');
  });

  // 3. Register swaps queue worker
  const swapsWorker = new Worker(
    'swaps',
    async (job) => {
      if (job.name === 'swaps.expire') {
        return handleSwapsExpire(job.data);
      }
      logger.warn({ jobName: job.name }, 'Unknown job in swaps queue');
    },
    {
      connection: { url: env.REDIS_URL },
    },
  );

  swapsWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job in swaps queue failed');
  });

  // 4. Register repeatable outbox.sweep jobs for s0 and s1 every 60s (PRD 6.2)
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

  // 5. Register repeatable swaps.expire job every 5 minutes (PRD 6.2)
  try {
    const swapsQueue = getQueue('swaps');
    await swapsQueue.add(
      'swaps.expire',
      {},
      {
        repeat: { every: 300_000 },
        jobId: 'repeatable-swaps-expire',
      },
    );
    logger.info('Registered repeatable swaps.expire job (every 5 min)');
  } catch (err) {
    logger.warn({ err }, 'Could not register repeatable swaps.expire job in Redis at boot');
  }

  const shutdown = async () => {
    logger.info('Shutting down Rota background worker...');
    await Promise.all([outboxWorker.close(), notifyWorker.close(), swapsWorker.close()]);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  return { outboxWorker, notifyWorker, swapsWorker, shutdown };
}

// Auto-run if executed directly via tsx worker/index.ts
if (process.env.NODE_ENV !== 'test') {
  void startWorker();
}
