import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { initializeAuth } from '../src/lib/api/client';
import { useTheme } from '../src/ui/theme';

/**
 * Entry Gatekeeper Screen for Rota Mobile (PRD 5.12).
 * Inspects persisted credentials on cold start (FR-32):
 * - If session is valid or offline cache exists -> routes to /(tabs)/schedule
 * - If unauthenticated -> routes to /(auth)/login
 */
export default function AppEntryScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const router = useRouter();
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkAuthSession() {
      try {
        const { status } = await initializeAuth();
        if (!isMounted) return;

        if (status === 'authenticated' || status === 'offline') {
          router.replace('/(tabs)/schedule');
        } else {
          router.replace('/(auth)/login');
        }
      } catch {
        if (isMounted) {
          router.replace('/(auth)/login');
        }
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    }

    void checkAuthSession();

    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: theme.color.surface }]}>
      <View style={styles.brandingBox}>
        <Text style={[styles.title, { color: theme.color.primary }]}>Rota</Text>
        <Text style={[styles.subtitle, { color: theme.color.onSurfaceVariant }]}>
          Shift Scheduling for Modern Teams
        </Text>
      </View>
      {isInitializing && (
        <ActivityIndicator size="large" color={theme.color.primary} style={styles.spinner} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  brandingBox: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
  spinner: {
    marginTop: 32,
  },
});
