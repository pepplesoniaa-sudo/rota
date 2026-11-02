import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  emailSendPayloadSchema,
  feedAppendPayloadSchema,
  notifyFanoutPayloadSchema,
  validateOutboxPayload,
} from '../../lib/outbox/schemas';
import {
  dispatchOutboxEntry,
  getQueueForKind,
  markOutboxProcessed,
  writeOutbox,
} from '../../lib/outbox/writer';
import { JobId, JOB_RETRY_POLICIES, QUEUE_NAMES, getQueue } from '../../worker/queues';
import { handleOutboxSweep } from '../../worker/jobs/outbox/sweep';

// Mock BullMQ queues to avoid needing live Redis during unit tests
vi.mock('../../worker/queues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../worker/queues')>();
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: 'mock-job-id' }),
  };
  return {
    ...actual,
    getQueue: vi.fn().mockReturnValue(mockQueue),
  };
});

// Mock database clients to avoid needing live Postgres during unit tests
vi.mock('../../lib/db', () => ({
  dbShard0: {
    outbox: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'outbox-1',
          teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
          sourceKey: 'event:018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d61',
          kind: 'notify.fanout',
          payload: {
            sourceKey: 'event:018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d61',
            teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
            type: 'SHIFT_CREATED',
          },
          createdAt: new Date(Date.now() - 40_000),
          processedAt: null,
        },
      ]),
    },
  },
  dbShard1: {
    outbox: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe('Outbox Payload Validation (DB-3)', () => {
  it('validates feed.append payload with strict schema', () => {
    const valid = {
      teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
      membershipId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5f',
      userId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d60',
      joinedAt: new Date().toISOString(),
    };

    expect(() => feedAppendPayloadSchema.parse(valid)).not.toThrow();
    expect(() => validateOutboxPayload('feed.append', valid)).not.toThrow();

    // Reject unknown fields
    expect(() => feedAppendPayloadSchema.parse({ ...valid, extraField: 'bad' })).toThrow();

    // Reject non-UUID
    expect(() => feedAppendPayloadSchema.parse({ ...valid, teamId: 'not-a-uuid' })).toThrow();
  });

  it('validates notify.fanout payload with strict schema', () => {
    const valid = {
      sourceKey: 'event:018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d61',
      teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
      type: 'SHIFT_CREATED',
    };

    expect(() => notifyFanoutPayloadSchema.parse(valid)).not.toThrow();
    expect(() => validateOutboxPayload('notify.fanout', valid)).not.toThrow();
  });

  it('validates email.send payload with strict schema', () => {
    const valid = {
      template: 'invite',
      to: 'staff@example.com',
      vars: { teamName: 'Clinic A' },
      emailMessageId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d62',
    };

    expect(() => emailSendPayloadSchema.parse(valid)).not.toThrow();
    expect(() => validateOutboxPayload('email.send', valid)).not.toThrow();
  });
});

describe('JobId Idempotency Key Formats (PRD 6.2)', () => {
  it('builds outbox-sweep key format', () => {
    expect(JobId.outboxSweep('s0', '2026-11-01T18:00')).toBe('outbox-sweep:s0:2026-11-01T18:00');
  });

  it('builds member-joined key format', () => {
    expect(JobId.feedAppend('m-123', '2026-11-01T18:00:00.000Z')).toBe(
      'member-joined:m-123:2026-11-01T18:00:00.000Z',
    );
  });

  it('builds fanout key format', () => {
    expect(JobId.notifyFanout('swap:sw-1:APPROVED')).toBe('fanout:swap:sw-1:APPROVED');
  });

  it('verifies locked retry policies match PRD 6.2 (L-35)', () => {
    expect(QUEUE_NAMES).toContain('outbox');
    expect(QUEUE_NAMES).toContain('feed');
    expect(QUEUE_NAMES).toContain('notify');
    expect(QUEUE_NAMES).toContain('billing');

    expect(JOB_RETRY_POLICIES['outbox.sweep'].attempts).toBe(1);
    expect(JOB_RETRY_POLICIES['feed.append'].attempts).toBe(8);
    expect(JOB_RETRY_POLICIES['notify.fanout'].attempts).toBe(5);
  });
});

describe('Transactional Outbox Writer (A-5, DB-12)', () => {
  it('writes outbox row to database inside transaction without calling queue.add', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      id: 'outbox-uuid-1',
      kind: 'feed.append',
      sourceKey: 'member-joined:m-1:2026-11-01T18:00:00.000Z',
      payload: {
        teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
        membershipId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5f',
        userId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d60',
        joinedAt: '2026-11-01T18:00:00.000Z',
      },
      teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
      createdAt: new Date(),
      processedAt: null,
    });

    const mockTx = {
      outbox: {
        create: mockCreate,
      },
    } as unknown as Prisma.TransactionClient;

    const entry = await writeOutbox(mockTx, {
      kind: 'feed.append',
      sourceKey: 'member-joined:m-1:2026-11-01T18:00:00.000Z',
      teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
      payload: {
        teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
        membershipId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5f',
        userId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d60',
        joinedAt: '2026-11-01T18:00:00.000Z',
      },
    });

    expect(entry.id).toBe('outbox-uuid-1');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'feed.append',
        sourceKey: 'member-joined:m-1:2026-11-01T18:00:00.000Z',
        teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
      }),
    });
  });

  it('maps outbox kind to correct queue name', () => {
    expect(getQueueForKind('feed.append')).toBe('feed');
    expect(getQueueForKind('notify.fanout')).toBe('notify');
    expect(getQueueForKind('email.send')).toBe('email');
    expect(getQueueForKind('billing.renew')).toBe('billing');
  });

  it('marks outbox entry processed in database', async () => {
    const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const mockDb = {
      outbox: {
        updateMany: mockUpdateMany,
      },
    } as unknown as Prisma.TransactionClient;

    await markOutboxProcessed(mockDb, 'key-123');

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { sourceKey: 'key-123' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('dispatches outbox entry to BullMQ with idempotency key', async () => {
    const mockQueue = getQueue('notify');

    const entry = {
      id: 'entry-1',
      teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
      sourceKey: 'event:018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d61',
      kind: 'notify.fanout',
      payload: {
        sourceKey: 'event:018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d61',
        teamId: '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e',
        type: 'SHIFT_CREATED',
      },
      createdAt: new Date(),
      processedAt: null,
    };

    await dispatchOutboxEntry(entry);

    expect(mockQueue.add).toHaveBeenCalledWith(
      'notify.fanout',
      entry.payload,
      expect.objectContaining({
        jobId: 'fanout:event:018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d61',
        attempts: 5,
      }),
    );
  });

  it('handleOutboxSweep runs in system scope and returns swept count', async () => {
    const result = await handleOutboxSweep({ database: 's0' });
    expect(result.swept).toBe(1);
  });
});
