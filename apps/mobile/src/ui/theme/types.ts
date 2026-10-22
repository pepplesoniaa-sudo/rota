export type {
  Theme,
  ColorRoles,
  SpaceTokens,
  RadiusTokens,
  ElevationTokens,
  ShadowStyle,
  TypographyToken,
  TypographyTokens,
} from '../tokens/resolve';

export type ColorSchemeName = 'light' | 'dark';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface ThemeContextValue {
  theme: import('../tokens/resolve').Theme;
  colorScheme: ColorSchemeName;
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => void;
  isDark: boolean;
}
