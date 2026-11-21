import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../src/ui/theme';
import { TeamSwitcher } from '../src/ui/components/TeamSwitcher';
import { useAppStore } from '../src/lib/state/app-store';

/**
 * Root HomeScreen for Rota Mobile (PRD 5.12).
 * Displays active team context, offline capabilities, and shift overview.
 */
export default function HomeScreen() {
  const { theme } = useTheme();
  const isOnline = useAppStore((state) => state.isOnline);
  const activeTeamId = useAppStore((state) => state.activeTeamId);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.color.surface }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.color.primary }]}>Rota</Text>
        <Text style={[styles.subtitle, { color: theme.color.onSurfaceVariant }]}>
          Shift Scheduling for Modern Teams
        </Text>
      </View>

      <TeamSwitcher />

      <View style={[styles.card, { backgroundColor: theme.color.surfaceContainer }]}>
        <Text style={[styles.cardTitle, { color: theme.color.onSurface }]}>
          {activeTeamId ? 'Team Schedule' : 'Welcome to Rota'}
        </Text>
        <Text style={[styles.cardBody, { color: theme.color.onSurfaceVariant }]}>
          {activeTeamId
            ? 'Your team shifts are synchronized and available for offline viewing.'
            : 'Select or switch teams above to view published schedules, request swaps, or manage shifts.'}
        </Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isOnline ? theme.color.success : theme.color.outline },
            ]}
          />
          <Text style={[styles.statusText, { color: theme.color.onSurfaceVariant }]}>
            {isOnline ? 'Online • Auto-syncing' : 'Offline • Reading cached data'}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  header: {
    paddingVertical: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
