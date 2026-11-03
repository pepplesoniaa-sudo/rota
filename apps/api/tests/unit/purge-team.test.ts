import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMaintenancePurgeTeam } from '../../worker/jobs/maintenance/purge-team';

const mockShardCalls: Record<string, number> = {};
const mockGlobalCalls: Record<string, number> = {};

vi.mock('../../lib/data/router', () => ({
  getTeamShardIndex: vi.fn(async () => 0),
}));

vi.mock('../../lib/db', () => {
  const shardTx = {
    activityEvent: {
      deleteMany: vi.fn(async () => {
        mockShardCalls.activityEvent = (mockShardCalls.activityEvent ?? 0) + 1;
        return { count: 10 };
      }),
    },
    swapRequest: {
      deleteMany: vi.fn(async () => {
        mockShardCalls.swapRequest = (mockShardCalls.swapRequest ?? 0) + 1;
        return { count: 5 };
      }),
    },
    shift: {
      deleteMany: vi.fn(async () => {
        mockShardCalls.shift = (mockShardCalls.shift ?? 0) + 1;
        return { count: 20 };
      }),
    },
    availabilityBlock: {
      deleteMany: vi.fn(async () => {
        mockShardCalls.availabilityBlock = (mockShardCalls.availabilityBlock ?? 0) + 1;
        return { count: 8 };
      }),
    },
    teamDailyStats: {
      deleteMany: vi.fn(async () => {
        mockShardCalls.teamDailyStats = (mockShardCalls.teamDailyStats ?? 0) + 1;
        return { count: 28 };
      }),
    },
    memberWeeklyStats: {
      deleteMany: vi.fn(async () => {
        mockShardCalls.memberWeeklyStats = (mockShardCalls.memberWeeklyStats ?? 0) + 1;
        return { count: 12 };
      }),
    },
    outbox: {
      deleteMany: vi.fn(async () => {
        mockShardCalls.outbox = (mockShardCalls.outbox ?? 0) + 1;
        return { count: 3 };
      }),
    },
  };

  const globalTx = {
    membership: {
      deleteMany: vi.fn(async () => {
        mockGlobalCalls.membership = (mockGlobalCalls.membership ?? 0) + 1;
        return { count: 4 };
      }),
    },
    invite: {
      deleteMany: vi.fn(async () => {
        mockGlobalCalls.invite = (mockGlobalCalls.invite ?? 0) + 1;
        return { count: 2 };
      }),
    },
    outbox: {
      deleteMany: vi.fn(async () => {
        mockGlobalCalls.outbox = (mockGlobalCalls.outbox ?? 0) + 1;
        return { count: 1 };
      }),
    },
  };

  const mockShardClient = {
    $transaction: vi.fn(async (cb: (tx: typeof shardTx) => Promise<unknown>) => cb(shardTx)),
  };

  const mockGlobalClient = {
    $transaction: vi.fn(async (cb: (tx: typeof globalTx) => Promise<unknown>) => cb(globalTx)),
  };

  return {
    dbShard0: mockGlobalClient,
    getShardClient: vi.fn(() => mockShardClient),
  };
});

describe('maintenance.purge-team (PRD 6.2, FR-14, B-12)', () => {
  const teamId = '018f3a2b-1000-7000-8000-000000000001';

  beforeEach(() => {
    for (const key of Object.keys(mockShardCalls)) {
      delete mockShardCalls[key];
    }
    for (const key of Object.keys(mockGlobalCalls)) {
      delete mockGlobalCalls[key];
    }
  });

  it('purges all shard rows and global memberships/invites for the team, preserving ledger and charges (B-12)', async () => {
    const result = await handleMaintenancePurgeTeam({ teamId });
    expect(result.purged).toBe(true);

    // Verify all shard tables purged
    expect(mockShardCalls.activityEvent).toBe(1);
    expect(mockShardCalls.swapRequest).toBe(1);
    expect(mockShardCalls.shift).toBe(1);
    expect(mockShardCalls.availabilityBlock).toBe(1);
    expect(mockShardCalls.teamDailyStats).toBe(1);
    expect(mockShardCalls.memberWeeklyStats).toBe(1);
    expect(mockShardCalls.outbox).toBe(1);

    // Verify global tables purged
    expect(mockGlobalCalls.membership).toBe(1);
    expect(mockGlobalCalls.invite).toBe(1);
    expect(mockGlobalCalls.outbox).toBe(1);

    // B-12: Ledger entries and charges are never touched
    expect(mockGlobalCalls.ledgerEntry).toBeUndefined();
    expect(mockGlobalCalls.charge).toBeUndefined();
    expect(mockGlobalCalls.chargeAttempt).toBeUndefined();
  });
});
