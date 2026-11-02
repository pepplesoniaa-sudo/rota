import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateProrationCents, calculateProrationFromDates } from '../../lib/billing/proration';

describe('B-5 / PRD 8.2 / PRD 8.3: Proration Formula', () => {
  // PRD 8.3: Golden Example 1: Seat added on Team
  it('computes Example 1 correctly (Seat added on Team -> 113 cents)', () => {
    // Period: 30 days = 2,592,000 s
    // remainingSeconds = 984,600 s
    // deltaCents = 300
    // proration = floor(300 * 984,600 / 2,592,000) = 113
    const result = calculateProrationCents({
      deltaCents: 300,
      remainingSeconds: 984600,
      periodSeconds: 2592000,
    });
    expect(result).toBe(113);

    // Also test calculateProrationFromDates with the exact ISO dates from PRD 8.3
    const fromDates = calculateProrationFromDates({
      deltaCents: 300,
      periodStart: new Date('2026-11-01T00:00:00Z'),
      periodEnd: new Date('2026-12-01T00:00:00Z'),
      changeInstant: new Date('2026-11-19T14:30:00Z'),
    });
    expect(fromDates).toBe(113);
  });

  // PRD 8.3: Golden Example 2: Upgrade from Starter to Team
  it('computes Example 2 correctly (Starter to Team -> 1998 cents)', () => {
    // Period: 28 days = 2,419,200 s
    // remainingSeconds = 1,611,780 s
    // deltaCents = 3000
    // proration = floor(3000 * 1,611,780 / 2,419,200) = 1998
    const result = calculateProrationCents({
      deltaCents: 3000,
      remainingSeconds: 1611780,
      periodSeconds: 2419200,
    });
    expect(result).toBe(1998);

    const fromDates = calculateProrationFromDates({
      deltaCents: 3000,
      periodStart: new Date('2026-02-01T00:00:00Z'),
      periodEnd: new Date('2026-03-01T00:00:00Z'),
      changeInstant: new Date('2026-02-10T08:17:00Z'),
    });
    expect(fromDates).toBe(1998);
  });

  // PRD 8.3: Golden Example 3: Upgrade from Team to Business with extra seats
  it('computes Example 3 correctly (Team to Business with extra seats -> 1753 cents)', () => {
    // Period: 31 days = 2,678,400 s
    // remainingSeconds = 958,470 s
    // deltaCents = 4900
    // proration = floor(4900 * 958,470 / 2,678,400) = 1753
    const result = calculateProrationCents({
      deltaCents: 4900,
      remainingSeconds: 958470,
      periodSeconds: 2678400,
    });
    expect(result).toBe(1753);

    const fromDates = calculateProrationFromDates({
      deltaCents: 4900,
      periodStart: new Date('2026-07-15T00:00:00Z'),
      periodEnd: new Date('2026-08-15T00:00:00Z'),
      changeInstant: new Date('2026-08-03T21:45:30Z'),
    });
    expect(fromDates).toBe(1753);
  });

  it('returns 0 when delta is not positive, remaining <= 0, or period <= 0', () => {
    expect(
      calculateProrationCents({ deltaCents: 0, remainingSeconds: 500, periodSeconds: 1000 }),
    ).toBe(0);
    expect(
      calculateProrationCents({ deltaCents: -500, remainingSeconds: 500, periodSeconds: 1000 }),
    ).toBe(0);
    expect(
      calculateProrationCents({ deltaCents: 500, remainingSeconds: 0, periodSeconds: 1000 }),
    ).toBe(0);
    expect(
      calculateProrationCents({ deltaCents: 500, remainingSeconds: -10, periodSeconds: 1000 }),
    ).toBe(0);
    expect(
      calculateProrationCents({ deltaCents: 500, remainingSeconds: 500, periodSeconds: 0 }),
    ).toBe(0);
  });

  // B-5 / G5: 10,000-case property test against a reference implementation
  it('satisfies 10,000 property checks against reference implementation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }), // delta up to $10,000
        fc.integer({ min: 1, max: 2_678_400 }), // period up to 31 days
        fc.integer({ min: 0, max: 2_678_400 }), // remaining seconds
        (deltaCents, periodSeconds, remainingSeconds) => {
          const result = calculateProrationCents({
            deltaCents,
            remainingSeconds,
            periodSeconds,
          });

          // Reference calculation: Math.floor(delta * remaining / period) using BigInt
          const expected = Number(
            (BigInt(deltaCents) * BigInt(remainingSeconds)) / BigInt(periodSeconds),
          );

          expect(result).toBe(expected);
          expect(result).toBeGreaterThanOrEqual(0);
          if (remainingSeconds <= periodSeconds) {
            expect(result).toBeLessThanOrEqual(deltaCents);
          }
        },
      ),
      { numRuns: 10000 },
    );
  });
});
