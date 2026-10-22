import React from 'react';
import { Slot } from 'expo-router';
import { ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { ThemeProvider, useTheme, getNavigationTheme } from '../src/ui/theme';

function NavigationThemeBridge({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const navigationTheme = getNavigationTheme(theme);

  return <NavigationThemeProvider value={navigationTheme}>{children}</NavigationThemeProvider>;
}

/**
 * Root Expo Router layout:
 * - Mounts Rota ThemeProvider at the root.
 * - Passes the reactive Theme-derived navigation theme to Expo Router.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <NavigationThemeBridge>
        <Slot />
      </NavigationThemeBridge>
    </ThemeProvider>
  );
}
