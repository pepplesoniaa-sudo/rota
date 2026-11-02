import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Slot } from 'expo-router';
import { ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider, useTheme, getNavigationTheme } from '../src/ui/theme';
import { queryClient, queryPersister, MAX_OFFLINE_CACHE_AGE_MS } from '../src/lib/query/client';
import { useAppStore } from '../src/lib/state/app-store';
import { OfflineBanner } from '../src/ui/components/OfflineBanner';

function NavigationThemeBridge({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const navigationTheme = getNavigationTheme(theme);

  return <NavigationThemeProvider value={navigationTheme}>{children}</NavigationThemeProvider>;
}

const styles = StyleSheet.create({
  // L-2: Phone layout on tablets with 720-point max content width
  tabletConstraint: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
});

/**
 * Root Expo Router layout:
 * - Mounts TanStack Query PersistQueryClientProvider with AsyncStorage persister (L-3).
 * - Sets maxAge 14 days and user-id cache buster per FR-32 and PRD 7.7.
 * - Mounts Rota ThemeProvider at root.
 * - Passes reactive navigation theme to Expo Router.
 * - Mounts FR-32 OfflineBanner.
 * - Enforces L-2 720-point max content width on tablets.
 */
export default function RootLayout() {
  const userId = useAppStore((state) => state.userId);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: MAX_OFFLINE_CACHE_AGE_MS,
        buster: userId ?? '',
      }}
    >
      <ThemeProvider>
        <NavigationThemeBridge>
          <View style={styles.tabletConstraint}>
            <OfflineBanner />
            <Slot />
          </View>
        </NavigationThemeBridge>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
