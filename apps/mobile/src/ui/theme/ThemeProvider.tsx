import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme as useDeviceColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import type { Theme } from '../tokens/resolve';
import { lightTheme, darkTheme } from '../tokens/resolve';
import type { ColorSchemeName, ThemeContextValue, ThemePreference } from './types';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  children: React.ReactNode;
  initialPreference?: ThemePreference;
}

/**
 * Root ThemeProvider component that binds system color scheme,
 * synchronizes root UI background color, and controls the status bar.
 */
export function ThemeProvider({ children, initialPreference = 'system' }: ThemeProviderProps) {
  const deviceScheme = useDeviceColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialPreference);

  const activeColorScheme: ColorSchemeName = useMemo(() => {
    if (themePreference === 'light') return 'light';
    if (themePreference === 'dark') return 'dark';
    return deviceScheme === 'dark' ? 'dark' : 'light';
  }, [themePreference, deviceScheme]);

  const activeTheme: Theme = activeColorScheme === 'dark' ? darkTheme : lightTheme;

  // Synchronize native root view background color to prevent white flashes on launch and transitions
  useEffect(() => {
    try {
      void SystemUI.setBackgroundColorAsync(activeTheme.color.surface);
    } catch {
      // Ignored in test / non-native environments
    }
  }, [activeTheme.color.surface]);

  const contextValue: ThemeContextValue = useMemo(
    () => ({
      theme: activeTheme,
      colorScheme: activeColorScheme,
      themePreference,
      setThemePreference,
      isDark: activeColorScheme === 'dark',
    }),
    [activeTheme, activeColorScheme, themePreference],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <StatusBar style={activeColorScheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access the current Theme, active color scheme, and preference setter.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    // Fallback if rendered outside ThemeProvider (e.g. isolated unit tests)
    return {
      theme: lightTheme,
      colorScheme: 'light',
      themePreference: 'system',
      setThemePreference: () => {},
      isDark: false,
    };
  }
  return context;
}
