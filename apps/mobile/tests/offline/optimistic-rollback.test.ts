import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
}));

import {
  createOptimisticMutation,
  assertOnline,
  OfflineError,
} from '../../src/lib/offline/mutations';
import { queryClient } from '../../src/lib/query/client';
import { useAppStore } from '../../src/lib/state/app-store';

describe('FR-33 Optimistic Update & Rollback Rules (Exit Criteria 1)', () => {
  const testKey = ['swaps', 'team_abc'] as const;

  interface SwapItem {
    id: string;
    status: 'PENDING_MANAGER' | 'APPROVED' | 'REJECTED';
    shiftId: string;
  }

  beforeEach(() => {
    queryClient.clear();
    useAppStore.getState().reset();
    useAppStore.getState().setOnline(true);
  });

  it('assertOnline succeeds when online and throws OfflineError when offline (FR-33)', () => {
    useAppStore.getState().setOnline(true);
    expect(() => assertOnline('approve swap')).not.toThrow();

    useAppStore.getState().setOnline(false);
    expect(() => assertOnline('approve swap')).toThrow(OfflineError);
    expect(() => assertOnline('approve swap')).toThrow('You are offline. Connect to approve swap.');
  });

  it('createOptimisticMutation applies instant UI update via onMutate (FR-33)', async () => {
    const initialSwaps: SwapItem[] = [
      { id: 'swap-1', status: 'PENDING_MANAGER', shiftId: 'shift-1' },
      { id: 'swap-2', status: 'PENDING_MANAGER', shiftId: 'shift-2' },
    ];
    queryClient.setQueryData<SwapItem[]>(testKey, initialSwaps);

    const mutationConfig = createOptimisticMutation<
      SwapItem[],
      { swapId: string; newStatus: 'APPROVED' }
    >({
      queryKey: testKey,
      actionName: 'approve swap',
      mutationFn: async ({ swapId, newStatus }) => {
        return initialSwaps.map((s) => (s.id === swapId ? { ...s, status: newStatus } : s));
      },
      updateCache: (old, { swapId, newStatus }) => {
        return (old ?? []).map((s) => (s.id === swapId ? { ...s, status: newStatus } : s));
      },
    });

    // Run onMutate
    const context = await mutationConfig.onMutate({ swapId: 'swap-1', newStatus: 'APPROVED' });

    // Cache should immediately show APPROVED
    const updated = queryClient.getQueryData<SwapItem[]>(testKey);
    expect(updated?.[0]?.status).toBe('APPROVED');
    expect(context.previousData).toEqual(initialSwaps);
  });

  it('createOptimisticMutation rolls back to snapshot on server error (Exit Criteria 1)', async () => {
    const initialSwaps: SwapItem[] = [
      { id: 'swap-1', status: 'PENDING_MANAGER', shiftId: 'shift-1' },
    ];
    queryClient.setQueryData<SwapItem[]>(testKey, initialSwaps);

    const mutationConfig = createOptimisticMutation<
      SwapItem[],
      { swapId: string; newStatus: 'APPROVED' }
    >({
      queryKey: testKey,
      actionName: 'approve swap',
      mutationFn: async () => {
        throw new Error('409 SHIFT_OVERLAP');
      },
      updateCache: (old, { swapId, newStatus }) => {
        return (old ?? []).map((s) => (s.id === swapId ? { ...s, status: newStatus } : s));
      },
    });

    // 1. Snapshot taken and optimistic update applied
    const context = await mutationConfig.onMutate({ swapId: 'swap-1', newStatus: 'APPROVED' });
    expect(queryClient.getQueryData<SwapItem[]>(testKey)?.[0]?.status).toBe('APPROVED');

    // 2. Server fails with error -> onError rolls back
    mutationConfig.onError(
      new Error('409 SHIFT_OVERLAP'),
      { swapId: 'swap-1', newStatus: 'APPROVED' },
      context,
    );

    // 3. Cache must be restored to original PENDING_MANAGER state
    const rolledBack = queryClient.getQueryData<SwapItem[]>(testKey);
    expect(rolledBack?.[0]?.status).toBe('PENDING_MANAGER');
  });

  it('createOptimisticMutation blocks execution when device is offline', async () => {
    useAppStore.getState().setOnline(false);

    const mutationConfig = createOptimisticMutation<string, void>({
      queryKey: ['anyKey'],
      actionName: 'update availability',
      mutationFn: async () => 'done',
      updateCache: () => 'updated',
    });

    await expect(mutationConfig.mutationFn()).rejects.toThrow(OfflineError);
    await expect(mutationConfig.mutationFn()).rejects.toThrow(
      'You are offline. Connect to update availability.',
    );
  });
});
