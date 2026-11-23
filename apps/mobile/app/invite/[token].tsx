import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api/client';
import { useAppStore } from '../../src/lib/state/app-store';
import { makeStyles } from '../../src/ui/theme/makeStyles';
import { useTheme } from '../../src/ui/theme';

interface InviteDetails {
  teamId: string;
  teamName: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  email: string | null;
  expiresAt: string;
}

interface AcceptInviteResponse {
  ok: boolean;
  teamId: string;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
}

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.color.surface,
    justifyContent: 'center',
    padding: theme.space[6] ?? 24,
  },
  card: {
    backgroundColor: theme.color.surfaceContainer,
    borderRadius: theme.radius.lg,
    padding: theme.space[6] ?? 24,
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
    gap: theme.space[4] ?? 16,
    alignItems: 'center',
  },
  title: {
    fontSize: theme.typography.headlineMedium.fontSize,
    fontWeight: '800',
    color: theme.color.primary,
    textAlign: 'center',
  },
  teamName: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.color.onSurface,
    textAlign: 'center',
  },
  roleText: {
    fontSize: theme.typography.bodyLarge.fontSize,
    color: theme.color.onSurfaceVariant,
    textAlign: 'center',
  },
  btnPrimary: {
    backgroundColor: theme.color.primary,
    paddingVertical: theme.space[3] ?? 14,
    paddingHorizontal: theme.space[6] ?? 24,
    borderRadius: theme.radius.md,
    width: '100%',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  btnPrimaryText: {
    color: theme.color.onPrimary,
    fontWeight: '700',
    fontSize: theme.typography.bodyLarge.fontSize,
  },
  btnSecondary: {
    backgroundColor: theme.color.surfaceContainerHigh,
    paddingVertical: theme.space[3] ?? 14,
    paddingHorizontal: theme.space[6] ?? 24,
    borderRadius: theme.radius.md,
    width: '100%',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  btnSecondaryText: {
    color: theme.color.onSurface,
    fontWeight: '600',
    fontSize: theme.typography.bodyLarge.fontSize,
  },
  errorText: {
    color: theme.color.error,
    fontSize: theme.typography.bodyMedium.fontSize,
    textAlign: 'center',
  },
}));

/**
 * Requirement 3: Deep Link Invite Screen (FR-10).
 */
export default function InviteScreen(): React.JSX.Element {
  const styles = useStyles();
  const { theme } = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();

  const userId = useAppStore((state) => state.userId);
  const setActiveTeam = useAppStore((state) => state.setActiveTeam);

  const [isAccepting, setIsAccepting] = useState(false);

  const {
    data: invite,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['invite', token],
    queryFn: async () => {
      if (!token) throw new Error('Invalid token');
      return api.get<InviteDetails>(`/invites/${token}`, { skipAuth: true });
    },
    enabled: Boolean(token),
  });

  const handleAccept = async () => {
    if (!token) return;
    setIsAccepting(true);

    try {
      const res = await api.post<AcceptInviteResponse>(`/invites/${token}/accept`, {});
      setActiveTeam(res.teamId, res.role);
      Alert.alert('Invitation Accepted', `You have joined ${invite?.teamName ?? 'the team'}!`);
      router.replace('/(tabs)/schedule');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to accept invitation';
      Alert.alert('Error', msg);
    } finally {
      setIsAccepting(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.color.primary} />
      </View>
    );
  }

  if (error || !invite) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Invalid Invite</Text>
          <Text style={styles.errorText}>This invitation link is expired or does not exist.</Text>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={() => router.replace('/(auth)/login')}
          >
            <Text style={styles.btnSecondaryText}>Go to Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Team Invitation</Text>
        <Text style={styles.teamName}>{invite.teamName}</Text>
        <Text style={styles.roleText}>
          You have been invited to join as <Text style={{ fontWeight: '700' }}>{invite.role}</Text>.
        </Text>

        {userId ? (
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => void handleAccept()}
            disabled={isAccepting}
          >
            {isAccepting ? (
              <ActivityIndicator color={theme.color.onPrimary} />
            ) : (
              <Text style={styles.btnPrimaryText}>Accept Invitation</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: '100%', gap: 12 }}>
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={() => router.push('/(auth)/register')}
            >
              <Text style={styles.btnPrimaryText}>Sign Up to Join</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => router.push('/(auth)/login')}
            >
              <Text style={styles.btnSecondaryText}>Sign In to Join</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}
