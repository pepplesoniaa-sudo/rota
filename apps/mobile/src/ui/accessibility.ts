import { AccessibilityInfo } from 'react-native';
import { DateTime } from 'luxon';

/**
 * PRD 7.11 Accessibility rules:
 * - Touch targets at least 44 by 44 points.
 * - Every icon button has an accessibilityLabel.
 * - Shift cards read as:
 *   "{Position} shift, {DayOfWeek} {Day} {Month}, {StartTime} to {EndTime} {TimezoneName}, {TeamName}"
 *   e.g. "Nurse shift, Tuesday 3 November, 7:00 a.m. to 7:30 p.m. Central time, Northside Family Clinic"
 * - Optimistic rollbacks and errors are announced to screen readers.
 */

export const MIN_TOUCH_TARGET = {
  minWidth: 44,
  minHeight: 44,
} as const;

export interface ShiftAccessibilityFormatParams {
  position: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  teamName: string;
}

/**
 * Formats a shift card accessibility label per PRD 7.11.
 */
export function formatShiftAccessibilityLabel(params: ShiftAccessibilityFormatParams): string {
  const { position, startsAt, endsAt, timezone, teamName } = params;

  const startDt = DateTime.fromJSDate(startsAt, { zone: 'utc' }).setZone(timezone);
  const endDt = DateTime.fromJSDate(endsAt, { zone: 'utc' }).setZone(timezone);

  // Format: "Tuesday 3 November"
  const dateStr = startDt.toFormat('EEEE d MMMM');

  // Format: "7:00 a.m."
  const startFormat = startDt
    .toFormat('h:mm a')
    .toLowerCase()
    .replace('am', 'a.m.')
    .replace('pm', 'p.m.');
  const endFormat = endDt
    .toFormat('h:mm a')
    .toLowerCase()
    .replace('am', 'a.m.')
    .replace('pm', 'p.m.');

  // Format timezone friendly name
  const tzName = startDt.offsetNameLong ?? startDt.zoneName;

  return `${position} shift, ${dateStr}, ${startFormat} to ${endFormat} ${tzName}, ${teamName}`;
}

/**
 * Announces a message to screen readers for optimistic rollbacks and error states (PRD 7.11).
 */
export function announceToScreenReader(message: string): void {
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // Non-fatal if invoked outside React Native runtime
  }
}
