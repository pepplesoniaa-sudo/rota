import type { Theme as NavigationTheme } from '@react-navigation/native';
import type { Theme } from '../tokens/resolve';

/**
 * Maps the resolved Rota Theme into a React Navigation / Expo Router theme object.
 */
export function getNavigationTheme(theme: Theme): NavigationTheme {
  const isDark = theme.colorScheme === 'dark';

  return {
    dark: isDark,
    colors: {
      primary: theme.color.primary,
      background: theme.color.surface,
      card: theme.color.surfaceContainer,
      text: theme.color.onSurface,
      border: theme.color.outlineVariant,
      notification: theme.color.error,
    },
    fonts: {
      regular: {
        fontFamily: theme.typography.bodyLarge.fontFamily,
        fontWeight: theme.typography.bodyLarge.fontWeight,
      },
      medium: {
        fontFamily: theme.typography.titleMedium.fontFamily,
        fontWeight: theme.typography.titleMedium.fontWeight,
      },
      bold: {
        fontFamily: theme.typography.headlineSmall.fontFamily,
        fontWeight: theme.typography.headlineSmall.fontWeight,
      },
      heavy: {
        fontFamily: theme.typography.headlineLarge.fontFamily,
        fontWeight: theme.typography.headlineLarge.fontWeight,
      },
    },
  };
}
