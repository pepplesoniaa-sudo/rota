import { Worker } from 'bullmq';
import { env } from '../lib/config/env';
import { logger } from '../lib/log';
import { handleOutboxSweep } from './jobs/outbox/sweep';
import { handleNotifyFanout } from './jobs/notify/fanout';
import { handleNotifyDeliver } from './jobs/notify/deliver';
import { handleNotifyRelease } from './jobs/notify/release';
import { handleNotifyReschedule } from './jobs/notify/reschedule';
import { handleNotifyShiftReminder } from './jobs/notify/shift-reminder';
import { handleSwapsExpire } from './jobs/swaps/expire';
import { handleBillingWebhook } from './jobs/billing/webhook';
import { handleBillingCharge } from './jobs/billing/charge';
import { handleBillingOverdueScan } from './jobs/billing/overdue-scan';
import { handleBillingGraceStep } from './jobs/billing/grace-step';
import { handleBillingRenewalScan } from './jobs/billing/renewal-scan';
import { handleBillingRenew } from './jobs/billing/renew';
import { handleBillingReconcile } from './jobs/billing/reconcile';
import { handleMaintenancePurgeTeam } from './jobs/maintenance/purge-team';
import { handlePipelineTeamDailyStats } from './jobs/pipeline/team-daily-stats';
import { startReplicaLagProbe } from '../lib/data/router';
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
        case 'notify.shift-reminder':
          return handleNotifyShiftReminder(job.data);
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

  // 4. Register billing queue worker
  const billingWorker = new Worker(
    'billing',
    async (job) => {
      switch (job.name) {
        case 'billing.webhook':
          return handleBillingWebhook(job.data);
        case 'billing.charge':
          return handleBillingCharge(job.data);
        case 'billing.overdue-scan':
          return handleBillingOverdueScan(job.data);
        case 'billing.grace-step':
          return handleBillingGraceStep(job.data);
        case 'billing.renewal-scan':
          return handleBillingRenewalScan(job.data);
        case 'billing.renew':
          return handleBillingRenew(job.data);
        case 'billing.reconcile':
          return handleBillingReconcile(job.data);
        default:
          logger.warn({ jobName: job.name }, 'Unknown job in billing queue');
      }
    },
    {
      connection: { url: env.REDIS_URL },
    },
  );

  billingWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job in billing queue failed');
  });

  // 5. Register maintenance queue worker
  const maintenanceWorker = new Worker(
    'maintenance',
    async (job) => {
      switch (job.name) {
        case 'maintenance.purge-team':
          return handleMaintenancePurgeTeam(job.data);
        default:
          logger.warn({ jobName: job.name }, 'Unknown job in maintenance queue');
      }
    },
    {
      connection: { url: env.REDIS_URL },
    },
  );

  maintenanceWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job in maintenance queue failed');
  });

  // 6. Register pipeline queue worker
  const pipelineWorker = new Worker(
    'pipeline',
    async (job) => {
      switch (job.name) {
        case 'pipeline.team-daily-stats':
          return handlePipelineTeamDailyStats(job.data);
        default:
          logger.warn({ jobName: job.name }, 'Unknown job in pipeline queue');
      }
    },
    {
      connection: { url: env.REDIS_URL },
    },
  );

  pipelineWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job in pipeline queue failed');
  });

  // 7. Register repeatable outbox.sweep jobs for s0 and s1 every 60s (PRD 6.2)
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

  // 6. Register repeatable swaps.expire job every 5 minutes (PRD 6.2)
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

  // 7. Register repeatable notify.shift-reminder job every 5 minutes (PRD 6.2, FR-45)
  try {
    const notifyQueue = getQueue('notify');
    await notifyQueue.add(
      'notify.shift-reminder',
      {},
      {
        repeat: { every: 300_000 },
        jobId: 'repeatable-notify-shift-reminder',
      },
    );
    logger.info('Registered repeatable notify.shift-reminder job (every 5 min)');
  } catch (err) {
    logger.warn(
      { err },
      'Could not register repeatable notify.shift-reminder job in Redis at boot',
    );
  }

  // 8. Register repeatable billing jobs (PRD 6.2)
  try {
    const billingQueue = getQueue('billing');
    // billing.renewal-scan: every 15 min
    await billingQueue.add(
      'billing.renewal-scan',
      {},
      {
        repeat: { every: 900_000 },
        jobId: 'repeatable-billing-renewal-scan',
      },
    );
    // billing.overdue-scan: every 15 min
    await billingQueue.add(
      'billing.overdue-scan',
      {},
      {
        repeat: { every: 900_000 },
        jobId: 'repeatable-billing-overdue-scan',
      },
    );
    // billing.reconcile: every 30 min
    await billingQueue.add(
      'billing.reconcile',
      {},
      {
        repeat: { every: 1_800_000 },
        jobId: 'repeatable-billing-reconcile',
      },
    );
    logger.info('Registered repeatable billing jobs (renewal-scan, overdue-scan, reconcile)');
  } catch (err) {
    logger.warn({ err }, 'Could not register repeatable billing jobs in Redis at boot');
  }

  // 9. Register repeatable pipeline daily stats job at 04:00 UTC (PRD 6.2, FR-46)
  try {
    const pipelineQueue = getQueue('pipeline');
    await pipelineQueue.add(
      'pipeline.team-daily-stats',
      {},
      {
        repeat: { pattern: '0 4 * * *' },
        jobId: 'repeatable-pipeline-daily-stats',
      },
    );
    logger.info('Registered repeatable pipeline.team-daily-stats job (daily 04:00 UTC)');
  } catch (err) {
    logger.warn(
      { err },
      'Could not register repeatable pipeline.team-daily-stats job in Redis at boot',
    );
  }

  // 10. Start replica lag probe timer (PRD 6.1, line 529)
  const stopLagProbe = startReplicaLagProbe(5000);

  const shutdown = async () => {
    logger.info('Shutting down Rota background worker...');
    stopLagProbe();
    await Promise.all([
      outboxWorker.close(),
      notifyWorker.close(),
      swapsWorker.close(),
      billingWorker.close(),
      maintenanceWorker.close(),
      pipelineWorker.close(),
    ]);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  return {
    outboxWorker,
    notifyWorker,
    swapsWorker,
    billingWorker,
    maintenanceWorker,
    pipelineWorker,
    shutdown,
  };
}

// Auto-run if executed directly via tsx worker/index.ts
if (process.env.NODE_ENV !== 'test') {
  void startWorker();
}
