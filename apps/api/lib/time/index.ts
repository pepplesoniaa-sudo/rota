import { DateTime } from 'luxon';

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
