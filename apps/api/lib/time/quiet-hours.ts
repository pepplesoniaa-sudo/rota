import { DateTime } from 'luxon';
import { isWithinQuietHours } from './index';

export interface QuietHoursConfig {
  timezone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number; // e.g. 1320 (22:00)
  quietEndMinute: number; // e.g. 420 (07:00)
  quietAfterNightShift?: boolean; // FR-28a
  lastNightShiftEndUtc?: Date | null;
}

export interface QuietHoursResult {
  inQuietHours: boolean;
  scheduledFor: Date;
  quietWindow: {
    timezone: string;
    quietStartMinute: number;
    quietEndMinute: number;
  };
}

/**
 * Calculates whether now is within quiet hours and when notifications should be released.
 * Follows PRD 6.3 notification scheduling rule:
 * 1. Convert now to recipient local time with Luxon.
 * 2. If quiet hours are on and local now is inside window:
 *    Set scheduledFor to next local time equal to quietEndMinute, converted to UTC.
 *    If local time does not exist (DST spring forward), use first valid minute after it.
 *    If local time happens twice (DST fall back), use first occurrence (L50).
 * 3. If FR-28a is on, 8 hours after a night shift count as quiet hours.
 */
export function calculateQuietHours(
  config: QuietHoursConfig,
  nowUtc: Date = new Date(),
): QuietHoursResult {
  const {
    timezone,
    quietHoursEnabled,
    quietStartMinute,
    quietEndMinute,
    quietAfterNightShift = false,
    lastNightShiftEndUtc,
  } = config;

  const quietWindow = {
    timezone,
    quietStartMinute,
    quietEndMinute,
  };

  // If quiet hours disabled, deliver immediately
  if (!quietHoursEnabled) {
    return {
      inQuietHours: false,
      scheduledFor: nowUtc,
      quietWindow,
    };
  }

  const nowDt = DateTime.fromJSDate(nowUtc, { zone: 'utc' }).setZone(timezone);
  const currentMinute = nowDt.hour * 60 + nowDt.minute;

  const inStandardQuiet = isWithinQuietHours(currentMinute, quietStartMinute, quietEndMinute);

  // FR-28a: Check night shift sleep window (8 hours post night-shift end)
  let inNightShiftQuiet = false;
  let nightShiftReleaseDate: Date | null = null;
  if (quietAfterNightShift && lastNightShiftEndUtc) {
    const nightShiftEndMs = lastNightShiftEndUtc.getTime();
    const eightHoursMs = 8 * 60 * 60 * 1000;
    const nightShiftSleepEndMs = nightShiftEndMs + eightHoursMs;
    if (nowUtc.getTime() >= nightShiftEndMs && nowUtc.getTime() < nightShiftSleepEndMs) {
      inNightShiftQuiet = true;
      nightShiftReleaseDate = new Date(nightShiftSleepEndMs);
    }
  }

  if (!inStandardQuiet && !inNightShiftQuiet) {
    return {
      inQuietHours: false,
      scheduledFor: nowUtc,
      quietWindow,
    };
  }

  if (!inStandardQuiet && inNightShiftQuiet && nightShiftReleaseDate) {
    return {
      inQuietHours: true,
      scheduledFor: nightShiftReleaseDate,
      quietWindow,
    };
  }

  // Calculate standard quiet end in recipient's local time
  const endHour = Math.floor(quietEndMinute / 60);
  const endMin = quietEndMinute % 60;

  let targetDate = nowDt;
  if (quietStartMinute <= quietEndMinute) {
    // Same day window, e.g. 13:00 to 15:00
    if (currentMinute >= quietEndMinute) {
      targetDate = nowDt.plus({ days: 1 });
    }
  } else {
    // Overnight window, e.g. 22:00 to 07:00
    // If currently after 22:00, quiet end is tomorrow morning.
    // If currently before 07:00, quiet end is today morning.
    if (currentMinute >= quietStartMinute) {
      targetDate = nowDt.plus({ days: 1 });
    }
  }

  // Construct target DateTime in recipient local time
  let candidateDt = targetDate.set({
    hour: endHour,
    minute: endMin,
    second: 0,
    millisecond: 0,
  });

  // Handle DST Fall Back: L50 "Repeated local time at quiet-hours end uses the first occurrence"
  // If the target minute falls in a fallback overlap window, select the earlier instant (first occurrence).
  const earlierOffset = candidateDt.minus({ hours: 2 }).offset;
  const laterOffset = candidateDt.plus({ hours: 2 }).offset;
  if (earlierOffset !== laterOffset) {
    // Compare candidates with earlier and later offsets
    const dtEarlier = candidateDt.set({ hour: endHour, minute: endMin });
    const candOffsetDiff = earlierOffset - candidateDt.offset;
    if (candOffsetDiff !== 0) {
      const dtCand = candidateDt.minus({ minutes: candOffsetDiff }).setZone(timezone);
      if (
        dtCand.hour === endHour &&
        dtCand.minute === endMin &&
        dtCand.toMillis() < dtEarlier.toMillis()
      ) {
        candidateDt = dtCand;
      }
    }
  }

  // Handle DST Spring Forward: if local time doesn't exist, Luxon advances past gap
  // Ensure candidateDt is strictly after nowDt
  if (candidateDt.toMillis() <= nowDt.toMillis()) {
    candidateDt = candidateDt.plus({ days: 1 });
  }

  let finalScheduledFor = candidateDt.toUTC().toJSDate();

  // If night shift release date is also active and later, respect whichever releases later
  if (inNightShiftQuiet && nightShiftReleaseDate) {
    if (nightShiftReleaseDate.getTime() > finalScheduledFor.getTime()) {
      finalScheduledFor = nightShiftReleaseDate;
    }
  }

  return {
    inQuietHours: true,
    scheduledFor: finalScheduledFor,
    quietWindow,
  };
}
