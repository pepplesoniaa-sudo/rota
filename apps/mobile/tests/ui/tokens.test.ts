import { describe, it, expect } from 'vitest';
import { ShiftStatus, SwapStatus } from '@rota/shared';
import { lightTheme, darkTheme, resolveTheme } from '../../src/ui/tokens/resolve';
import { getShiftStatusStyle, getSwapStatusStyle } from '../../src/ui/status';

// ============================================================================
// WCAG 2.x Contrast Ratio Formula
// ============================================================================

function parseHex(hex: string): [number, number, number] {
  let clean = hex.replace('#', '');
  if (clean.length === 8) {
    clean = clean.substring(0, 6);
  }
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function getRelativeLuminance(hex: string): number {
  const [rByte, gByte, bByte] = parseHex(hex);
  const r = (rByte ?? 0) / 255;
  const g = (gByte ?? 0) / 255;
  const b = (bByte ?? 0) / 255;

  const rL = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const gL = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const bL = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ============================================================================
// Tests
// ============================================================================

describe('PRD 7.11 token alias resolution and structure', () => {
  it('resolves both light and dark themes successfully without unhandled aliases', () => {
    expect(lightTheme).toBeDefined();
    expect(darkTheme).toBeDefined();
    expect(lightTheme.colorScheme).toBe('light');
    expect(darkTheme.colorScheme).toBe('dark');

    // Test runtime resolveTheme function directly
    expect(resolveTheme('light')).toEqual(lightTheme);
    expect(resolveTheme('dark')).toEqual(darkTheme);
  });

  it('ensures light and dark themes have exactly the same role keys', () => {
    const lightKeys = Object.keys(lightTheme.color).sort();
    const darkKeys = Object.keys(darkTheme.color).sort();
    expect(lightKeys).toEqual(darkKeys);
  });

  it('ensures all resolved color roles are valid 6-char or 8-char hex strings', () => {
    const hexRegex = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
    for (const [key, value] of Object.entries(lightTheme.color)) {
      expect(value, `Light theme color ${key}`).toMatch(hexRegex);
    }
    for (const [key, value] of Object.entries(darkTheme.color)) {
      expect(value, `Dark theme color ${key}`).toMatch(hexRegex);
    }
  });

  it('ensures spacing, radius, elevation and touch target tokens are valid', () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(theme.space[0]).toBe(0);
      expect(theme.space[1]).toBe(4);
      expect(theme.space[4]).toBe(16);
      expect(theme.space.base).toBe(16);

      expect(theme.radius.none).toBe(0);
      expect(theme.radius.sm).toBe(4);
      expect(theme.radius.md).toBe(8);
      expect(theme.radius.full).toBe(9999);

      expect(theme.size.minTarget).toBeGreaterThanOrEqual(44);

      expect(theme.elevation[1]).toBe(1);
      expect(theme.elevation[5]).toBe(12);

      expect(theme.shadow[1]).toBeDefined();
      expect(theme.shadow[5]).toBeDefined();
    }
  });

  it('ensures typography scale maps only to Inter static font files and specifies tabular numbers', () => {
    for (const theme of [lightTheme, darkTheme]) {
      const { typography } = theme;

      // Inter-only check: no serif/Lora, exact family names
      for (const [styleName, token] of Object.entries(typography)) {
        expect(token.fontFamily, `${styleName} fontFamily`).toMatch(/^Inter_/);
        expect(token.fontSize).toBeGreaterThan(0);
        expect(token.lineHeight).toBeGreaterThanOrEqual(token.fontSize);
      }

      // Check tabular numbers on numerical variants
      expect(typography.displayNumbers.fontVariant).toContain('tabular-nums');
      expect(typography.headlineNumbers.fontVariant).toContain('tabular-nums');
      expect(typography.titleNumbers.fontVariant).toContain('tabular-nums');
      expect(typography.bodyNumbers.fontVariant).toContain('tabular-nums');
      expect(typography.labelNumbers.fontVariant).toContain('tabular-nums');
    }
  });
});

describe('PRD 7.11 contrast', () => {
  const surfaceKeys = [
    'surface',
    'surfaceDim',
    'surfaceBright',
    'surfaceContainerLowest',
    'surfaceContainerLow',
    'surfaceContainer',
    'surfaceContainerHigh',
    'surfaceContainerHighest',
  ] as const;

  const onXPairs: [keyof typeof lightTheme.color, keyof typeof lightTheme.color][] = [
    ['onPrimary', 'primary'],
    ['onPrimaryContainer', 'primaryContainer'],
    ['onSecondary', 'secondary'],
    ['onSecondaryContainer', 'secondaryContainer'],
    ['onTertiary', 'tertiary'],
    ['onTertiaryContainer', 'tertiaryContainer'],
    ['onError', 'error'],
    ['onErrorContainer', 'errorContainer'],
    ['onSuccess', 'success'],
    ['onSuccessContainer', 'successContainer'],
    ['onWarning', 'warning'],
    ['onWarningContainer', 'warningContainer'],
    ['onSurface', 'surface'],
    ['inverseOnSurface', 'inverseSurface'],
  ];

  for (const scheme of ['light', 'dark'] as const) {
    const theme = scheme === 'dark' ? darkTheme : lightTheme;

    describe(`${scheme.toUpperCase()} mode contrast`, () => {
      it('achieves >= 4.5:1 text contrast for all onX on X pairs', () => {
        for (const [fgKey, bgKey] of onXPairs) {
          const fg = theme.color[fgKey];
          const bg = theme.color[bgKey];
          const ratio = getContrastRatio(fg, bg);
          expect(
            ratio,
            `${scheme} ${String(fgKey)} (${fg}) on ${String(bgKey)} (${bg}) ratio ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('achieves >= 4.5:1 text contrast for onSurface on all surfaces and containers', () => {
        const onSurface = theme.color.onSurface;
        for (const surfKey of surfaceKeys) {
          const surf = theme.color[surfKey];
          const ratio = getContrastRatio(onSurface, surf);
          expect(
            ratio,
            `${scheme} onSurface on ${surfKey} ratio ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('achieves >= 4.5:1 text contrast for onSurfaceVariant on all surfaces and containers', () => {
        const onSurfaceVariant = theme.color.onSurfaceVariant;
        for (const surfKey of surfaceKeys) {
          const surf = theme.color[surfKey];
          const ratio = getContrastRatio(onSurfaceVariant, surf);
          expect(
            ratio,
            `${scheme} onSurfaceVariant on ${surfKey} ratio ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('achieves >= 4.5:1 text contrast for primary on all surfaces and containers', () => {
        const primary = theme.color.primary;
        for (const surfKey of surfaceKeys) {
          const surf = theme.color[surfKey];
          const ratio = getContrastRatio(primary, surf);
          expect(
            ratio,
            `${scheme} primary on ${surfKey} ratio ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('achieves >= 3:1 contrast for outline on all surfaces and containers', () => {
        const outline = theme.color.outline;
        for (const surfKey of surfaceKeys) {
          const surf = theme.color[surfKey];
          const ratio = getContrastRatio(outline, surf);
          expect(
            ratio,
            `${scheme} outline on ${surfKey} ratio ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3.0);
        }
      });
    });
  }
});

describe('PRD 7.11 / B-49 status mapping and chip styles', () => {
  it('maps every ShiftStatus enum value to a style with a non-empty text label and colors', () => {
    for (const status of Object.values(ShiftStatus)) {
      const styleLight = getShiftStatusStyle(status, lightTheme);
      const styleDark = getShiftStatusStyle(status, darkTheme);

      expect(styleLight.label).toBeTruthy();
      expect(styleDark.label).toBeTruthy();
      expect(styleLight.backgroundColor).toMatch(/^#/);
      expect(styleLight.textColor).toMatch(/^#/);
      expect(styleDark.backgroundColor).toMatch(/^#/);
      expect(styleDark.textColor).toMatch(/^#/);

      if (status === ShiftStatus.DRAFT) {
        expect(styleLight.borderStyle).toBe('dashed');
        expect(styleLight.backgroundColor).toBe(lightTheme.color.surfaceContainerHighest);
        expect(styleLight.textColor).toBe(lightTheme.color.onSurfaceVariant);
      } else if (status === ShiftStatus.PUBLISHED) {
        expect(styleLight.backgroundColor).toBe(lightTheme.color.primaryContainer);
        expect(styleLight.textColor).toBe(lightTheme.color.onPrimaryContainer);
      }
    }
  });

  it('maps every SwapStatus enum value to a style with a non-empty text label and colors', () => {
    for (const status of Object.values(SwapStatus)) {
      const styleLight = getSwapStatusStyle(status, lightTheme);
      const styleDark = getSwapStatusStyle(status, darkTheme);

      expect(styleLight.label).toBeTruthy();
      expect(styleDark.label).toBeTruthy();
      expect(styleLight.backgroundColor).toMatch(/^#/);
      expect(styleLight.textColor).toMatch(/^#/);

      if (status === SwapStatus.APPROVED) {
        expect(styleLight.backgroundColor).toBe(lightTheme.color.successContainer);
        expect(styleLight.textColor).toBe(lightTheme.color.onSuccessContainer);
      } else if (status === SwapStatus.REJECTED) {
        expect(styleLight.backgroundColor).toBe(lightTheme.color.errorContainer);
        expect(styleLight.textColor).toBe(lightTheme.color.onErrorContainer);
      } else if (status === SwapStatus.PENDING_PEER || status === SwapStatus.PENDING_MANAGER) {
        expect(styleLight.backgroundColor).toBe(lightTheme.color.warningContainer);
        expect(styleLight.textColor).toBe(lightTheme.color.onWarningContainer);
      } else {
        expect(styleLight.backgroundColor).toBe(lightTheme.color.surfaceContainerHighest);
        expect(styleLight.textColor).toBe(lightTheme.color.onSurfaceVariant);
      }
    }
  });
});
