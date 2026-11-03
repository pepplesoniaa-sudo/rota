import { describe, it, expect } from 'vitest';
import { calculateQuietHours } from '../../lib/time/quiet-hours';
import { DateTime } from 'luxon';

describe('PRD 6.3 & FR-28 / FR-28a Quiet Hours Calculation Rules', () => {
  const defaultZone = 'America/New_York';

  it('when quiet hours are disabled, delivers immediately at nowUtc', () => {
    const now = new Date('2026-11-03T03:30:00Z'); // 22:30 EST (inside standard quiet window)
    const result = calculateQuietHours(
      {
        timezone: defaultZone,
        quietHoursEnabled: false,
        quietStartMinute: 1320, // 22:00
        quietEndMinute: 420, // 07:00
      },
      now,
    );

    expect(result.inQuietHours).toBe(false);
    expect(result.scheduledFor.toISOString()).toBe(now.toISOString());
  });

  it('when outside quiet hours, delivers immediately at nowUtc', () => {
    // 14:00 local EDT in America/New_York is 18:00 UTC
    const now = new Date('2026-06-15T18:00:00Z');
    const result = calculateQuietHours(
      {
        timezone: defaultZone,
        quietHoursEnabled: true,
        quietStartMinute: 1320, // 22:00
        quietEndMinute: 420, // 07:00
      },
      now,
    );

    expect(result.inQuietHours).toBe(false);
    expect(result.scheduledFor.toISOString()).toBe(now.toISOString());
  });

  it('inside overnight quiet hours late evening: schedules for next morning at quietEndMinute', () => {
    // 23:15 EDT on 2026-06-15 in America/New_York is 2026-06-16T03:15:00Z
    const now = new Date('2026-06-16T03:15:00Z');
    const result = calculateQuietHours(
      {
        timezone: defaultZone,
        quietHoursEnabled: true,
        quietStartMinute: 1320, // 22:00
        quietEndMinute: 420, // 07:00
      },
      now,
    );

    expect(result.inQuietHours).toBe(true);

    // Expected release: 2026-06-16 at 07:00 EDT = 11:00 UTC
    const releaseLocal = DateTime.fromJSDate(result.scheduledFor, { zone: 'utc' }).setZone(
      defaultZone,
    );
    expect(releaseLocal.hour).toBe(7);
    expect(releaseLocal.minute).toBe(0);
    expect(releaseLocal.day).toBe(16);
    expect(result.scheduledFor.toISOString()).toBe('2026-06-16T11:00:00.000Z');
  });

  it('inside overnight quiet hours early morning: schedules for same morning at quietEndMinute', () => {
    // 04:30 EDT on 2026-06-16 in America/New_York is 2026-06-16T08:30:00Z
    const now = new Date('2026-06-16T08:30:00Z');
    const result = calculateQuietHours(
      {
        timezone: defaultZone,
        quietHoursEnabled: true,
        quietStartMinute: 1320, // 22:00
        quietEndMinute: 420, // 07:00
      },
      now,
    );

    expect(result.inQuietHours).toBe(true);

    const releaseLocal = DateTime.fromJSDate(result.scheduledFor, { zone: 'utc' }).setZone(
      defaultZone,
    );
    expect(releaseLocal.hour).toBe(7);
    expect(releaseLocal.minute).toBe(0);
    expect(releaseLocal.day).toBe(16);
    expect(result.scheduledFor.toISOString()).toBe('2026-06-16T11:00:00.000Z');
  });

  it('L50: repeated local time at quiet-hours end uses the first occurrence (DST Fall Back)', () => {
    // In America/New_York, DST fall back happens on 2026-11-01 at 02:00 -> 01:00
    // Suppose quietEndMinute is 01:30 (90 minutes from midnight)
    // At 23:00 on 2026-10-31 (03:00 UTC on 2026-11-01)
    const now = new Date('2026-11-01T03:00:00Z');
    const result = calculateQuietHours(
      {
        timezone: defaultZone,
        quietHoursEnabled: true,
        quietStartMinute: 1320, // 22:00
        quietEndMinute: 90, // 01:30
      },
      now,
    );

    expect(result.inQuietHours).toBe(true);
    // First occurrence of 01:30 is EDT (UTC-4) -> 05:30 UTC
    // Second occurrence would be EST (UTC-5) -> 06:30 UTC
    expect(result.scheduledFor.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('FR-28a: respects 8 hours after night shift when quietAfterNightShift is enabled', () => {
    // Staff member finishes night shift at 06:00 local EDT (10:00 UTC) on 2026-06-15
    const nightShiftEnd = new Date('2026-06-15T10:00:00Z');

    // Notification generated at 08:00 local EDT (12:00 UTC)
    // Standard quiet hours (22:00 to 07:00) ended at 07:00, but night shift sleep runs until 14:00 local (18:00 UTC)
    const now = new Date('2026-06-15T12:00:00Z');

    const result = calculateQuietHours(
      {
        timezone: defaultZone,
        quietHoursEnabled: true,
        quietStartMinute: 1320, // 22:00
        quietEndMinute: 420, // 07:00
        quietAfterNightShift: true,
        lastNightShiftEndUtc: nightShiftEnd,
      },
      now,
    );

    expect(result.inQuietHours).toBe(true);
    // Release should be 8 hours after 10:00 UTC = 18:00 UTC
    expect(result.scheduledFor.toISOString()).toBe('2026-06-15T18:00:00.000Z');
  });
});
