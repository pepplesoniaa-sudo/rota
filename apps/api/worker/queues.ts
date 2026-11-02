import { Queue, QueueOptions } from 'bullmq';
import { env } from '../lib/config/env';

export const QUEUE_NAMES = [
  'feed',
  'outbox',
  'notify',
  'swaps',
  'email',
  'billing',
  'maintenance',
  'pipeline',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * L-35: Job configuration numbers matching PRD 6.2 exactly.
 */
export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 86400 },
  removeOnFail: { age: 604800 },
};

export const JOB_RETRY_POLICIES = {
  'feed.append': {
    attempts: 8,
    backoff: { type: 'exponential' as const, delay: 5000 },
  },
  'outbox.sweep': {
    attempts: 1,
  },
  'notify.fanout': {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 5000 },
  },
  'notify.deliver': {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 10000 },
  },
  'notify.release': {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 10000 },
  },
  'notify.receipts': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 30000 },
  },
  'notify.reschedule': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 5000 },
  },
  'notify.shift-reminder': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 5000 },
  },
  'swaps.expire': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 5000 },
  },
  'email.send': {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 30000 },
  },
  'billing.renewal-scan': {
    attempts: 1,
  },
  'billing.renew': {
    attempts: 5,
    backoff: { type: 'exponential' as const, delay: 30000 },
  },
  'billing.overdue-scan': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 30000 },
  },
  'billing.charge': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 60000 },
  },
  'billing.webhook': {
    attempts: 8,
    backoff: { type: 'exponential' as const, delay: 15000 },
  },
  'billing.reconcile': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 60000 },
  },
  'billing.grace-step': {
    attempts: 5,
    backoff: { type: 'fixed' as const, delay: 30000 },
  },
  'maintenance.cleanup': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 60000 },
  },
  'maintenance.shard-check': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 60000 },
  },
  'maintenance.purge-team': {
    attempts: 5,
    backoff: { type: 'fixed' as const, delay: 60000 },
  },
  'pipeline.team-daily-stats': {
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 60000 },
  },
} as const;

export type JobName = keyof typeof JOB_RETRY_POLICIES;

/**
 * PRD 6.2: Idempotency Key (jobId) formats.
 */
export const JobId = {
  feedAppend: (membershipId: string, joinedAtIso: string) =>
    `member-joined:${membershipId}:${joinedAtIso}`,
  outboxSweep: (database: string, minute: string) => `outbox-sweep:${database}:${minute}`,
  notifyFanout: (sourceKey: string) => `fanout:${sourceKey}`,
  notifyDeliver: (notificationId: string, scheduledForIso: string) =>
    `deliver:${notificationId}:${scheduledForIso}`,
  notifyRelease: (userId: string, releaseAtIso: string) => `release:${userId}:${releaseAtIso}`,
  notifyReceipts: (quarterHour: string) => `receipts:${quarterHour}`,
  notifyReschedule: (userId: string, settingsVersion: number) =>
    `reschedule:${userId}:${settingsVersion}`,
  notifyShiftReminder: (shiftId: string, startsAtIso: string) =>
    `reminder:${shiftId}:${startsAtIso}`,
  swapsExpire: (swapId: string) => `swap-expire:${swapId}`,
  emailSend: (emailMessageId: string) => `email:${emailMessageId}`,
  billingRenewalScan: (quarterHour: string) => `renewal-scan:${quarterHour}`,
  billingRenew: (subscriptionId: string, periodStartIso: string) =>
    `renew:${subscriptionId}:${periodStartIso}`,
  billingOverdueScan: (chargeId: string) => `overdue:${chargeId}`,
  billingCharge: (chargeAttemptId: string) => `charge-attempt:${chargeAttemptId}`,
  billingWebhook: (providerEventKey: string) => `webhook:${providerEventKey}`,
  billingReconcile: (chargeAttemptId: string, halfHourWindow: string) =>
    `reconcile:${chargeAttemptId}:${halfHourWindow}`,
  billingGraceStep: (chargeId: string, step: number) => `grace:${chargeId}:${step}`,
  maintenanceCleanup: (date: string) => `cleanup:${date}`,
  maintenanceShardCheck: (date: string) => `shard-check:${date}`,
  maintenancePurgeTeam: (teamId: string) => `purge:${teamId}`,
  pipelineTeamDailyStats: (teamId: string, date: string) => `stats:${teamId}:${date}`,
};

interface GlobalQueues {
  queues?: Map<QueueName, Queue>;
}

const globalForQueues = globalThis as unknown as GlobalQueues;
const queuesMap = globalForQueues.queues ?? new Map<QueueName, Queue>();

if (env.NODE_ENV !== 'production') {
  globalForQueues.queues = queuesMap;
}

export function getQueue(name: QueueName, options?: Partial<QueueOptions>): Queue {
  let queue = queuesMap.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: {
        url: env.REDIS_URL,
      },
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
      ...options,
    });
    queuesMap.set(name, queue);
  }
  return queue;
}
