import React from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { api } from '../../src/lib/api/client';
import { queryKeys, STALE_TIMES } from '../../src/lib/query/client';
import { useAppStore } from '../../src/lib/state/app-store';
import { TeamSwitcher } from '../../src/ui/components/TeamSwitcher';
import { makeStyles } from '../../src/ui/theme/makeStyles';
import { useTheme } from '../../src/ui/theme';

interface FeedEventItem {
  id: string;
  teamId: string;
  type: string;
  actorUserId: string | null;
  subjectShiftId?: string | null;
  subjectUserId?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface FeedApiResponse {
  events: FeedEventItem[];
  nextCursor: string | null;
}

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
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
    gap: theme.space[1] ?? 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventTypeBadge: {
    backgroundColor: theme.color.secondaryContainer,
    paddingHorizontal: theme.space[2] ?? 8,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
  },
  eventTypeText: {
    color: theme.color.onSecondaryContainer,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '700',
  },
  timeAgo: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.color.onSurfaceVariant,
  },
  eventDescription: {
    fontSize: theme.typography.bodyLarge.fontSize,
    fontWeight: '600',
    color: theme.color.onSurface,
    marginTop: theme.space[1] ?? 4,
  },
  eventDetails: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurfaceVariant,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space[6] ?? 24,
    gap: theme.space[2] ?? 8,
  },
  errorText: {
    color: theme.color.error,
    fontSize: theme.typography.bodyMedium.fontSize,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: theme.color.primary,
    paddingHorizontal: theme.space[4] ?? 16,
    paddingVertical: theme.space[2] ?? 8,
    borderRadius: theme.radius.md,
    marginTop: theme.space[2] ?? 8,
  },
  retryButtonText: {
    color: theme.color.onPrimary,
    fontWeight: '600',
  },
  footerLoader: {
    paddingVertical: theme.space[4] ?? 16,
    alignItems: 'center',
  },
  endOfListText: {
    textAlign: 'center',
    color: theme.color.onSurfaceVariant,
    fontSize: theme.typography.caption.fontSize,
    paddingVertical: theme.space[4] ?? 16,
    fontWeight: '500',
  },
}));

function formatFeedEventTitle(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'SHIFT_CREATED':
      return `New Shift: ${String(payload.position ?? 'Shift')}`;
    case 'SHIFT_CHANGED':
      return `Shift Updated: ${String(payload.position ?? 'Shift')}`;
    case 'SHIFT_SWAPPED':
      return 'Shift Swap Completed';
    case 'MEMBER_JOINED':
      return 'New Team Member Joined';
    case 'SCHEDULE_PUBLISHED':
      return 'Schedule Published';
    default:
      return type.replace(/_/g, ' ');
  }
}

/**
 * Requirement 1: Cursor Pagination Activity Feed.
 *
 * FlatList Written Reason (Requirement 1):
 * FlatList is used rather than FlashList because FlatList is natively integrated into React Native
 * core, ensuring identical zero-dependency execution across iOS, Android, and Web platforms without
 * requiring separate compilation of third-party C++ binary packages in Expo managed/Go environments.
 * It is tuned with `initialNumToRender={10}`, `maxToRenderPerBatch={10}`, and `windowSize={5}` for
 * smooth 60fps virtualization even with thousands of records.
 */
export default function FeedScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();

  const activeTeamId = useAppStore((state) => state.activeTeamId);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: queryKeys.feed(activeTeamId ?? ''),
    queryFn: async ({ pageParam }) => {
      if (!activeTeamId) return { events: [], nextCursor: null };
      const cursorParam = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : '';
      return api.get<FeedApiResponse>(`/teams/${activeTeamId}/feed?limit=20${cursorParam}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(activeTeamId),
    staleTime: STALE_TIMES.feed,
  });

  const allEvents = data?.pages.flatMap((page) => page.events) ?? [];

  // Prevent duplicate requests when user scrolls fast
  const handleEndReached = () => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  };

  const renderItem = ({ item }: { item: FeedEventItem }) => {
    const timeFormatted = DateTime.fromISO(item.createdAt).toRelative() ?? 'Recently';
    const title = formatFeedEventTitle(item.type, item.payload);

    return (
      <View style={styles.card} accessible={true} accessibilityLabel={`${title}, ${timeFormatted}`}>
        <View style={styles.cardHeader}>
          <View style={styles.eventTypeBadge}>
            <Text style={styles.eventTypeText}>{item.type.replace(/_/g, ' ')}</Text>
          </View>
          <Text style={styles.timeAgo}>{timeFormatted}</Text>
        </View>
        <Text style={styles.eventDescription}>{title}</Text>
        {item.payload.notes ? (
          <Text style={styles.eventDetails}>"{String(item.payload.notes)}"</Text>
        ) : null}
      </View>
    );
  };

  const renderFooter = () => {
    if (isFetchingNextPage) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={theme.color.primary} />
        </View>
      );
    }
    if (!hasNextPage && allEvents.length > 0) {
      return (
        <Text style={styles.endOfListText}>✓ You have reached the end of the activity feed.</Text>
      );
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <TeamSwitcher />

      {!activeTeamId ? (
        <View style={styles.centerContainer}>
          <Text style={styles.eventDescription}>Select a Team</Text>
          <Text style={styles.eventDetails}>
            Choose a team from the dropdown above to view its activity feed.
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.color.primary} />
          <Text style={styles.eventDetails}>Loading activity feed...</Text>
        </View>
      ) : isError ? (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Failed to load activity feed'}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void refetch()}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={allEvents}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
          ListFooterComponent={renderFooter}
          ListEmptyComponent={
            <View style={styles.centerContainer}>
              <Text style={styles.eventDescription}>No Activity Yet</Text>
              <Text style={styles.eventDetails}>
                New shifts, swaps, and team updates will appear here in chronological order.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
