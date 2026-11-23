import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { api } from '../../src/lib/api/client';
import { queryKeys, STALE_TIMES } from '../../src/lib/query/client';
import { useAppStore } from '../../src/lib/state/app-store';
import { TeamSwitcher } from '../../src/ui/components/TeamSwitcher';
import { makeStyles } from '../../src/ui/theme/makeStyles';
import { useTheme } from '../../src/ui/theme';
import { formatShiftAccessibilityLabel } from '../../src/ui/accessibility';

interface ShiftItem {
  id: string;
  teamId: string;
  assigneeUserId: string;
  startsAt: string;
  endsAt: string;
  startsLocal: string;
  endsLocal: string;
  position: string;
  location: string | null;
  notes: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  version: number;
}

interface TeamMember {
  id: string;
  userId: string;
  role: string;
  user: {
    id: string;
    displayName: string;
    email: string;
  };
}

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
  },
  headerControls: {
    paddingHorizontal: theme.space[4] ?? 16,
    paddingBottom: theme.space[2] ?? 8,
    gap: theme.space[2] ?? 8,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: theme.color.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: theme.space[2] ?? 8,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
  },
  tabButtonActive: {
    backgroundColor: theme.color.surface,
  },
  tabText: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurfaceVariant,
    fontWeight: '600',
  },
  tabTextActive: {
    color: theme.color.primary,
  },
  publishBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.secondaryContainer,
    paddingHorizontal: theme.space[3] ?? 12,
    paddingVertical: theme.space[2] ?? 8,
    borderRadius: theme.radius.md,
  },
  publishText: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.color.onSecondaryContainer,
    fontWeight: '600',
  },
  publishBtn: {
    backgroundColor: theme.color.secondary,
    paddingHorizontal: theme.space[3] ?? 12,
    paddingVertical: theme.space[1] ?? 4,
    borderRadius: theme.radius.sm,
  },
  publishBtnText: {
    color: theme.color.onSecondary,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '700',
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
  positionTitle: {
    fontSize: theme.typography.titleMedium.fontSize,
    fontWeight: '700',
    color: theme.color.onSurface,
  },
  badge: {
    paddingHorizontal: theme.space[2] ?? 8,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
  },
  badgePublished: {
    backgroundColor: theme.color.successContainer,
  },
  badgeDraft: {
    backgroundColor: theme.color.warningContainer,
  },
  badgeTextPublished: {
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '600',
    color: theme.color.onSuccessContainer,
  },
  badgeTextDraft: {
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '600',
    color: theme.color.onWarningContainer,
  },
  timeText: {
    fontSize: theme.typography.bodyLarge.fontSize,
    fontWeight: '600',
    color: theme.color.primary,
  },
  detailsText: {
    fontSize: theme.typography.bodyMedium.fontSize,
    color: theme.color.onSurfaceVariant,
  },
  notesText: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.color.onSurfaceVariant,
    fontStyle: 'italic',
  },
  cardFooter: {
    marginTop: theme.space[2] ?? 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  swapButton: {
    backgroundColor: theme.color.primary,
    paddingHorizontal: theme.space[3] ?? 12,
    paddingVertical: theme.space[2] ?? 8,
    borderRadius: theme.radius.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swapButtonText: {
    color: theme.color.onPrimary,
    fontWeight: '600',
    fontSize: theme.typography.bodyMedium.fontSize,
  },
  emptyContainer: {
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
    paddingHorizontal: theme.space[4] ?? 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: theme.space[4] ?? 16,
  },
  modalContent: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space[5] ?? 20,
    gap: theme.space[3] ?? 12,
  },
  modalTitle: {
    fontSize: theme.typography.titleLarge.fontSize,
    fontWeight: '700',
    color: theme.color.onSurface,
  },
  input: {
    backgroundColor: theme.color.surfaceContainer,
    color: theme.color.onSurface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space[3] ?? 12,
    paddingVertical: theme.space[3] ?? 10,
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.space[2] ?? 8,
    marginTop: theme.space[2] ?? 8,
  },
  modalBtnCancel: {
    paddingHorizontal: theme.space[4] ?? 16,
    paddingVertical: theme.space[2] ?? 8,
    borderRadius: theme.radius.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  modalBtnConfirm: {
    backgroundColor: theme.color.primary,
    paddingHorizontal: theme.space[4] ?? 16,
    paddingVertical: theme.space[2] ?? 8,
    borderRadius: theme.radius.md,
    minHeight: 44,
    justifyContent: 'center',
  },
}));

export default function ScheduleScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();
  const qc = useQueryClient();

  const activeTeamId = useAppStore((state) => state.activeTeamId);
  const activeRole = useAppStore((state) => state.activeRole);
  const isOnline = useAppStore((state) => state.isOnline);
  const setLastSynced = useAppStore((state) => state.setLastSynced);

  const [activeTab, setActiveTab] = useState<'mine' | 'team'>('mine');
  const [selectedShiftForSwap, setSelectedShiftForSwap] = useState<ShiftItem | null>(null);
  const [targetUserId, setTargetUserId] = useState('');
  const [swapNote, setSwapNote] = useState('');
  const [isSubmittingSwap, setIsSubmittingSwap] = useState(false);

  // My shifts query (staleTime: 60s per L-32)
  const myShiftsQuery = useQuery({
    queryKey: queryKeys.myShifts(),
    queryFn: async () => {
      const data = await api.get<{ shifts: ShiftItem[] }>('/me/shifts');
      setLastSynced(new Date());
      return data.shifts;
    },
    staleTime: STALE_TIMES.myShifts,
    enabled: activeTab === 'mine',
  });

  // Team shifts query (staleTime: 60s per L-32)
  const today = DateTime.now().toISODate() ?? '2026-11-01';
  const twoWeeksLater = DateTime.now().plus({ days: 14 }).toISODate() ?? '2026-11-15';

  const teamShiftsQuery = useQuery({
    queryKey: queryKeys.teamSchedule(activeTeamId ?? '', today, twoWeeksLater),
    queryFn: async () => {
      if (!activeTeamId) return [];
      const data = await api.get<{ shifts: ShiftItem[] }>(
        `/teams/${activeTeamId}/shifts?from=${today}&to=${twoWeeksLater}`,
      );
      setLastSynced(new Date());
      return data.shifts;
    },
    staleTime: STALE_TIMES.teamSchedule,
    enabled: activeTab === 'team' && Boolean(activeTeamId),
  });

  // Team members list for swap recipient selection
  const teamMembersQuery = useQuery({
    queryKey: queryKeys.teamMembers(activeTeamId ?? ''),
    queryFn: async () => {
      if (!activeTeamId) return [];
      const data = await api.get<{ members: TeamMember[] }>(`/teams/${activeTeamId}/members`);
      return data.members;
    },
    enabled: Boolean(activeTeamId && selectedShiftForSwap),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!activeTeamId) return;
      await api.post(`/teams/${activeTeamId}/shifts/publish`, {
        from: today,
        to: twoWeeksLater,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.teamSchedule(activeTeamId ?? '', today, twoWeeksLater),
      });
      Alert.alert('Success', 'Draft shifts have been published to the team.');
    },
    onError: (err: Error) => {
      Alert.alert('Publish Failed', err.message);
    },
  });

  const handleCreateSwap = async () => {
    if (!selectedShiftForSwap || !activeTeamId) return;
    if (!targetUserId) {
      Alert.alert('Selection Required', 'Please enter or select a coworker target user ID.');
      return;
    }

    setIsSubmittingSwap(true);
    try {
      await api.post(`/teams/${activeTeamId}/swaps`, {
        requesterShiftId: selectedShiftForSwap.id,
        targetUserId: targetUserId.trim(),
        message: swapNote.trim() || undefined,
      });

      Alert.alert('Swap Requested', 'Your swap request has been sent to your coworker.');
      setSelectedShiftForSwap(null);
      setTargetUserId('');
      setSwapNote('');
      void qc.invalidateQueries({ queryKey: queryKeys.swaps(activeTeamId) });
      void qc.invalidateQueries({ queryKey: queryKeys.myShifts() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to request swap';
      Alert.alert('Error', msg);
    } finally {
      setIsSubmittingSwap(false);
    }
  };

  const currentQuery = activeTab === 'mine' ? myShiftsQuery : teamShiftsQuery;
  const shifts = currentQuery.data ?? [];
  const isLoading = currentQuery.isLoading;
  const isRefreshing = currentQuery.isRefetching;

  const canPublish =
    Boolean(activeTeamId) &&
    (activeRole === 'OWNER' || activeRole === 'MANAGER') &&
    activeTab === 'team';

  const renderShiftItem = ({ item }: { item: ShiftItem }) => {
    const start = DateTime.fromISO(item.startsAt);
    const end = DateTime.fromISO(item.endsAt);
    const dateLabel = start.toFormat('EEE, MMM d, yyyy');
    const timeLabel = `${start.toFormat('h:mm a')} - ${end.toFormat('h:mm a')}`;

    const accessibilityLabel = formatShiftAccessibilityLabel({
      position: item.position,
      startsAt: new Date(item.startsAt),
      endsAt: new Date(item.endsAt),
      timezone: 'UTC',
      teamName: 'Rota Team',
    });

    return (
      <View style={styles.card} accessible={true} accessibilityLabel={accessibilityLabel}>
        <View style={styles.cardHeader}>
          <Text style={styles.positionTitle}>{item.position}</Text>
          <View
            style={[
              styles.badge,
              item.status === 'PUBLISHED' ? styles.badgePublished : styles.badgeDraft,
            ]}
          >
            <Text
              style={
                item.status === 'PUBLISHED' ? styles.badgeTextPublished : styles.badgeTextDraft
              }
            >
              {item.status}
            </Text>
          </View>
        </View>

        <Text style={styles.timeText}>{timeLabel}</Text>
        <Text style={styles.detailsText}>{dateLabel}</Text>
        {item.location && <Text style={styles.detailsText}>📍 {item.location}</Text>}
        {item.notes && <Text style={styles.notesText}>"{item.notes}"</Text>}

        {activeTab === 'mine' && (
          <View style={styles.cardFooter}>
            <TouchableOpacity
              style={styles.swapButton}
              onPress={() => setSelectedShiftForSwap(item)}
              accessibilityRole="button"
              accessibilityLabel={`Request swap for ${item.position} shift`}
            >
              <Text style={styles.swapButtonText}>Request Swap</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TeamSwitcher />

      <View style={styles.headerControls}>
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'mine' && styles.tabButtonActive]}
            onPress={() => setActiveTab('mine')}
            accessibilityRole="tab"
            accessibilityLabel="My Shifts"
          >
            <Text style={[styles.tabText, activeTab === 'mine' && styles.tabTextActive]}>
              My Shifts
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'team' && styles.tabButtonActive]}
            onPress={() => setActiveTab('team')}
            accessibilityRole="tab"
            accessibilityLabel="Team Schedule"
          >
            <Text style={[styles.tabText, activeTab === 'team' && styles.tabTextActive]}>
              Team Schedule
            </Text>
          </TouchableOpacity>
        </View>

        {canPublish && (
          <View style={styles.publishBar}>
            <Text style={styles.publishText}>Manager: Ready to publish schedule?</Text>
            <TouchableOpacity
              style={styles.publishBtn}
              onPress={() => publishMutation.mutate()}
              disabled={publishMutation.isPending || !isOnline}
            >
              <Text style={styles.publishBtnText}>
                {publishMutation.isPending ? 'Publishing...' : 'Publish'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={theme.color.primary} />
          <Text style={styles.detailsText}>Loading shifts...</Text>
        </View>
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={(item) => item.id}
          renderItem={renderShiftItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void currentQuery.refetch()}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No Shifts Found</Text>
              <Text style={styles.emptySubtitle}>
                {activeTab === 'mine'
                  ? 'You have no assigned shifts for this period.'
                  : 'No published shifts scheduled for this team.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Swap Request Modal */}
      <Modal
        visible={Boolean(selectedShiftForSwap)}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSelectedShiftForSwap(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Request Shift Swap</Text>
            <Text style={styles.detailsText}>
              Shift: {selectedShiftForSwap?.position} (
              {selectedShiftForSwap &&
                DateTime.fromISO(selectedShiftForSwap.startsAt).toFormat('EEE, MMM d')}
              )
            </Text>

            <Text style={styles.detailsText}>Coworker User ID / Recipient:</Text>
            <TextInput
              style={styles.input}
              placeholder="Paste target coworker UUID"
              placeholderTextColor={theme.color.onSurfaceVariant}
              value={targetUserId}
              onChangeText={setTargetUserId}
              autoCapitalize="none"
            />

            {teamMembersQuery.data && teamMembersQuery.data.length > 0 && (
              <View style={{ gap: 4 }}>
                <Text style={styles.notesText}>Quick pick team member:</Text>
                <FlatList
                  data={teamMembersQuery.data.slice(0, 4)}
                  horizontal
                  keyExtractor={(m) => m.id}
                  renderItem={({ item: m }) => (
                    <TouchableOpacity
                      style={{
                        backgroundColor: theme.color.surfaceContainerHigh,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        marginRight: 6,
                      }}
                      onPress={() => setTargetUserId(m.userId)}
                    >
                      <Text style={{ fontSize: 12, color: theme.color.primary }}>
                        {m.user?.displayName || m.user?.email || 'Member'}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            <Text style={styles.detailsText}>Note / Message (optional):</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Can you cover my Friday evening shift?"
              placeholderTextColor={theme.color.onSurfaceVariant}
              value={swapNote}
              onChangeText={setSwapNote}
              maxLength={280}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalBtnCancel}
                onPress={() => setSelectedShiftForSwap(null)}
                disabled={isSubmittingSwap}
              >
                <Text style={{ color: theme.color.onSurfaceVariant, fontWeight: '600' }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnConfirm}
                onPress={() => void handleCreateSwap()}
                disabled={isSubmittingSwap}
              >
                {isSubmittingSwap ? (
                  <ActivityIndicator color={theme.color.onPrimary} />
                ) : (
                  <Text style={{ color: theme.color.onPrimary, fontWeight: '700' }}>
                    Send Request
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
