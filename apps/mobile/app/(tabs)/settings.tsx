import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Switch,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { api, handleLogout } from '../../src/lib/api/client';
import { queryKeys, STALE_TIMES } from '../../src/lib/query/client';
import { makeStyles } from '../../src/ui/theme/makeStyles';
import { useTheme } from '../../src/ui/theme';
import { createOptimisticMutation } from '../../src/lib/offline/mutations';
import { announceToScreenReader } from '../../src/ui/accessibility';

interface UserSettings {
  userId: string;
  timezone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  notifyShiftChanges: boolean;
  notifySwaps: boolean;
  notifyMemberJoined: boolean;
  notifyShiftReminders: boolean;
  quietAfterNightShift: boolean;
  use24HourClock: boolean;
  weekStartsOn: number;
  version: number;
  updatedAt: string;
}

interface SettingsApiResponse {
  settings: UserSettings;
}

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
  },
  content: {
    padding: theme.space[4] ?? 16,
    gap: theme.space[5] ?? 20,
  },
  section: {
    backgroundColor: theme.color.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.space[4] ?? 16,
    gap: theme.space[3] ?? 12,
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
  },
  sectionTitle: {
    fontSize: theme.typography.titleMedium.fontSize,
    fontWeight: '700',
    color: theme.color.primary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space[2] ?? 8,
  },
  rowTextContainer: {
    flex: 1,
    marginRight: theme.space[3] ?? 12,
  },
  rowLabel: {
    fontSize: theme.typography.bodyLarge.fontSize,
    fontWeight: '600',
    color: theme.color.onSurface,
  },
  rowSubLabel: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.color.onSurfaceVariant,
    marginTop: 2,
  },
  input: {
    backgroundColor: theme.color.surface,
    color: theme.color.onSurface,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space[3] ?? 12,
    paddingVertical: theme.space[2] ?? 8,
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
    fontSize: theme.typography.bodyMedium.fontSize,
    minHeight: 44,
  },
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3] ?? 12,
  },
  timeInputBox: {
    flex: 1,
    gap: 4,
  },
  timeInputLabel: {
    fontSize: theme.typography.caption.fontSize,
    color: theme.color.onSurfaceVariant,
    fontWeight: '500',
  },
  logoutSection: {
    gap: theme.space[3] ?? 12,
    marginTop: theme.space[2] ?? 8,
  },
  logoutBtn: {
    backgroundColor: theme.color.surfaceContainerHigh,
    paddingVertical: theme.space[3] ?? 12,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  logoutBtnText: {
    color: theme.color.onSurface,
    fontWeight: '600',
    fontSize: theme.typography.bodyMedium.fontSize,
  },
  logoutAllBtn: {
    backgroundColor: theme.color.errorContainer,
    paddingVertical: theme.space[3] ?? 12,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  logoutAllBtnText: {
    color: theme.color.onErrorContainer,
    fontWeight: '700',
    fontSize: theme.typography.bodyMedium.fontSize,
  },
}));

function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function timeStringToMinutes(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0] ?? '0', 10) || 0;
  const m = parseInt(parts[1] ?? '0', 10) || 0;
  return Math.min(1439, Math.max(0, h * 60 + m));
}

/**
 * Requirement 7: Settings Coordination Screen.
 * Uses optimistic updates with rollback when settings change.
 */
export default function SettingsScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();
  const router = useRouter();

  const settingsQueryKey = queryKeys.settings();

  const { data, isLoading } = useQuery({
    queryKey: settingsQueryKey,
    queryFn: async () => {
      const res = await api.get<SettingsApiResponse>('/me/settings');
      return res.settings;
    },
    staleTime: STALE_TIMES.settings,
  });

  const [timezone, setTimezone] = useState('');
  const [quietStartStr, setQuietStartStr] = useState('22:00');
  const [quietEndStr, setQuietEndStr] = useState('06:00');

  useEffect(() => {
    if (data) {
      setTimezone(data.timezone);
      setQuietStartStr(minutesToTimeString(data.quietStartMinute ?? 1320));
      setQuietEndStr(minutesToTimeString(data.quietEndMinute ?? 360));
    }
  }, [data]);

  // Optimistic settings update mutation with rollback (Requirement 7 & 2)
  const updateSettingsMutation = useMutation(
    createOptimisticMutation<UserSettings, Partial<UserSettings>>({
      queryKey: settingsQueryKey,
      actionName: 'update settings',
      mutationFn: async (patch) => {
        const currentVersion = data?.version ?? 1;
        const res = await api.patch<SettingsApiResponse>('/me/settings', {
          ...patch,
          version: currentVersion,
        });
        return res.settings;
      },
      updateCache: (oldSettings, patch) => {
        if (!oldSettings) return patch as UserSettings;
        return {
          ...oldSettings,
          ...patch,
          version: oldSettings.version + 1,
        };
      },
    }),
  );

  const handleToggle = (key: keyof UserSettings, currentValue: boolean) => {
    updateSettingsMutation.mutate(
      { [key]: !currentValue },
      {
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Error';
          announceToScreenReader(`Failed to update setting: ${msg}. Reverted.`);
          Alert.alert('Update Failed', msg);
        },
      },
    );
  };

  const handleSaveTimes = () => {
    const startMin = timeStringToMinutes(quietStartStr);
    const endMin = timeStringToMinutes(quietEndStr);

    updateSettingsMutation.mutate(
      {
        quietStartMinute: startMin,
        quietEndMinute: endMin,
      },
      {
        onSuccess: () => {
          Alert.alert('Saved', 'Quiet hours updated successfully.');
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Error';
          Alert.alert('Update Failed', msg);
        },
      },
    );
  };

  const handleSaveTimezone = () => {
    if (!timezone.trim()) return;
    updateSettingsMutation.mutate(
      { timezone: timezone.trim() },
      {
        onSuccess: () => {
          Alert.alert('Saved', 'Timezone updated.');
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Error';
          Alert.alert('Update Failed', msg);
        },
      },
    );
  };

  const onLogoutSingle = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out from this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await handleLogout();
            router.replace('/(auth)/login');
          })();
        },
      },
    ]);
  };

  const onLogoutAll = () => {
    Alert.alert(
      'Log Out All Devices',
      'This will invalidate all active sessions across all your phones and computers. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out All',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await api.post('/auth/logout-all', {});
              } catch {
                // Ignore network errors, proceed with local logout
              }
              await handleLogout();
              router.replace('/(auth)/login');
            })();
          },
        },
      ],
    );
  };

  if (isLoading || !data) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.color.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Quiet Hours Coordination */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quiet Hours (Server-Enforced)</Text>
        <View style={styles.row}>
          <View style={styles.rowTextContainer}>
            <Text style={styles.rowLabel}>Enable Quiet Hours</Text>
            <Text style={styles.rowSubLabel}>
              Push notifications are silenced on the server during these hours in your time zone
            </Text>
          </View>
          <Switch
            value={data.quietHoursEnabled}
            onValueChange={() => handleToggle('quietHoursEnabled', data.quietHoursEnabled)}
            trackColor={{ false: theme.color.outlineVariant, true: theme.color.primary }}
          />
        </View>

        {data.quietHoursEnabled && (
          <View style={{ gap: 8 }}>
            <View style={styles.timeInputRow}>
              <View style={styles.timeInputBox}>
                <Text style={styles.timeInputLabel}>Start Time (HH:MM)</Text>
                <TextInput
                  style={styles.input}
                  value={quietStartStr}
                  onChangeText={setQuietStartStr}
                  placeholder="22:00"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.timeInputBox}>
                <Text style={styles.timeInputLabel}>End Time (HH:MM)</Text>
                <TextInput
                  style={styles.input}
                  value={quietEndStr}
                  onChangeText={setQuietEndStr}
                  placeholder="06:00"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <TouchableOpacity
              style={[styles.logoutBtn, { minHeight: 40, marginTop: 4 }]}
              onPress={handleSaveTimes}
            >
              <Text style={styles.logoutBtnText}>Save Quiet Hours</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Timezone Preference */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Timezone</Text>
        <TextInput
          style={styles.input}
          value={timezone}
          onChangeText={setTimezone}
          placeholder="e.g. America/Chicago"
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={[styles.logoutBtn, { minHeight: 40 }]}
          onPress={handleSaveTimezone}
        >
          <Text style={styles.logoutBtnText}>Update Timezone</Text>
        </TouchableOpacity>
      </View>

      {/* Notification Category Preferences */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notification Preferences</Text>

        <View style={styles.row}>
          <View style={styles.rowTextContainer}>
            <Text style={styles.rowLabel}>Shift Changes</Text>
            <Text style={styles.rowSubLabel}>Alerts when your shifts are edited or published</Text>
          </View>
          <Switch
            value={data.notifyShiftChanges}
            onValueChange={() => handleToggle('notifyShiftChanges', data.notifyShiftChanges)}
            trackColor={{ false: theme.color.outlineVariant, true: theme.color.primary }}
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowTextContainer}>
            <Text style={styles.rowLabel}>Swap Requests</Text>
            <Text style={styles.rowSubLabel}>Alerts for swap offers, approvals, and declines</Text>
          </View>
          <Switch
            value={data.notifySwaps}
            onValueChange={() => handleToggle('notifySwaps', data.notifySwaps)}
            trackColor={{ false: theme.color.outlineVariant, true: theme.color.primary }}
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowTextContainer}>
            <Text style={styles.rowLabel}>Team Announcements</Text>
            <Text style={styles.rowSubLabel}>Alerts when new coworkers join the team</Text>
          </View>
          <Switch
            value={data.notifyMemberJoined}
            onValueChange={() => handleToggle('notifyMemberJoined', data.notifyMemberJoined)}
            trackColor={{ false: theme.color.outlineVariant, true: theme.color.primary }}
          />
        </View>
      </View>

      {/* Account & Session Management */}
      <View style={styles.logoutSection}>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={onLogoutSingle}
          accessibilityRole="button"
          accessibilityLabel="Sign out of current device"
        >
          <Text style={styles.logoutBtnText}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutAllBtn}
          onPress={onLogoutAll}
          accessibilityRole="button"
          accessibilityLabel="Log out of all devices"
        >
          <Text style={styles.logoutAllBtnText}>Log Out of All Devices</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
