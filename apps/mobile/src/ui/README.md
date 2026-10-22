# Rota Mobile UI & Design Token System

This directory houses the Rota design system for React Native, adapted from the Digital book M3 token architecture and specialized for dense, glanceable scheduling data.

---

## 1. Architecture

The design token system is structured into two tiers:

1. **Tier 1: Primitive Tonal Palettes (Foundational)**
   - Generated using `@material/material-color-utilities` (HCT).
   - Palettes: `primary` (Teal #006878), `secondary` (Hue 215), `tertiary` (Muted Indigo), `neutral`, `neutralVariant`, `error`, `success`, `warning`.
   - Never used directly in UI components.
2. **Tier 2: Semantic Color Roles (UI Application)**
   - Material Design 3 semantic roles (`primary`, `surface`, `onSurface`, `surfaceContainer`, `outline`, etc.).
   - Automatically mapped to appropriate tonal values for light and dark modes.
   - Enforced by ESLint rule **CS-13**: raw hex color strings are banned outside `src/ui/tokens/**`.

---

## 2. Using `makeStyles` in Components

Components should always use `makeStyles` to create their `StyleSheet`. It memoizes a stylesheet for each scheme and avoids recreating objects on render:

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import { makeStyles } from '../theme';

const useStyles = makeStyles((theme) => ({
  card: {
    backgroundColor: theme.color.surfaceContainer,
    borderRadius: theme.radius.md,
    padding: theme.space.base,
    minHeight: theme.size.minTarget, // 44pt touch target rule (B-49)
    borderWidth: 1,
    borderColor: theme.color.outlineVariant,
  },
  title: {
    ...theme.typography.titleLarge,
    color: theme.color.onSurface,
  },
  time: {
    ...theme.typography.bodyNumbers, // Includes tabular-nums for aligned columns
    color: theme.color.onSurfaceVariant,
  },
}));

export function ShiftCard() {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Morning Shift</Text>
      <Text style={styles.time}>08:00 - 16:30</Text>
    </View>
  );
}
```

---

## 3. Semantic Color Role Table

| Role                                         | Light Tone                       | Dark Tone                       | Usage                                          |
| -------------------------------------------- | -------------------------------- | ------------------------------- | ---------------------------------------------- |
| `primary` / `onPrimary`                      | `primary.40` / `primary.100`     | `primary.80` / `primary.20`     | Primary buttons, active indicators             |
| `primaryContainer` / `onPrimaryContainer`    | `primary.90` / `primary.10`      | `primary.30` / `primary.90`     | Published shift cards, prominent chips         |
| `secondary` / `onSecondary`                  | `secondary.40` / `secondary.100` | `secondary.80` / `secondary.20` | Secondary buttons and badges                   |
| `tertiary` / `onTertiary`                    | `tertiary.40` / `tertiary.100`   | `tertiary.80` / `tertiary.20`   | Non-status accents (timeline line, your shift) |
| `surface` / `onSurface`                      | `neutral.98` / `neutral.10`      | `neutral.6` / `neutral.90`      | Screen background, primary text                |
| `surfaceContainerLowest`                     | `neutral.100`                    | `neutral.4`                     | Backgrounds behind grouped items               |
| `surfaceContainerLow`                        | `neutral.96`                     | `neutral.10`                    | Subtle group containers                        |
| `surfaceContainer`                           | `neutral.94`                     | `neutral.12`                    | Standard card backgrounds                      |
| `surfaceContainerHigh`                       | `neutral.92`                     | `neutral.17`                    | Modals, bottom sheets                          |
| `surfaceContainerHighest`                    | `neutral.90`                     | `neutral.22`                    | Draft shifts, disabled/expired cards           |
| `onSurfaceVariant`                           | `neutralVariant.30`              | `neutralVariant.80`             | Secondary labels, captions, metadata           |
| `outline`                                    | `neutralVariant.50`              | `neutralVariant.60`             | Input borders, focus rings (>= 3:1)            |
| `outlineVariant`                             | `neutralVariant.80`              | `neutralVariant.30`             | Decorative dividers only (< 3:1)               |
| `error` / `onError` / `errorContainer`       | `error.40/100/90`                | `error.80/20/30`                | Rejections, error banners                      |
| `success` / `onSuccess` / `successContainer` | `success.40/100/90`              | `success.80/20/30`              | Approved swaps, positive badges                |
| `warning` / `onWarning` / `warningContainer` | `warning.40/100/90`              | `warning.80/20/30`              | Pending swaps, warnings                        |

---

## 4. How to Add or Change a Token

1. Update `src/ui/tokens/design-tokens.tokens.json`:
   - If adding a primitive color, place it in the appropriate `primitive colors` palette.
   - If adding a semantic role, add both `light` and `dark` mappings in `color roles`.
2. Update the TypeScript interface and Zod schema in `src/ui/tokens/resolve.ts`.
3. Run `pnpm test` to ensure all aliases resolve and all WCAG contrast requirements are verified.
