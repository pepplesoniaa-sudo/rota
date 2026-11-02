import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

/**
 * L-32 Locked Caching rules for TanStack Query (PRD 7.3):
 * - feed: 30 s
 * - my shifts: 60 s
 * - team schedule: 60 s
 * - swaps: 15 s
 * - settings: 300 s
 * - billing: 0 s
 */
export const STALE_TIMES = {
  feed: 30 * 1000,
  myShifts: 60 * 1000,
  teamSchedule: 60 * 1000,
  swaps: 15 * 1000,
  settings: 300 * 1000,
  billing: 0,
} as const;

/**
 * FR-32: Max cache age is 14 days. If older, considered expired for offline schedule.
 */
export const MAX_OFFLINE_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const queryKeys = {
  feed: (teamId: string) => ['feed', teamId] as const,
  myShifts: (from?: string, to?: string) => ['myShifts', from, to] as const,
  teamSchedule: (teamId: string, from?: string, to?: string) =>
    ['teamSchedule', teamId, from, to] as const,
  swaps: (teamId: string, status?: string) => ['swaps', teamId, status] as const,
  settings: () => ['settings'] as const,
  billing: (teamId: string) => ['billing', teamId] as const,
  me: () => ['me'] as const,
  myTeams: () => ['myTeams'] as const,
  teamMembers: (teamId: string) => ['teamMembers', teamId] as const,
  availability: (teamId: string) => ['availability', teamId] as const,
  offlineShifts: () => ['me', 'shifts', 'offline'] as const,
  offlineSettings: () => ['me', 'settings'] as const,
};

/**
 * Creates the locked QueryClient with defaults per L-3 and L-32.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: MAX_OFFLINE_CACHE_AGE_MS,
        retry: 2,
        networkMode: 'offlineFirst',
      },
      mutations: {
        networkMode: 'online', // FR-33: Block mutations when offline
      },
    },
  });
}

/**
 * L-3: AsyncStorage persister for TanStack Query.
 * FR-32: Max age 14 days; drafts are never cached (FR-15c).
 */
export function createOfflinePersister(storage = AsyncStorage) {
  return createAsyncStoragePersister({
    storage,
    key: 'rota_query_cache_v1',
    throttleTime: 1000,
  });
}

export const queryClient = createQueryClient();
export const queryPersister = createOfflinePersister();
