import { z } from 'zod';
import tokensData from './design-tokens.tokens.json';

// ============================================================================
// Types
// ============================================================================

export interface ColorRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  success: string;
  onSuccess: string;
  successContainer: string;
  onSuccessContainer: string;
  warning: string;
  onWarning: string;
  warningContainer: string;
  onWarningContainer: string;
  surface: string;
  onSurface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  scrim: string;
  shadow: string;
}

export interface SpaceTokens {
  0: number;
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
  6: number;
  8: number;
  none: number;
  xs: number;
  sm: number;
  md: number;
  base: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface RadiusTokens {
  none: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  full: number;
  4: number;
  8: number;
  12: number;
  16: number;
  28: number;
}

export interface ElevationTokens {
  0: number;
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
  boxShadow?: string;
}

export interface TypographyToken {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing: number;
  fontVariant?: 'tabular-nums'[];
}

export interface TypographyTokens {
  caption: TypographyToken;
  overline: TypographyToken;
  displayLarge: TypographyToken;
  displayMedium: TypographyToken;
  displaySmall: TypographyToken;
  headlineLarge: TypographyToken;
  headlineMedium: TypographyToken;
  headlineSmall: TypographyToken;
  titleLarge: TypographyToken;
  titleMedium: TypographyToken;
  titleSmall: TypographyToken;
  bodyLarge: TypographyToken;
  bodyMedium: TypographyToken;
  bodySmall: TypographyToken;
  buttonLarge: TypographyToken;
  buttonSmall: TypographyToken;
  // Numerical tokens with tabular-nums for rotas, durations, dates, money
  displayNumbers: TypographyToken;
  headlineNumbers: TypographyToken;
  titleNumbers: TypographyToken;
  bodyNumbers: TypographyToken;
  labelNumbers: TypographyToken;
}

export interface Theme {
  colorScheme: 'light' | 'dark';
  color: ColorRoles;
  space: SpaceTokens;
  radius: RadiusTokens;
  elevation: ElevationTokens;
  shadow: Record<1 | 2 | 3 | 4 | 5, ShadowStyle>;
  size: {
    minTarget: number;
  };
  typography: TypographyTokens;
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Must be a valid hex color string');

const ColorRolesSchema = z.object({
  primary: HexColorSchema,
  onPrimary: HexColorSchema,
  primaryContainer: HexColorSchema,
  onPrimaryContainer: HexColorSchema,
  secondary: HexColorSchema,
  onSecondary: HexColorSchema,
  secondaryContainer: HexColorSchema,
  onSecondaryContainer: HexColorSchema,
  tertiary: HexColorSchema,
  onTertiary: HexColorSchema,
  tertiaryContainer: HexColorSchema,
  onTertiaryContainer: HexColorSchema,
  error: HexColorSchema,
  onError: HexColorSchema,
  errorContainer: HexColorSchema,
  onErrorContainer: HexColorSchema,
  success: HexColorSchema,
  onSuccess: HexColorSchema,
  successContainer: HexColorSchema,
  onSuccessContainer: HexColorSchema,
  warning: HexColorSchema,
  onWarning: HexColorSchema,
  warningContainer: HexColorSchema,
  onWarningContainer: HexColorSchema,
  surface: HexColorSchema,
  onSurface: HexColorSchema,
  surfaceDim: HexColorSchema,
  surfaceBright: HexColorSchema,
  surfaceContainerLowest: HexColorSchema,
  surfaceContainerLow: HexColorSchema,
  surfaceContainer: HexColorSchema,
  surfaceContainerHigh: HexColorSchema,
  surfaceContainerHighest: HexColorSchema,
  onSurfaceVariant: HexColorSchema,
  outline: HexColorSchema,
  outlineVariant: HexColorSchema,
  inverseSurface: HexColorSchema,
  inverseOnSurface: HexColorSchema,
  inversePrimary: HexColorSchema,
  scrim: HexColorSchema,
  shadow: HexColorSchema,
});

const TypographyTokenSchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.number().positive(),
  lineHeight: z.number().positive(),
  fontWeight: z.enum(['400', '500', '600', '700']),
  letterSpacing: z.number(),
  fontVariant: z.array(z.literal('tabular-nums')).optional(),
});

const ThemeSchema = z.object({
  colorScheme: z.enum(['light', 'dark']),
  color: ColorRolesSchema,
  space: z.object({
    0: z.number().nonnegative(),
    1: z.number().nonnegative(),
    2: z.number().nonnegative(),
    3: z.number().nonnegative(),
    4: z.number().nonnegative(),
    5: z.number().nonnegative(),
    6: z.number().nonnegative(),
    8: z.number().nonnegative(),
    none: z.number().nonnegative(),
    xs: z.number().nonnegative(),
    sm: z.number().nonnegative(),
    md: z.number().nonnegative(),
    base: z.number().nonnegative(),
    lg: z.number().nonnegative(),
    xl: z.number().nonnegative(),
    xxl: z.number().nonnegative(),
  }),
  radius: z.object({
    none: z.number().nonnegative(),
    sm: z.number().nonnegative(),
    md: z.number().nonnegative(),
    lg: z.number().nonnegative(),
    xl: z.number().nonnegative(),
    xxl: z.number().nonnegative(),
    full: z.number().nonnegative(),
    4: z.number().nonnegative(),
    8: z.number().nonnegative(),
    12: z.number().nonnegative(),
    16: z.number().nonnegative(),
    28: z.number().nonnegative(),
  }),
  elevation: z.object({
    0: z.number().nonnegative(),
    1: z.number().nonnegative(),
    2: z.number().nonnegative(),
    3: z.number().nonnegative(),
    4: z.number().nonnegative(),
    5: z.number().nonnegative(),
  }),
  shadow: z.record(
    z.object({
      shadowColor: HexColorSchema,
      shadowOffset: z.object({ width: z.number(), height: z.number() }),
      shadowOpacity: z.number().min(0).max(1),
      shadowRadius: z.number().nonnegative(),
      elevation: z.number().nonnegative(),
      boxShadow: z.string().optional(),
    }),
  ),
  size: z.object({
    minTarget: z.number().min(44, 'PRD 7.11 minimum touch target is 44 points'),
  }),
  typography: z.object({
    caption: TypographyTokenSchema,
    overline: TypographyTokenSchema,
    displayLarge: TypographyTokenSchema,
    displayMedium: TypographyTokenSchema,
    displaySmall: TypographyTokenSchema,
    headlineLarge: TypographyTokenSchema,
    headlineMedium: TypographyTokenSchema,
    headlineSmall: TypographyTokenSchema,
    titleLarge: TypographyTokenSchema,
    titleMedium: TypographyTokenSchema,
    titleSmall: TypographyTokenSchema,
    bodyLarge: TypographyTokenSchema,
    bodyMedium: TypographyTokenSchema,
    bodySmall: TypographyTokenSchema,
    buttonLarge: TypographyTokenSchema,
    buttonSmall: TypographyTokenSchema,
    displayNumbers: TypographyTokenSchema,
    headlineNumbers: TypographyTokenSchema,
    titleNumbers: TypographyTokenSchema,
    bodyNumbers: TypographyTokenSchema,
    labelNumbers: TypographyTokenSchema,
  }),
});

// ============================================================================
// Resolver Implementation
// ============================================================================

/**
 * Resolves a token path reference from the token JSON.
 * Example path: ['primitive colors', 'primary color palette', '40']
 */
function resolvePath(obj: unknown, pathArray: string[]): unknown {
  let curr = obj;
  for (const segment of pathArray) {
    if (curr && typeof curr === 'object' && segment in curr) {
      curr = (curr as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return curr;
}

/**
 * Resolves alias string: "{primitive colors.primary color palette.40}"
 */
function resolveAliasValue(raw: string, rootObj: unknown, seen = new Set<string>()): string {
  if (seen.has(raw)) {
    throw new Error(`Circular alias detected for: ${raw}`);
  }
  seen.add(raw);

  const match = raw.match(/^\{([^}]+)\}$/);
  if (!match || !match[1]) {
    return raw;
  }

  const parts = match[1].split('.');
  const tokenNode = resolvePath(rootObj, parts);

  if (!tokenNode || typeof tokenNode !== 'object') {
    throw new Error(`Unresolved token alias: ${raw}`);
  }

  const val = (tokenNode as { value?: unknown }).value;
  if (typeof val !== 'string') {
    throw new Error(`Token at ${raw} does not resolve to a string value`);
  }

  if (val.startsWith('{') && val.endsWith('}')) {
    return resolveAliasValue(val, rootObj, seen);
  }

  return val;
}

/**
 * Generates platform-compliant React Native shadow styles for 5 elevation levels.
 * Includes both standard shadow properties (iOS/Android elevation) and modern boxShadow.
 */
function buildShadowStyles(scheme: 'light' | 'dark'): Record<1 | 2 | 3 | 4 | 5, ShadowStyle> {
  const color = '#000000';
  const opacities =
    scheme === 'dark' ? [0, 0.4, 0.45, 0.5, 0.55, 0.6] : [0, 0.15, 0.18, 0.22, 0.26, 0.3];

  return {
    1: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: opacities[1] ?? 0.15,
      shadowRadius: 2,
      elevation: 1,
      boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.15)',
    },
    2: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: opacities[2] ?? 0.18,
      shadowRadius: 4,
      elevation: 3,
      boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.18)',
    },
    3: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: opacities[3] ?? 0.22,
      shadowRadius: 8,
      elevation: 6,
      boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.22)',
    },
    4: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: opacities[4] ?? 0.26,
      shadowRadius: 12,
      elevation: 8,
      boxShadow: '0px 6px 12px rgba(0, 0, 0, 0.26)',
    },
    5: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: opacities[5] ?? 0.3,
      shadowRadius: 16,
      elevation: 12,
      boxShadow: '0px 8px 16px rgba(0, 0, 0, 0.30)',
    },
  };
}

/**
 * Resolves the raw tokens JSON into a strongly-typed and validated Theme object.
 */
export function resolveTheme(scheme: 'light' | 'dark'): Theme {
  const root = tokensData as Record<string, unknown>;
  const rolesRaw = (root['color roles'] as Record<string, Record<string, { value: string }>>)[
    scheme
  ];

  if (!rolesRaw) {
    throw new Error(`Missing '${scheme}' mode in tokens color roles`);
  }

  const resolvedColors: Record<string, string> = {};
  for (const [key, item] of Object.entries(rolesRaw)) {
    resolvedColors[key] = resolveAliasValue(item.value, root);
  }

  const space: SpaceTokens = {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    none: 0,
    xs: 4,
    sm: 8,
    md: 12,
    base: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
  };

  const radius: RadiusTokens = {
    none: 0,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 28,
    full: 9999,
    4: 4,
    8: 8,
    12: 12,
    16: 16,
    28: 28,
  };

  const elevation: ElevationTokens = {
    0: 0,
    1: 1,
    2: 3,
    3: 6,
    4: 8,
    5: 12,
  };

  const shadow = buildShadowStyles(scheme);

  const typography: TypographyTokens = {
    caption: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '400',
      letterSpacing: 0.4,
    },
    overline: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
      letterSpacing: 2,
    },
    displayLarge: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 57,
      lineHeight: 64,
      fontWeight: '600',
      letterSpacing: -0.5,
    },
    displayMedium: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 45,
      lineHeight: 52,
      fontWeight: '600',
      letterSpacing: -0.5,
    },
    displaySmall: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 36,
      lineHeight: 44,
      fontWeight: '600',
      letterSpacing: -0.25,
    },
    headlineLarge: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 32,
      lineHeight: 40,
      fontWeight: '600',
      letterSpacing: -0.25,
    },
    headlineMedium: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 24,
      lineHeight: 32,
      fontWeight: '600',
      letterSpacing: 0,
    },
    headlineSmall: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 20,
      lineHeight: 28,
      fontWeight: '600',
      letterSpacing: 0.15,
    },
    titleLarge: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
    titleMedium: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
      letterSpacing: 0.15,
    },
    titleSmall: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      lineHeight: 22,
      fontWeight: '500',
      letterSpacing: 0.25,
    },
    bodyLarge: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '400',
      letterSpacing: 0.5,
    },
    bodyMedium: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '400',
      letterSpacing: 0.25,
    },
    bodySmall: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '400',
      letterSpacing: 0.4,
    },
    buttonLarge: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
      letterSpacing: 0.75,
    },
    buttonSmall: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
      letterSpacing: 0.5,
    },
    // Numerical variants with tabular numbers
    displayNumbers: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 36,
      lineHeight: 44,
      fontWeight: '600',
      letterSpacing: -0.25,
      fontVariant: ['tabular-nums'],
    },
    headlineNumbers: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 24,
      lineHeight: 32,
      fontWeight: '600',
      letterSpacing: 0,
      fontVariant: ['tabular-nums'],
    },
    titleNumbers: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '600',
      letterSpacing: 0.1,
      fontVariant: ['tabular-nums'],
    },
    bodyNumbers: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '400',
      letterSpacing: 0.25,
      fontVariant: ['tabular-nums'],
    },
    labelNumbers: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '500',
      letterSpacing: 0.5,
      fontVariant: ['tabular-nums'],
    },
  };

  const themeUnvalidated = {
    colorScheme: scheme,
    color: resolvedColors as unknown as ColorRoles,
    space,
    radius,
    elevation,
    shadow,
    size: {
      minTarget: 44,
    },
    typography,
  };

  const result = ThemeSchema.safeParse(themeUnvalidated);
  if (!result.success) {
    throw new Error(`Theme validation failed for ${scheme} mode: ${result.error.message}`);
  }

  return result.data as Theme;
}

// Pre-resolved themes created at import time
export const lightTheme: Theme = resolveTheme('light');
export const darkTheme: Theme = resolveTheme('dark');
