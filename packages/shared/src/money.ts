/**
 * MB-1 & MB-3: Safe integer money formatting.
 * Cents become display text only through formatUsd(cents).
 * Uses pure string/integer math without floats, .toFixed, or division operators.
 */
export function formatUsd(cents: number | bigint): string {
  if (typeof cents === 'number' && !Number.isSafeInteger(cents)) {
    throw new TypeError('Amount must be a safe integer');
  }

  const isNegative = typeof cents === 'bigint' ? cents < 0n : cents < 0;
  const absVal =
    typeof cents === 'bigint' ? (isNegative ? -cents : cents) : isNegative ? -cents : cents;

  const rawStr = absVal.toString();
  const padded = rawStr.padStart(3, '0');
  const dollars = padded.slice(0, -2);
  const centsPart = padded.slice(-2);

  const sign = isNegative ? '-' : '';
  return `${sign}$${dollars}.${centsPart}`;
}
