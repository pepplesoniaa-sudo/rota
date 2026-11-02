import { DateTime } from 'luxon';
import { AppError } from '@rota/shared';

export function isValidIanaTimezone(zone: string): boolean {
  if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
    return Intl.supportedValuesOf('timeZone').includes(zone);
  }
  return DateTime.now().setZone(zone).isValid;
}

export function localToUtc(localIsoString: string, zone: string): DateTime {
  const dt = DateTime.fromISO(localIsoString, { zone });
  if (!dt.isValid) {
    throw new Error(`Invalid local time or timezone: ${localIsoString} in ${zone}`);
  }
  return dt.toUTC();
}

export function utcToLocal(utcDate: Date, zone: string): DateTime {
  return DateTime.fromJSDate(utcDate, { zone: 'utc' }).setZone(zone);
}

/**
 * Resolves an ISO local date-time (without offset) in the given time zone (FR-15, L-14).
 * - Detects spring-forward gap (non-existent local time) and throws 400 SHIFT_TIME_NONEXISTENT.
 * - Detects fall-back overlap (ambiguous local time): uses earlier instant by default, or later if useLaterOffset is true.
 * - Returns Luxon DateTime in UTC.
 */
export function parseLocalToUtc(
  localIsoString: string,
  zone: string,
  useLaterOffset = false,
): DateTime {
  const targetWall = localIsoString.slice(0, 19);
  const dt = DateTime.fromISO(targetWall, { zone });

  if (!dt.isValid) {
    throw new AppError('VALIDATION_FAILED', 400, `Invalid local time format: ${localIsoString}`);
  }

  // 1. Check if the local wall-clock time was shifted because of spring-forward gap
  if (dt.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== targetWall) {
    throw new AppError(
      'SHIFT_TIME_NONEXISTENT',
      400,
      `Local time ${localIsoString} does not exist in timezone ${zone} due to DST spring forward`,
    );
  }

  // 2. Check for fall-back ambiguous local time (time happens twice)
  const earlierOffset = dt.minus({ hours: 2 }).offset;
  const laterOffset = dt.plus({ hours: 2 }).offset;

  let earlierDt: DateTime = dt;
  let laterDt: DateTime = dt;

  if (earlierOffset !== dt.offset) {
    const cand: DateTime = dt.minus({ minutes: earlierOffset - dt.offset }).setZone(zone);
    if (cand.toFormat("yyyy-MM-dd'T'HH:mm:ss") === targetWall) {
      if (cand.toMillis() < dt.toMillis()) {
        earlierDt = cand;
        laterDt = dt;
      } else {
        earlierDt = dt;
        laterDt = cand;
      }
    }
  }

  if (laterOffset !== dt.offset) {
    const cand: DateTime = dt.minus({ minutes: laterOffset - dt.offset }).setZone(zone);
    if (cand.toFormat("yyyy-MM-dd'T'HH:mm:ss") === targetWall) {
      if (cand.toMillis() < dt.toMillis()) {
        earlierDt = cand;
        laterDt = dt;
      } else {
        earlierDt = dt;
        laterDt = cand;
      }
    }
  }

  const selected = useLaterOffset ? laterDt : earlierDt;
  return selected.toUTC();
}

/**
 * Validates shift duration is between 15 minutes and 16 hours (FR-15, L-36).
 * Throws 400 SHIFT_DURATION_INVALID if invalid.
 * Returns duration in minutes.
 */
export function validateShiftDuration(startsUtc: DateTime, endsUtc: DateTime): number {
  const diffMinutes = endsUtc.diff(startsUtc, 'minutes').minutes;

  if (diffMinutes <= 0) {
    throw new AppError('SHIFT_DURATION_INVALID', 400, 'Shift end must be after shift start');
  }

  if (diffMinutes < 15 || diffMinutes > 16 * 60) {
    throw new AppError(
      'SHIFT_DURATION_INVALID',
      400,
      'Shift duration must be between 15 minutes and 16 hours',
    );
  }

  return diffMinutes;
}

export function isWithinQuietHours(
  localMinute: number,
  startMinute: number,
  endMinute: number,
): boolean {
  if (startMinute <= endMinute) {
    return localMinute >= startMinute && localMinute < endMinute;
  }
  // Overnight quiet hours (e.g., 22:00 (1320) to 07:00 (420))
  return localMinute >= startMinute || localMinute < endMinute;
}
