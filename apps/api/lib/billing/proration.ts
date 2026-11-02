/**
 * B-5 / PRD 8.2: Pure proration calculation.
 *
 * Formula:
 * periodSeconds    = currentPeriodEnd - currentPeriodStart (integer seconds)
 * remainingSeconds = currentPeriodEnd - changeInstant (integer seconds, ms truncated)
 * deltaCents       = monthlyPrice(newPlan, newPaidSeats) - monthlyPrice(oldPlan, oldPaidSeats)
 * prorationCents   = deltaCents > 0 ? floor(deltaCents * remainingSeconds / periodSeconds) : 0
 *
 * MB-1: Proration code lives only in proration.ts
 * MB-2: Pure function, takes every input as argument, never reads the clock or db.
 * MB-3: Safe integers, BigInt product and division only.
 */

export interface ProrationInput {
  deltaCents: number;
  remainingSeconds: number;
  periodSeconds: number;
}

export function calculateProrationCents(input: ProrationInput): number {
  const { deltaCents, remainingSeconds, periodSeconds } = input;

  if (!Number.isSafeInteger(deltaCents)) {
    throw new Error('deltaCents must be a safe integer');
  }
  if (!Number.isSafeInteger(remainingSeconds)) {
    throw new Error('remainingSeconds must be a safe integer');
  }
  if (!Number.isSafeInteger(periodSeconds)) {
    throw new Error('periodSeconds must be a safe integer');
  }

  if (deltaCents <= 0 || remainingSeconds <= 0 || periodSeconds <= 0) {
    return 0;
  }

  const delta = BigInt(deltaCents);
  const remaining = BigInt(remainingSeconds);
  const period = BigInt(periodSeconds);

  // BigInt division truncates towards zero (exact mathematical floor for positive integers)
  const product = delta * remaining;
  const prorationBig = product / period;
  const result = Number(prorationBig);

  if (!Number.isSafeInteger(result)) {
    throw new Error('Calculated proration is not a safe integer');
  }

  return result;
}

export function calculateProrationFromDates(params: {
  deltaCents: number;
  periodStart: Date;
  periodEnd: Date;
  changeInstant: Date;
}): number {
  if (!Number.isSafeInteger(params.deltaCents)) {
    throw new Error('deltaCents must be a safe integer');
  }

  // Convert milliseconds to integer seconds with ms truncated using BigInt division per MB-3
  const startMs = BigInt(params.periodStart.getTime());
  const endMs = BigInt(params.periodEnd.getTime());
  const changeMs = BigInt(params.changeInstant.getTime());

  const periodSecondsBig = (endMs - startMs) / 1000n;
  const remainingSecondsBig = (endMs - changeMs) / 1000n;

  return calculateProrationCents({
    deltaCents: params.deltaCents,
    remainingSeconds: Number(remainingSecondsBig),
    periodSeconds: Number(periodSecondsBig),
  });
}

