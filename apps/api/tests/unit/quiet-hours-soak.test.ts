import { describe, expect, it } from 'vitest';
import { calculateQuietHours } from '../../lib/time/quiet-hours';
import { DateTime } from 'luxon';

describe('PRD 6.3 / Phase 4 Exit Criteria 5: Quiet Hours 24-Hour Soak Audit', () => {
  interface SoakProfile {
    name: string;
    timezone: string;
    quietHoursEnabled: boolean;
    quietStartMinute: number;
    quietEndMinute: number;
    quietAfterNightShift: boolean;
    lastNightShiftEndUtc?: Date;
  }

  const profiles: SoakProfile[] = [
    {
      name: 'Standard Overnight (NYC, 22:00 - 07:00)',
      timezone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 1320, // 22:00
      quietEndMinute: 420, // 07:00
      quietAfterNightShift: false,
    },
    {
      name: 'Standard Overnight (London, 23:00 - 08:00)',
      timezone: 'Europe/London',
      quietHoursEnabled: true,
      quietStartMinute: 1380, // 23:00
      quietEndMinute: 480, // 08:00
      quietAfterNightShift: false,
    },
    {
      name: 'Standard Overnight (Tokyo, 21:00 - 06:00)',
      timezone: 'Asia/Tokyo',
      quietHoursEnabled: true,
      quietStartMinute: 1260, // 21:00
      quietEndMinute: 360, // 06:00
      quietAfterNightShift: false,
    },
    {
      name: 'Daytime Quiet Window (Sydney, 12:00 - 15:00)',
      timezone: 'Australia/Sydney',
      quietHoursEnabled: true,
      quietStartMinute: 720, // 12:00
      quietEndMinute: 900, // 15:00
      quietAfterNightShift: false,
    },
    {
      name: 'Quiet Hours Disabled (UTC)',
      timezone: 'UTC',
      quietHoursEnabled: false,
      quietStartMinute: 1320,
      quietEndMinute: 420,
      quietAfterNightShift: false,
    },
    {
      name: 'Night Shift 8h Sleep Protection (NYC, Night shift ended at 02:00 EDT / 06:00 UTC)',
      timezone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 1320,
      quietEndMinute: 420,
      quietAfterNightShift: true,
      // Shift ended at 02:00 EDT (06:00 UTC) on 2026-11-02, sleep protected until 10:00 EDT (14:00 UTC)
      lastNightShiftEndUtc: new Date('2026-11-02T06:00:00Z'),
    },
  ];

  it('Exit criteria 5: audit returns zero violations across a 24-hour soak (1440 minutes x 6 profiles)', () => {
    // Start of the soak: 2026-11-03T00:00:00Z
    const soakStart = DateTime.fromISO('2026-11-03T00:00:00Z', { zone: 'utc' });
    let totalChecks = 0;
    let quietViolations = 0;
    const violationLog: string[] = [];

    // Simulate every minute for 24 hours (1440 minutes)
    for (let minute = 0; minute < 1440; minute++) {
      const currentSimulatedTime = soakStart.plus({ minutes: minute }).toJSDate();

      for (const profile of profiles) {
        totalChecks++;

        const result = calculateQuietHours(
          {
            timezone: profile.timezone,
            quietHoursEnabled: profile.quietHoursEnabled,
            quietStartMinute: profile.quietStartMinute,
            quietEndMinute: profile.quietEndMinute,
            quietAfterNightShift: profile.quietAfterNightShift,
            lastNightShiftEndUtc: profile.lastNightShiftEndUtc,
          },
          currentSimulatedTime,
        );

        if (!profile.quietHoursEnabled) {
          // If disabled, must never be in quiet hours
          if (result.inQuietHours) {
            quietViolations++;
            violationLog.push(
              `[${profile.name}] Disabled quiet hours reported inQuietHours=true at ${currentSimulatedTime.toISOString()}`,
            );
          }
          continue;
        }

        if (result.inQuietHours) {
          // Rule 1: scheduledFor must be in the future (strictly greater than current simulated time)
          if (result.scheduledFor.getTime() <= currentSimulatedTime.getTime()) {
            quietViolations++;
            violationLog.push(
              `[${profile.name}] scheduledFor (${result.scheduledFor.toISOString()}) is not in the future of ${currentSimulatedTime.toISOString()}`,
            );
          }

          // Rule 2: scheduledFor must not be inside the recipient's quiet hours!
          // We audit this by checking calculateQuietHours at the scheduledFor timestamp.
          const checkAtScheduledFor = calculateQuietHours(
            {
              timezone: profile.timezone,
              quietHoursEnabled: profile.quietHoursEnabled,
              quietStartMinute: profile.quietStartMinute,
              quietEndMinute: profile.quietEndMinute,
              quietAfterNightShift: profile.quietAfterNightShift,
              lastNightShiftEndUtc: profile.lastNightShiftEndUtc,
            },
            result.scheduledFor,
          );

          if (checkAtScheduledFor.inQuietHours) {
            quietViolations++;
            violationLog.push(
              `[${profile.name}] scheduledFor (${result.scheduledFor.toISOString()}) falls INSIDE quiet hours when evaluated! Simulated time: ${currentSimulatedTime.toISOString()}`,
            );
          }
        }
      }
    }

    // Exit criteria 5: zero violations in a 24 h soak
    expect(violationLog).toEqual([]);
    // Verify 1440 min * 6 profiles = 8640 distinct checks performed
    expect(totalChecks).toBe(8640);
    expect(quietViolations).toBe(0);
  });
});
