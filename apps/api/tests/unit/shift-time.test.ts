import { describe, expect, it } from 'vitest';
import { AppError } from '@rota/shared';
import { parseLocalToUtc, validateShiftDuration } from '../../lib/time';

describe('Shift Time and Duration Calculations (FR-15, L-14, L-36)', () => {
  const chicago = 'America/Chicago';

  describe('Spring forward gap (SHIFT_TIME_NONEXISTENT)', () => {
    it('throws 400 SHIFT_TIME_NONEXISTENT for 02:30 on 2026-03-08 in America/Chicago', () => {
      expect(() => {
        parseLocalToUtc('2026-03-08T02:30:00', chicago);
      }).toThrowError(AppError);

      try {
        parseLocalToUtc('2026-03-08T02:30:00', chicago);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('SHIFT_TIME_NONEXISTENT');
        expect((err as AppError).status).toBe(400);
      }
    });

    it('resolves valid time before and after spring forward transition', () => {
      const before = parseLocalToUtc('2026-03-08T01:30:00', chicago);
      expect(before.isValid).toBe(true);
      expect(before.toISO()).toBe('2026-03-08T07:30:00.000Z');

      const after = parseLocalToUtc('2026-03-08T03:30:00', chicago);
      expect(after.isValid).toBe(true);
      expect(after.toISO()).toBe('2026-03-08T08:30:00.000Z');
    });
  });

  describe('Fall back ambiguous time (startsUseLaterOffset)', () => {
    it('uses earlier instant by default for 01:30 on 2026-11-01 in America/Chicago', () => {
      const earlier = parseLocalToUtc('2026-11-01T01:30:00', chicago, false);
      expect(earlier.toISO()).toBe('2026-11-01T06:30:00.000Z');
    });

    it('uses later instant when useLaterOffset is true for 01:30 on 2026-11-01 in America/Chicago', () => {
      const later = parseLocalToUtc('2026-11-01T01:30:00', chicago, true);
      expect(later.toISO()).toBe('2026-11-01T07:30:00.000Z');
    });
  });

  describe('PRD 5.4 Worked Examples in America/Chicago', () => {
    it('calculates 9-hour shift across fall back: 22:00 on 2026-10-31 to 06:00 on 2026-11-01', () => {
      const start = parseLocalToUtc('2026-10-31T22:00:00', chicago);
      const end = parseLocalToUtc('2026-11-01T06:00:00', chicago);

      const minutes = validateShiftDuration(start, end);
      expect(minutes).toBe(9 * 60); // 9 hours
    });

    it('calculates 8-hour shift normal night: 22:00 on 2026-11-01 to 06:00 on 2026-11-02', () => {
      const start = parseLocalToUtc('2026-11-01T22:00:00', chicago);
      const end = parseLocalToUtc('2026-11-02T06:00:00', chicago);

      const minutes = validateShiftDuration(start, end);
      expect(minutes).toBe(8 * 60); // 8 hours
    });

    it('calculates 7-hour shift across spring forward: 22:00 on 2026-03-07 to 06:00 on 2026-03-08', () => {
      const start = parseLocalToUtc('2026-03-07T22:00:00', chicago);
      const end = parseLocalToUtc('2026-03-08T06:00:00', chicago);

      const minutes = validateShiftDuration(start, end);
      expect(minutes).toBe(7 * 60); // 7 hours
    });
  });

  describe('Shift duration limits (15 min to 16 hours, L-36)', () => {
    it('accepts minimum duration of 15 minutes', () => {
      const start = parseLocalToUtc('2026-11-03T09:00:00', chicago);
      const end = parseLocalToUtc('2026-11-03T09:15:00', chicago);
      expect(validateShiftDuration(start, end)).toBe(15);
    });

    it('rejects duration under 15 minutes with 400 SHIFT_DURATION_INVALID', () => {
      const start = parseLocalToUtc('2026-11-03T09:00:00', chicago);
      const end = parseLocalToUtc('2026-11-03T09:14:00', chicago);

      try {
        validateShiftDuration(start, end);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('SHIFT_DURATION_INVALID');
        expect((err as AppError).status).toBe(400);
      }
    });

    it('accepts maximum duration of 16 hours', () => {
      const start = parseLocalToUtc('2026-11-03T07:00:00', chicago);
      const end = parseLocalToUtc('2026-11-03T23:00:00', chicago);
      expect(validateShiftDuration(start, end)).toBe(16 * 60);
    });

    it('rejects duration over 16 hours with 400 SHIFT_DURATION_INVALID', () => {
      const start = parseLocalToUtc('2026-11-03T07:00:00', chicago);
      const end = parseLocalToUtc('2026-11-03T23:01:00', chicago);

      try {
        validateShiftDuration(start, end);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('SHIFT_DURATION_INVALID');
        expect((err as AppError).status).toBe(400);
      }
    });

    it('rejects end time before start time with 400 SHIFT_DURATION_INVALID', () => {
      const start = parseLocalToUtc('2026-11-03T10:00:00', chicago);
      const end = parseLocalToUtc('2026-11-03T09:00:00', chicago);

      try {
        validateShiftDuration(start, end);
        expect.unreachable('Should have thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('SHIFT_DURATION_INVALID');
        expect((err as AppError).status).toBe(400);
      }
    });
  });
});
