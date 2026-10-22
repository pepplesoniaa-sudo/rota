import { ShiftStatus, SwapStatus } from '@rota/shared';
import type { Theme } from './theme/types';

export interface StatusStyle {
  label: string;
  backgroundColor: string;
  textColor: string;
  borderColor?: string;
  borderStyle?: 'solid' | 'dashed';
  borderWidth?: number;
}

/**
 * Maps a ShiftStatus enum value to its corresponding semantic color role and human-readable label.
 * Enforces exhaustive switch handling so newly added enum values cannot be missed.
 *
 * Rule B-49: Status is always conveyed as text and color together, never color alone.
 */
export function getShiftStatusStyle(status: ShiftStatus, theme: Theme): StatusStyle {
  switch (status) {
    case ShiftStatus.DRAFT:
      return {
        label: 'Draft',
        backgroundColor: theme.color.surfaceContainerHighest,
        textColor: theme.color.onSurfaceVariant,
        borderColor: theme.color.outline,
        borderStyle: 'dashed',
        borderWidth: 1,
      };

    case ShiftStatus.PUBLISHED:
      return {
        label: 'Published',
        backgroundColor: theme.color.primaryContainer,
        textColor: theme.color.onPrimaryContainer,
        borderColor: theme.color.outlineVariant,
        borderStyle: 'solid',
        borderWidth: 1,
      };
  }
}

/**
 * Maps a SwapStatus enum value to its corresponding semantic color role and human-readable label.
 * Enforces exhaustive switch handling.
 *
 * Rule B-49: Status is always conveyed as text and color together, never color alone.
 */
export function getSwapStatusStyle(status: SwapStatus, theme: Theme): StatusStyle {
  switch (status) {
    case SwapStatus.PENDING_PEER:
      return {
        label: 'Pending Peer',
        backgroundColor: theme.color.warningContainer,
        textColor: theme.color.onWarningContainer,
        borderColor: theme.color.outlineVariant,
        borderStyle: 'solid',
        borderWidth: 1,
      };

    case SwapStatus.PENDING_MANAGER:
      return {
        label: 'Pending Manager',
        backgroundColor: theme.color.warningContainer,
        textColor: theme.color.onWarningContainer,
        borderColor: theme.color.outlineVariant,
        borderStyle: 'solid',
        borderWidth: 1,
      };

    case SwapStatus.APPROVED:
      return {
        label: 'Approved',
        backgroundColor: theme.color.successContainer,
        textColor: theme.color.onSuccessContainer,
        borderColor: theme.color.outlineVariant,
        borderStyle: 'solid',
        borderWidth: 1,
      };

    case SwapStatus.REJECTED:
      return {
        label: 'Rejected',
        backgroundColor: theme.color.errorContainer,
        textColor: theme.color.onErrorContainer,
        borderColor: theme.color.outlineVariant,
        borderStyle: 'solid',
        borderWidth: 1,
      };

    case SwapStatus.DECLINED:
      return {
        label: 'Declined',
        backgroundColor: theme.color.surfaceContainerHighest,
        textColor: theme.color.onSurfaceVariant,
        borderColor: theme.color.outlineVariant,
        borderStyle: 'solid',
        borderWidth: 1,
      };

    case SwapStatus.CANCELED:
      return {
        label: 'Canceled',
        backgroundColor: theme.color.surfaceContainerHighest,
        textColor: theme.color.onSurfaceVariant,
        borderColor: theme.color.outlineVariant,
        borderStyle: 'solid',
        borderWidth: 1,
      };

    case SwapStatus.EXPIRED:
      return {
        label: 'Expired',
        backgroundColor: theme.color.surfaceContainerHighest,
        textColor: theme.color.onSurfaceVariant,
        borderColor: theme.color.outlineVariant,
        borderStyle: 'solid',
        borderWidth: 1,
      };
  }
}

/**
 * Highlight role definitions (Tertiary / Indigo)
 * Reserved for non-status highlights such as "Your shift" markers and the current-time indicator line.
 */
export function getHighlightStyle(theme: Theme) {
  return {
    yourShiftMarker: {
      backgroundColor: theme.color.tertiaryContainer,
      color: theme.color.onTertiaryContainer,
      indicatorLine: theme.color.tertiary,
    },
    currentTimeLine: {
      color: theme.color.tertiary,
    },
  };
}
