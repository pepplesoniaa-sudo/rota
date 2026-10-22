import { StyleSheet, type ViewStyle, type TextStyle, type ImageStyle } from 'react-native';
import type { Theme } from '../tokens/resolve';
import { lightTheme, darkTheme } from '../tokens/resolve';
import { useTheme } from './ThemeProvider';

type StyleProp = ViewStyle | TextStyle | ImageStyle;
type NamedStyles<T> = { [P in keyof T]: StyleProp };

/**
 * Creates a custom React hook that memoizes a StyleSheet for both light and dark schemes.
 * Ensures StyleSheet.create is only run once per color scheme.
 *
 * @example
 * const useStyles = makeStyles((theme) => ({
 *   container: {
 *     backgroundColor: theme.color.surface,
 *     padding: theme.space.base,
 *   },
 * }));
 *
 * function MyComponent() {
 *   const styles = useStyles();
 *   return <View style={styles.container} />;
 * }
 */
export function makeStyles<T extends NamedStyles<T>>(stylesFactory: (theme: Theme) => T): () => T {
  let cachedLight: T | null = null;
  let cachedDark: T | null = null;

  return function useStyles(): T {
    const { colorScheme } = useTheme();

    if (colorScheme === 'dark') {
      if (!cachedDark) {
        cachedDark = StyleSheet.create(stylesFactory(darkTheme));
      }
      return cachedDark;
    }

    if (!cachedLight) {
      cachedLight = StyleSheet.create(stylesFactory(lightTheme));
    }
    return cachedLight;
  };
}
