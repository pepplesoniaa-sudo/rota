import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { api } from '../../src/lib/api/client';
import { queryKeys, STALE_TIMES } from '../../src/lib/query/client';
import { useAppStore } from '../../src/lib/state/app-store';
import { TeamSwitcher } from '../../src/ui/components/TeamSwitcher';
import { makeStyles } from '../../src/ui/theme/makeStyles';
import { useTheme } from '../../src/ui/theme';
import { createOptimisticMutation } from '../../src/lib/offline/mutations';
import { announceToScreenReader } from '../../src/ui/accessibility';

interface ShiftSummary {
  id: string;
  position: string;
  startsAt: string;
  endsAt: string;
}

interface SwapItem {
  id: string;
  teamId: string;
  type: 'TRADE' | 'GIVEAWAY';
  status:
    | 'PENDING_PEER'
    | 'PENDING_MANAGER'
    | 'APPROVED'
    | 'REJECTED'
    | 'DECLINED'
    | 'CANCELED'
    | 'EXPIRED';
  requesterUserId: string;
  requesterShiftId: string;
  targetUserId: string;
  targetShiftId: string | null;
  message: string | null;
  decisionNote: string | null;
  createdAt: string;
  expiresAt: string;
  requesterShift?: ShiftSummary;
}

interface SwapListResponse {
  swaps: SwapItem[];
}

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: theme.space[4] ?? 16,
    paddingVertical: theme.space[2] ?? 8,
    gap: theme.space[2] ?? 8,
  },
  filterChip: {
    paddingHorizontal: theme.space[3] ?? 12,
    paddingVertical: theme.space[1] ?? 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.surfaceContainer,
  },
  filterChipActive: {
    backgroundColor: theme.color.primary,
  },
  filterChipText: {
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '600',
    color: theme.color.onSurfaceVariant,
  },
  filterChipTextActive: {
    color: theme.color.onPrimary,
  },
  listContent: {
    padding: theme.space[4] ?? 16,
    gap: theme.space[3] ?? 12,
  },
  card: {
    backgroundColor: theme.color.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.space[4] ?? 16,
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
    gap: theme.space[2] ?? 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  swapType: {
    fontSize: theme.typography.titleMedium.fontSize,
    fontWeight: '700',
    color: theme.color.onSurface,
  },
  statusBadge: {
    paddingHorizontal: theme.space[2] ?? 8,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
  },
  statusBadgeText: {
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '700',
  },
  detailText: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurfaceVariant,
  },
  messageText: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.color.onSurfaceVariant,
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.space[2] ?? 8,
    marginTop: theme.space[2] ?? 8,
  },
  actionBtn: {
    paddingHorizontal: theme.space[3] ?? 12,
    paddingVertical: theme.space[2] ?? 8,
    borderRadius: theme.radius.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnPrimary: {
    backgroundColor: theme.color.primary,
  },
  actionBtnSecondary: {
    backgroundColor: theme.color.surfaceContainerHigh,
  },
  actionBtnDanger: {
    backgroundColor: theme.color.errorContainer,
  },
  actionBtnText: {
    fontWeight: '600',
    fontSize: theme.typography.bodyMedium.fontSize,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.space[8] ?? 32,
    gap: theme.space[2] ?? 8,
  },
  emptyTitle: {
    fontSize: theme.typography.titleMedium.fontSize,
    fontWeight: '700',
    color: theme.color.onSurface,
  },
  emptySubtitle: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurfaceVariant,
    textAlign: 'center',
  },
}));

/**
 * Requirement 2: Swaps Screen with Optimistic Updates and Rollback.
 */
export default function SwapsScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();

  const activeTeamId = useAppStore((state) => state.activeTeamId);
  const activeRole = useAppStore((state) => state.activeRole);
  const currentUserId = useAppStore((state) => state.userId);

  const [filter, setFilter] = useState<'all' | 'pending' | 'mine'>('all');

  const swapsQueryKey = queryKeys.swaps(activeTeamId ?? '');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: swapsQueryKey,
    queryFn: async () => {
      if (!activeTeamId) return [];
      const res = await api.get<SwapListResponse>(`/teams/${activeTeamId}/swaps`);
      return res.swaps;
    },
    enabled: Boolean(activeTeamId),
    staleTime: STALE_TIMES.swaps,
  });

  const allSwaps = data ?? [];

  // Optimistic Accept Swap Mutation (Requirement 2)
  const acceptMutation = useMutation(
    createOptimisticMutation<SwapItem[], { swapId: string }>({
      queryKey: swapsQueryKey,
      actionName: 'accept swap',
      mutationFn: async ({ swapId }) => {
        const res = await api.post<{ swap: SwapItem }>(
          `/teams/${activeTeamId}/swaps/${swapId}/accept`,
          {},
        );
        return res.swap;
      },
      updateCache: (oldSwaps, { swapId }) => {
        if (!oldSwaps || !Array.isArray(oldSwaps)) return [];
        return oldSwaps.map((s) =>
          s.id === swapId ? { ...s, status: 'PENDING_MANAGER' as const } : s,
        );
      },
    }),
  );

  // Optimistic Approve Swap Mutation for Managers (Requirement 2)
  const approveMutation = useMutation(
    createOptimisticMutation<SwapItem[], { swapId: string }>({
      queryKey: swapsQueryKey,
      actionName: 'approve swap',
      mutationFn: async ({ swapId }) => {
        const res = await api.post<{ swap: SwapItem }>(
          `/teams/${activeTeamId}/swaps/${swapId}/approve`,
          {},
        );
        return res.swap;
      },
      updateCache: (oldSwaps, { swapId }) => {
        if (!oldSwaps || !Array.isArray(oldSwaps)) return [];
        return oldSwaps.map((s) => (s.id === swapId ? { ...s, status: 'APPROVED' as const } : s));
      },
    }),
  );

  // Optimistic Cancel Swap Mutation (Requirement 2)
  const cancelMutation = useMutation(
    createOptimisticMutation<SwapItem[], { swapId: string }>({
      queryKey: swapsQueryKey,
      actionName: 'cancel swap',
      mutationFn: async ({ swapId }) => {
        const res = await api.post<{ swap: SwapItem }>(
          `/teams/${activeTeamId}/swaps/${swapId}/cancel`,
          {},
        );
        return res.swap;
      },
      updateCache: (oldSwaps, { swapId }) => {
        if (!oldSwaps || !Array.isArray(oldSwaps)) return [];
        return oldSwaps.map((s) => (s.id === swapId ? { ...s, status: 'CANCELED' as const } : s));
      },
    }),
  );

  const handleAction = async (action: 'accept' | 'approve' | 'cancel', swapId: string) => {
    try {
      if (action === 'accept') {
        await acceptMutation.mutateAsync({ swapId });
      } else if (action === 'approve') {
        await approveMutation.mutateAsync({ swapId });
      } else if (action === 'cancel') {
        await cancelMutation.mutateAsync({ swapId });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      announceToScreenReader(`Action failed: ${msg}. Restoring previous swap state.`);
      Alert.alert('Action Failed', `${msg}. Reverted to previous state.`);
    }
  };

  const filteredSwaps = allSwaps.filter((s) => {
    if (filter === 'pending') {
      return s.status === 'PENDING_PEER' || s.status === 'PENDING_MANAGER';
    }
    if (filter === 'mine') {
      return s.requesterUserId === currentUserId || s.targetUserId === currentUserId;
    }
    return true;
  });

  const getStatusColor = (status: SwapItem['status']) => {
    switch (status) {
      case 'APPROVED':
        return { bg: theme.color.successContainer, text: theme.color.onSuccessContainer };
      case 'REJECTED':
      case 'DECLINED':
        return { bg: theme.color.errorContainer, text: theme.color.onErrorContainer };
      case 'CANCELED':
      case 'EXPIRED':
        return { bg: theme.color.surfaceContainerHigh, text: theme.color.onSurfaceVariant };
      case 'PENDING_PEER':
      case 'PENDING_MANAGER':
        return { bg: theme.color.warningContainer, text: theme.color.onWarningContainer };
    }
  };

  const renderSwapItem = ({ item }: { item: SwapItem }) => {
    const isRequester = item.requesterUserId === currentUserId;
    const isTarget = item.targetUserId === currentUserId;
    const isManagerOrOwner = activeRole === 'MANAGER' || activeRole === 'OWNER';
    const statusTheme = getStatusColor(item.status);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.swapType}>{item.type} SWAP</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusTheme.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusTheme.text }]}>
              {item.status.replace(/_/g, ' ')}
            </Text>
          </View>
        </View>

        <Text style={styles.detailText}>
          Requested {DateTime.fromISO(item.createdAt).toRelative()}
        </Text>
        {item.message && <Text style={styles.messageText}>"{item.message}"</Text>}

        <View style={styles.actionsRow}>
          {isTarget && item.status === 'PENDING_PEER' && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={() => void handleAction('accept', item.id)}
              disabled={acceptMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel="Accept shift swap request"
            >
              <Text style={[styles.actionBtnText, { color: theme.color.onPrimary }]}>
                {acceptMutation.isPending ? 'Accepting...' : 'Accept Swap'}
              </Text>
            </TouchableOpacity>
          )}

          {isManagerOrOwner && item.status === 'PENDING_MANAGER' && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={() => void handleAction('approve', item.id)}
              disabled={approveMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel="Approve swap as manager"
            >
              <Text style={[styles.actionBtnText, { color: theme.color.onPrimary }]}>
                {approveMutation.isPending ? 'Approving...' : 'Approve'}
              </Text>
            </TouchableOpacity>
          )}

          {isRequester && (item.status === 'PENDING_PEER' || item.status === 'PENDING_MANAGER') && (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDanger]}
              onPress={() => void handleAction('cancel', item.id)}
              disabled={cancelMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel="Cancel swap request"
            >
              <Text style={[styles.actionBtnText, { color: theme.color.onErrorContainer }]}>
                {cancelMutation.isPending ? 'Canceling...' : 'Cancel Request'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TeamSwitcher />

      <View style={styles.filterBar}>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterChipText, filter === 'all' && styles.filterChipTextActive]}>
            All Swaps
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'pending' && styles.filterChipActive]}
          onPress={() => setFilter('pending')}
        >
          <Text
            style={[styles.filterChipText, filter === 'pending' && styles.filterChipTextActive]}
          >
            Pending
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'mine' && styles.filterChipActive]}
          onPress={() => setFilter('mine')}
        >
          <Text style={[styles.filterChipText, filter === 'mine' && styles.filterChipTextActive]}>
            My Swaps
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={theme.color.primary} />
          <Text style={styles.detailText}>Loading shift swaps...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredSwaps}
          keyExtractor={(item) => item.id}
          renderItem={renderSwapItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No Swap Requests</Text>
              <Text style={styles.emptySubtitle}>
                {filter === 'pending'
                  ? 'There are no pending swaps waiting for peer or manager decision.'
                  : 'No shift swap history found for this team.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
