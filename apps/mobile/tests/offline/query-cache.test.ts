import { describe, it, expect, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(async () => {
        store.clear();
      }),
    },
  };
});

import {
  STALE_TIMES,
  MAX_OFFLINE_CACHE_AGE_MS,
  createQueryClient,
  createOfflinePersister,
  queryKeys,
} from '../../src/lib/query/client';
import { ShiftStatus } from '@rota/shared';

describe('L-32 & FR-32 Query Cache and Offline Persistence Rules', () => {
  it('enforces exact locked stale times per L-32 and PRD 7.3', () => {
    expect(STALE_TIMES.feed).toBe(30 * 1000); // 30 s
    expect(STALE_TIMES.myShifts).toBe(60 * 1000); // 60 s
    expect(STALE_TIMES.teamSchedule).toBe(60 * 1000); // 60 s
    expect(STALE_TIMES.swaps).toBe(15 * 1000); // 15 s
    expect(STALE_TIMES.settings).toBe(300 * 1000); // 300 s
    expect(STALE_TIMES.billing).toBe(0); // 0 s
  });

  it('enforces 14-day max offline cache age per FR-32 and PRD 7.7', () => {
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    expect(MAX_OFFLINE_CACHE_AGE_MS).toBe(fourteenDaysMs);
  });

  it('createQueryClient initializes with locked offlineFirst query settings and online mutation mode', () => {
    const client = createQueryClient();
    const defaultQueryOpts = client.getDefaultOptions().queries;
    const defaultMutationOpts = client.getDefaultOptions().mutations;

    expect(defaultQueryOpts?.gcTime).toBe(MAX_OFFLINE_CACHE_AGE_MS);
    expect(defaultQueryOpts?.networkMode).toBe('offlineFirst');
    expect(defaultMutationOpts?.networkMode).toBe('online'); // FR-33: mutations blocked when offline
  });

  it('provides stable query key factories per PRD 7.7', () => {
    const teamId = 'team-123';
    expect(queryKeys.feed(teamId)).toEqual(['feed', 'team-123']);
    expect(queryKeys.offlineShifts()).toEqual(['me', 'shifts', 'offline']);
    expect(queryKeys.offlineSettings()).toEqual(['me', 'settings']);
    expect(queryKeys.myShifts('2026-11-01', '2026-11-15')).toEqual([
      'myShifts',
      '2026-11-01',
      '2026-11-15',
    ]);
  });

  it('persists and restores client cache with AsyncStorage mock', async () => {
    const persister = createOfflinePersister(AsyncStorage);
    const client = createQueryClient();

    // Populate cache with published shifts only (FR-15c: drafts are never cached)
    const testShifts = [
      { id: 's1', status: ShiftStatus.PUBLISHED, startAt: '2026-11-03T09:00:00Z' },
      { id: 's2', status: ShiftStatus.PUBLISHED, startAt: '2026-11-04T09:00:00Z' },
    ];

    client.setQueryData(queryKeys.offlineShifts(), testShifts);

    // Persist
    await persister.persistClient({
      timestamp: Date.now(),
      buster: 'user_1',
      clientState: {
        mutations: [],
        queries: [
          {
            state: {
              data: testShifts,
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle',
            },
            queryKey: queryKeys.offlineShifts(),
            queryHash: JSON.stringify(queryKeys.offlineShifts()),
            dehydratedAt: Date.now(),
          },
        ],
      },
    });

    expect(await AsyncStorage.getItem('rota_query_cache_v1')).toBeTruthy();

    // Restore from persister
    const restored = await persister.restoreClient();
    expect(restored).toBeDefined();
    expect(restored?.clientState.queries[0]?.state.data).toEqual(testShifts);

    // Verify all shifts in offline cache are strictly PUBLISHED (FR-15c, FR-32)
    const restoredShifts = restored?.clientState.queries[0]?.state.data as typeof testShifts;
    const hasDrafts = restoredShifts.some((s) => s.status === ShiftStatus.DRAFT);
    expect(hasDrafts).toBe(false);
  });
});
