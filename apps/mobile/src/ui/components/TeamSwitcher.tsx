import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../lib/state/app-store';
import { queryKeys } from '../../lib/query/client';
import { apiFetch } from '../../lib/api/client';
import { makeStyles } from '../theme/makeStyles';

interface MyTeamItem {
  id: string;
  name: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  status: string;
}

const useStyles = makeStyles((theme) => ({
  container: {
    paddingHorizontal: theme.space[4] ?? 16,
    paddingVertical: theme.space[2] ?? 8,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.space[3] ?? 12,
    backgroundColor: theme.color.surfaceContainer,
    borderRadius: theme.radius.md,
  },
  teamName: {
    color: theme.color.onSurface,
    fontSize: theme.typography.bodyMedium.fontSize,
    fontWeight: '600',
  },
  roleBadge: {
    backgroundColor: theme.color.secondaryContainer,
    paddingHorizontal: theme.space[2] ?? 8,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
  },
  roleText: {
    color: theme.color.onSecondaryContainer,
    fontSize: theme.typography.caption.fontSize,
    fontWeight: '500',
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
    padding: theme.space[4] ?? 16,
    maxHeight: 400,
  },
  modalTitle: {
    color: theme.color.onSurface,
    fontSize: theme.typography.titleMedium.fontSize,
    fontWeight: '700',
    marginBottom: theme.space[3] ?? 12,
  },
  teamItem: {
    paddingVertical: theme.space[3] ?? 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.outlineVariant,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamItemActive: {
    backgroundColor: theme.color.surfaceContainerHigh,
  },
  closeButton: {
    marginTop: theme.space[4] ?? 16,
    alignItems: 'center',
    padding: theme.space[3] ?? 12,
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
  },
  closeButtonText: {
    color: theme.color.onPrimary,
    fontWeight: '600',
  },
}));

/**
 * FR-08 UI: Team switcher allowing user to switch between their active teams.
 */
export function TeamSwitcher(): React.JSX.Element {
  const styles = useStyles();
  const [modalVisible, setModalVisible] = useState(false);

  const activeTeamId = useAppStore((state) => state.activeTeamId);
  const activeRole = useAppStore((state) => state.activeRole);
  const setActiveTeam = useAppStore((state) => state.setActiveTeam);

  const { data } = useQuery({
    queryKey: queryKeys.myTeams(),
    queryFn: () => apiFetch<{ teams: MyTeamItem[] }>('/v1/me/teams'),
  });

  const teams = data?.teams ?? [];
  const currentTeam = teams.find((t) => t.id === activeTeamId);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setModalVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Switch active team"
      >
        <Text style={styles.teamName}>{currentTeam?.name ?? 'Select Team'}</Text>
        {activeRole ? (
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{activeRole}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Team</Text>
            <FlatList
              data={teams}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const isSelected = item.id === activeTeamId;
                return (
                  <TouchableOpacity
                    style={[styles.teamItem, isSelected ? styles.teamItemActive : null]}
                    onPress={() => {
                      setActiveTeam(item.id, item.role);
                      setModalVisible(false);
                    }}
                  >
                    <Text style={styles.teamName}>{item.name}</Text>
                    <View style={styles.roleBadge}>
                      <Text style={styles.roleText}>{item.role}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
            <TouchableOpacity style={styles.closeButton} onPress={() => setModalVisible(false)}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
