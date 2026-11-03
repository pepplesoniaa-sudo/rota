import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { withApi } from '../../../lib/api/with-api';
import { shouldReadPrimary, markUserWrite, probeShardLag } from '../../../lib/data/router';
import { createAccessToken } from '../../../lib/auth/jwt';

const mockRedisStore = new Map<string, { value: string; expireAt: number }>();
let simulateRedisFailure = false;

vi.mock('../../../lib/redis', () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      if (simulateRedisFailure) throw new Error('Redis connection refused');
      const item = mockRedisStore.get(key);
      if (!item) return null;
      if (Date.now() > item.expireAt) {
        mockRedisStore.delete(key);
        return null;
      }
      return item.value;
    }),
    set: vi.fn(async (key: string, value: string, mode?: string, duration?: number) => {
      if (simulateRedisFailure) throw new Error('Redis connection refused');
      const expireAt = mode === 'EX' && duration ? Date.now() + duration * 1000 : Infinity;
      mockRedisStore.set(key, { value: String(value), expireAt });
      return 'OK';
    }),
    exists: vi.fn(async (key: string) => {
      if (simulateRedisFailure) throw new Error('Redis connection refused');
      const item = mockRedisStore.get(key);
      if (!item) return 0;
      if (Date.now() > item.expireAt) {
        mockRedisStore.delete(key);
        return 0;
      }
      return 1;
    }),
    del: vi.fn(async (key: string) => {
      if (simulateRedisFailure) throw new Error('Redis connection refused');
      const existed = mockRedisStore.delete(key);
      return existed ? 1 : 0;
    }),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  },
}));

let mockReplicaLagResult: Array<{ lag_ms: number | null }> = [{ lag_ms: 0 }];

vi.mock('../../../lib/db', () => {
  const db = {
    $queryRaw: vi.fn(async () => mockReplicaLagResult),
    membership: {
      findUnique: vi.fn(async () => ({ status: 'ACTIVE', role: 'STAFF' })),
    },
    team: {
      findUnique: vi.fn(async () => ({
        id: '018f3a2b-0000-7000-8000-000000000001',
        shardIndex: 0,
      })),
    },
    subscription: {
      findUnique: vi.fn(async () => ({
        status: 'ACTIVE',
      })),
    },
  };

  return {
    dbShard0: db,
    dbShard1: db,
    getShardClient: vi.fn(() => db),
  };
});

describe('Phase 6: Scale Proof - RYOW, Replica Routing & Lag Probing (Exit Criteria 2, 3, 4 / PRD 7.4, 7.5, 11)', () => {
  const teamId = '018f3a2b-0000-7000-8000-000000000001';
  const userId = '018f3a2b-0000-7000-8000-000000000002';
  let token: string;

  beforeEach(async () => {
    mockRedisStore.clear();
    simulateRedisFailure = false;
    mockReplicaLagResult = [{ lag_ms: 0 }];
    token = await createAccessToken(userId);
    vi.clearAllMocks();
  });

  describe('Exit Criteria 2: Read-Your-Own-Writes (RYOW) & Header Overrides (PRD 7.5, A-9)', () => {
    const testReadRoute = withApi(
      {
        auth: 'access',
        roles: ['STAFF'],
      },
      async () => ({ data: 'read-ok' }),
    );

    const testWriteRoute = withApi(
      {
        auth: 'access',
        roles: ['STAFF'],
      },
      async () => ({ data: 'write-ok' }),
    );

    it('A-9: writes trigger markUserWrite, setting ryow:{userId} in Redis for 5 seconds', async () => {
      const writeReq = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/shifts`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      const writeRes = await testWriteRoute(writeReq, { params: Promise.resolve({ teamId }) });
      expect(writeRes.status).toBe(200);

      // Verify ryow marker was set in Redis
      const ryowEntry = mockRedisStore.get(`ryow:${userId}`);
      expect(ryowEntry).toBeDefined();
      expect(ryowEntry?.value).toBe('1');
    });

    it('Exit Criteria 2 / PRD 7.5: reads within 5s of a write return X-Read-Source: primary', async () => {
      // Set replica lag to 0 to ensure replica is healthy
      mockRedisStore.set('replica:lag:0', { value: '0', expireAt: Date.now() + 15000 });

      // Simulate recent write (within 5 seconds)
      await markUserWrite(userId);

      const readReq = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/shifts`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      const readRes = await testReadRoute(readReq, { params: Promise.resolve({ teamId }) });
      expect(readRes.status).toBe(200);
      expect(readRes.headers.get('X-Read-Source')).toBe('primary');
    });

    it('PRD 7.5: reads after 5s without recent write route to replica, returning X-Read-Source: replica', async () => {
      // Replica is healthy with lag 0
      mockRedisStore.set('replica:lag:0', { value: '0', expireAt: Date.now() + 15000 });
      // No ryow marker present

      const readReq = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/shifts`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      const readRes = await testReadRoute(readReq, { params: Promise.resolve({ teamId }) });
      expect(readRes.status).toBe(200);
      expect(readRes.headers.get('X-Read-Source')).toBe('replica');
    });

    it('PRD 7.5: explicit X-Read-Primary: 1 header forces primary routing', async () => {
      mockRedisStore.set('replica:lag:0', { value: '0', expireAt: Date.now() + 15000 });

      const readReq = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/shifts`, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          'x-read-primary': '1',
        },
      });

      const readRes = await testReadRoute(readReq, { params: Promise.resolve({ teamId }) });
      expect(readRes.status).toBe(200);
      expect(readRes.headers.get('X-Read-Source')).toBe('primary');
    });

    it('PRD 7.5: fails safe to primary when Redis is unreachable', async () => {
      simulateRedisFailure = true;

      const readReq = new NextRequest(`http://localhost:3000/v1/teams/${teamId}/shifts`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });

      const readRes = await testReadRoute(readReq, { params: Promise.resolve({ teamId }) });
      expect(readRes.status).toBe(200);
      expect(readRes.headers.get('X-Read-Source')).toBe('primary');
    });
  });

  describe('Exit Criteria 3: Replica Fallback Under Lag & Paused Replication (PRD 7.5)', () => {
    it('Exit Criteria 3: falls back to primary when replica lag > 2,000 ms', async () => {
      // Set lag to 2,500 ms (exceeds 2,000 ms threshold)
      mockRedisStore.set('replica:lag:0', { value: '2500', expireAt: Date.now() + 15000 });

      const shouldRead = await shouldReadPrimary({ shardIndex: 0, userId });
      expect(shouldRead).toBe(true);

      // Verify degraded marker was recorded in Redis
      const degraded = mockRedisStore.get('replica:degraded:0');
      expect(degraded?.value).toBe('1');
    });

    it('PRD 7.5 hysteresis: remains on primary until lag drops below 1,000 ms', async () => {
      // 1. Initial high lag > 2000 ms sets degraded mode
      mockRedisStore.set('replica:lag:0', { value: '2200', expireAt: Date.now() + 15000 });
      await shouldReadPrimary({ shardIndex: 0 });

      // 2. Lag decreases to 1,400 ms (still between 1,000 ms and 2,000 ms)
      mockRedisStore.set('replica:lag:0', { value: '1400', expireAt: Date.now() + 15000 });
      const stillDegraded = await shouldReadPrimary({ shardIndex: 0 });
      // Must stay on primary due to hysteresis until dropping below 1,000 ms
      expect(stillDegraded).toBe(true);

      // 3. Lag drops below 1,000 ms (e.g. 400 ms)
      mockRedisStore.set('replica:lag:0', { value: '400', expireAt: Date.now() + 15000 });
      const recovered = await shouldReadPrimary({ shardIndex: 0 });
      // Recovers and returns false (replica)
      expect(recovered).toBe(false);
      expect(mockRedisStore.get('replica:degraded:0')).toBeUndefined();
    });

    it('PRD 7.5: falls safe to primary when replica lag metric is missing (expired timer / stopped probe)', async () => {
      // Key absent in Redis
      expect(mockRedisStore.get('replica:lag:0')).toBeUndefined();

      const shouldRead = await shouldReadPrimary({ shardIndex: 0 });
      expect(shouldRead).toBe(true);
    });
  });

  describe('Exit Criteria 4: Idle Replica Shows Lag 0 (PRD 6.1, PRD 11)', () => {
    it('Exit Criteria 4: probeShardLag returns 0 and writes replica:lag:0 when replica is idle (WAL positions match)', async () => {
      // When pg_last_wal_receive_lsn() = pg_last_wal_replay_lsn(), query returns 0
      mockReplicaLagResult = [{ lag_ms: 0 }];

      const lag = await probeShardLag(0);
      expect(lag).toBe(0);

      const cached = mockRedisStore.get('replica:lag:0');
      expect(cached).toBeDefined();
      expect(cached?.value).toBe('0');
      // TTL is 15 seconds
      expect(cached?.expireAt).toBeGreaterThan(Date.now() + 10000);
    });
  });
});
