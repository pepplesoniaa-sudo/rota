/**
 * MB-4 & B-2: Flutterwave decimal string conversion without float math.
 * Never multiplies or divides by 100.
 */

const PROVIDER_AMOUNT_REGEX = /^\d+(\.\d{1,2})?$/;

/**
 * Formats integer cents into a Flutterwave 2-decimal string.
 * Example: 7100 -> "71.00", 87 -> "0.87", 0 -> "0.00"
 */
export function centsToProviderAmount(cents: number | bigint): string {
  if (typeof cents === 'number') {
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new TypeError('Amount must be a non-negative safe integer');
    }
  } else if (cents < 0n) {
    throw new TypeError('Amount must be non-negative');
  }

  const rawStr = cents.toString();
  const padded = rawStr.padStart(3, '0');
  const dollars = padded.slice(0, -2);
  const decimals = padded.slice(-2);

  return `${dollars}.${decimals}`;
}

/**
 * Parses a provider decimal string into integer cents using string math.
 * Strictly rejects exponents, negatives, and precision beyond 2 decimal places.
 * Example: "71.00" -> 7100, "71.1" -> 7110, "0.87" -> 87
 */
export function providerAmountToCents(amount: string | number): number {
  const str = typeof amount === 'string' ? amount.trim() : String(amount);

  if (!PROVIDER_AMOUNT_REGEX.test(str)) {
    throw new TypeError(
      `Invalid provider amount format: "${str}". Must match ^\\d+(\\.\\d{1,2})?$`,
    );
  }

  const parts = str.split('.');
  const dollars = parts[0] ?? '0';
  const decimals = (parts[1] ?? '').padEnd(2, '0');

  const combinedDigits = `${dollars}${decimals}`;
  // Strip leading zeros unless it's just '0'
  const sanitized = combinedDigits.replace(/^0+(?=\d)/, '');
  const cents = Number(sanitized);

  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('Parsed amount exceeds safe integer range');
  }

  return cents;
}
