import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSwapsExpire } from '../../../worker/jobs/swaps/expire';
import { SwapStatus } from '@prisma/client';

interface MockSwap {
  id: string;
  teamId: string;
  status: SwapStatus;
  expiresAt: Date;
  version: number;
}

const { mockSwapsS0, mockSwapsS1 } = vi.hoisted(() => ({
  mockSwapsS0: [] as MockSwap[],
  mockSwapsS1: [] as MockSwap[],
}));

const mockDispatchOutbox = vi.fn();
const mockWriteOutbox = vi.fn();

vi.mock('../../../lib/outbox/writer', () => ({
  writeOutbox: (...args: unknown[]) => mockWriteOutbox(...args),
  dispatchOutboxEntry: (...args: unknown[]) => mockDispatchOutbox(...args),
}));

interface SwapUpdateData {
  status?: SwapStatus;
  version?: { increment: number };
}

function createMockShard(swaps: MockSwap[]) {
  return {
    swapRequest: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            id?: string;
            status: { in: SwapStatus[] };
            expiresAt: { lte: Date };
          };
        }) => {
          return swaps.filter((s) => {
            if (where.id && s.id !== where.id) return false;
            if (!where.status.in.includes(s.status)) return false;
            if (s.expiresAt > where.expiresAt.lte) return false;
            return true;
          });
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return swaps.find((s) => s.id === where.id) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: SwapUpdateData }) => {
        const s = swaps.find((x) => x.id === where.id);
        if (!s) throw new Error('Not found');
        if (data.status) {
          s.status = data.status;
        }
        if (data.version?.increment) {
          s.version += data.version.increment;
        }
        return s;
      }),
    },
    $transaction: vi.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      return cb({
        swapRequest: {
          findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
            return swaps.find((s) => s.id === where.id) ?? null;
          }),
          update: vi.fn(
            async ({ where, data }: { where: { id: string }; data: SwapUpdateData }) => {
              const s = swaps.find((x) => x.id === where.id);
              if (!s) throw new Error('Not found');
              if (data.status) {
                s.status = data.status;
              }
              if (data.version?.increment) {
                s.version += data.version.increment;
              }
              return s;
            },
          ),
        },
      });
    }),
  };
}

vi.mock('../../../lib/db', () => ({
  dbShard0: createMockShard(mockSwapsS0),
  dbShard1: createMockShard(mockSwapsS1),
}));

describe('PRD 6.2 & FR-25: swaps.expire Job Handler', () => {
  const teamId = '018f6e80-7711-7000-8000-000000000001';
  const pastDate = new Date(Date.now() - 3600000); // 1 hour ago
  const futureDate = new Date(Date.now() + 3600000); // 1 hour ahead

  beforeEach(() => {
    vi.clearAllMocks();
    mockSwapsS0.length = 0;
    mockSwapsS1.length = 0;

    mockWriteOutbox.mockImplementation(async (_tx, payload) => {
      return { id: 'outbox-entry-1', ...payload };
    });
    mockDispatchOutbox.mockResolvedValue(undefined);
  });

  it('expires open swaps past expiresAt and writes notify.fanout outbox row (FR-25)', async () => {
    mockSwapsS0.push(
      {
        id: 'swap-past-peer',
        teamId,
        status: SwapStatus.PENDING_PEER,
        expiresAt: pastDate,
        version: 1,
      },
      {
        id: 'swap-future',
        teamId,
        status: SwapStatus.PENDING_PEER,
        expiresAt: futureDate,
        version: 1,
      },
    );

    mockSwapsS1.push({
      id: 'swap-past-manager',
      teamId,
      status: SwapStatus.PENDING_MANAGER,
      expiresAt: pastDate,
      version: 2,
    });

    const result = await handleSwapsExpire({});

    expect(result.expiredCount).toBe(2);

    const expiredPeer = mockSwapsS0.find((s) => s.id === 'swap-past-peer');
    expect(expiredPeer?.status).toBe(SwapStatus.EXPIRED);
    expect(expiredPeer?.version).toBe(2);

    const futureSwap = mockSwapsS0.find((s) => s.id === 'swap-future');
    expect(futureSwap?.status).toBe(SwapStatus.PENDING_PEER);

    const expiredMgr = mockSwapsS1.find((s) => s.id === 'swap-past-manager');
    expect(expiredMgr?.status).toBe(SwapStatus.EXPIRED);
    expect(expiredMgr?.version).toBe(3);

    // Verify outbox writes
    expect(mockWriteOutbox).toHaveBeenCalledTimes(2);
    expect(mockDispatchOutbox).toHaveBeenCalledTimes(2);
  });

  it('targets specific swapId when provided in job data', async () => {
    const targetId = '018f6e80-7711-7000-8000-000000000099';
    mockSwapsS0.push({
      id: targetId,
      teamId,
      status: SwapStatus.PENDING_PEER,
      expiresAt: pastDate,
      version: 1,
    });

    const result = await handleSwapsExpire({ swapId: targetId });

    expect(result.expiredCount).toBe(1);
    const swap = mockSwapsS0.find((s) => s.id === targetId);
    expect(swap?.status).toBe(SwapStatus.EXPIRED);
  });
});
