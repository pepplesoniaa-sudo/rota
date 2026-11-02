import { queryClient } from '../query/client';
import { useAppStore } from '../state/app-store';

export class OfflineError extends Error {
  readonly code = 'OFFLINE';

  constructor(actionName = 'perform this action') {
    super(`You are offline. Connect to ${actionName}.`);
    this.name = 'OfflineError';
  }
}

/**
 * FR-33: Asserts the device is currently online before allowing mutative operations.
 * Throws OfflineError if offline.
 */
export function assertOnline(actionName?: string): void {
  const isOnline = useAppStore.getState().isOnline;
  if (!isOnline) {
    throw new OfflineError(actionName);
  }
}

export interface OptimisticMutationOptions<TData, TVariables> {
  queryKey: readonly unknown[];
  mutationFn: (variables: TVariables) => Promise<TData>;
  updateCache: (oldData: TData | undefined, variables: TVariables) => TData;
  actionName?: string;
}

/**
 * Creates an optimistic mutation with automatic rollback on error (FR-33, Exit criteria 1).
 */
export function createOptimisticMutation<TData, TVariables>(
  options: OptimisticMutationOptions<TData, TVariables>,
) {
  const { queryKey, mutationFn, updateCache, actionName } = options;

  return {
    mutationFn: async (variables: TVariables) => {
      // 1. Assert device is online
      assertOnline(actionName);
      return mutationFn(variables);
    },
    onMutate: async (variables: TVariables) => {
      // 2. Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // 3. Snapshot previous data
      const previousData = queryClient.getQueryData<TData>(queryKey);

      // 4. Optimistically update the cache
      queryClient.setQueryData<TData>(queryKey, (old) => updateCache(old, variables));

      // 5. Return context with snapshot
      return { previousData };
    },
    onError: (
      _err: unknown,
      _variables: TVariables,
      context: { previousData: TData | undefined } | undefined,
    ) => {
      // 6. Roll back cache to snapshot on failure
      if (context?.previousData !== undefined) {
        queryClient.setQueryData<TData>(queryKey, context.previousData);
      }
    },
    onSettled: () => {
      // 7. Refetch to sync state
      void queryClient.invalidateQueries({ queryKey });
    },
  };
}
