import { describe, expect, it, vi } from 'vitest';
import { formatUsd } from '@rota/shared';
import {
  chargeTokenizedCard,
  createHostedPaymentLink,
  resendTransactionWebhook,
  verifyTransaction,
} from '../../lib/billing/flutterwave/client';
import { decryptCardToken, encryptCardToken } from '../../lib/billing/flutterwave/encryption';
import { centsToProviderAmount, providerAmountToCents } from '../../lib/billing/flutterwave/money';
import { verifyWebhookSignature } from '../../lib/billing/flutterwave/signature';
import { env } from '../../lib/config/env';

describe('Flutterwave Spike: Money & String Math (B-1, B-2, MB-4)', () => {
  it('converts integer cents to 2-decimal provider amount string without float math', () => {
    expect(centsToProviderAmount(7100)).toBe('71.00');
    expect(centsToProviderAmount(87)).toBe('0.87');
    expect(centsToProviderAmount(0)).toBe('0.00');
    expect(centsToProviderAmount(5)).toBe('0.05');
    expect(centsToProviderAmount(2000)).toBe('20.00');
    expect(centsToProviderAmount(5000)).toBe('50.00');
    expect(centsToProviderAmount(12000)).toBe('120.00');

    // BigInt support
    expect(centsToProviderAmount(5000n)).toBe('50.00');

    // Reject non-safe integers or negatives
    expect(() => centsToProviderAmount(-100)).toThrow();
    expect(() => centsToProviderAmount(100.5)).toThrow();
  });

  it('parses provider decimal string into integer cents using string math', () => {
    expect(providerAmountToCents('71.00')).toBe(7100);
    expect(providerAmountToCents('71.1')).toBe(7110);
    expect(providerAmountToCents('71')).toBe(7100);
    expect(providerAmountToCents('0.87')).toBe(87);
    expect(providerAmountToCents('0.5')).toBe(50);
    expect(providerAmountToCents('0.00')).toBe(0);
    expect(providerAmountToCents('0')).toBe(0);
    expect(providerAmountToCents(50)).toBe(5000);

    // Reject exponents, negatives, or extra decimal places
    expect(() => providerAmountToCents('1e5')).toThrow();
    expect(() => providerAmountToCents('-50.00')).toThrow();
    expect(() => providerAmountToCents('71.125')).toThrow();
    expect(() => providerAmountToCents('invalid')).toThrow();
  });

  it('formats cents into user-facing USD display string (formatUsd)', () => {
    expect(formatUsd(5000)).toBe('$50.00');
    expect(formatUsd(87)).toBe('$0.87');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(-5087)).toBe('-$50.87');
    expect(formatUsd(12000n)).toBe('$120.00');
  });
});

describe('Flutterwave Spike: Constant-Time Webhook Signature Verification (B-10)', () => {
  it('validates secret hash in constant time', () => {
    expect(verifyWebhookSignature(env.FLW_SECRET_HASH)).toBe(true);

    // Invalid hash
    expect(verifyWebhookSignature('wrong-signature-hash')).toBe(false);

    // Mismatched length does not throw and returns false
    expect(verifyWebhookSignature('a')).toBe(false);
    expect(verifyWebhookSignature('a'.repeat(256))).toBe(false);

    // Null or undefined
    expect(verifyWebhookSignature(null)).toBe(false);
    expect(verifyWebhookSignature(undefined)).toBe(false);
    expect(verifyWebhookSignature('')).toBe(false);
  });
});

describe('Flutterwave Spike: AES-256-GCM Card Token Encryption (B-17)', () => {
  it('encrypts and decrypts card tokens securely', () => {
    const cardToken = 'flw-t1nf-018f3a2c7b4d-mock-token';
    const encrypted = encryptCardToken(cardToken);

    // Format is iv:authTag:ciphertext
    expect(encrypted.split(':')).toHaveLength(3);
    expect(encrypted).not.toContain(cardToken);

    const decrypted = decryptCardToken(encrypted);
    expect(decrypted).toBe(cardToken);
  });

  it('fails decryption on tampered payload or tag', () => {
    const cardToken = 'flw-t1nf-test-token';
    const encrypted = encryptCardToken(cardToken);
    const parts = encrypted.split(':');

    // Tamper with ciphertext
    const tamperedCiphertext = `${parts[0]}:${parts[1]}:${parts[2]?.slice(0, -2)}ff`;
    expect(() => decryptCardToken(tamperedCiphertext)).toThrow();

    // Tamper with auth tag
    const tamperedTag = `${parts[0]}:00000000000000000000000000000000:${parts[2]}`;
    expect(() => decryptCardToken(tamperedTag)).toThrow();
  });
});

describe('Flutterwave Spike: API Client Contract (PRD 6.2, 7.10, 8.5)', () => {
  it('executes tokenized charge with USD currency and string amount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          id: 12345,
          tx_ref: 'charge-1-1',
          amount: '50.00',
          currency: 'USD',
          status: 'successful',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await chargeTokenizedCard({
      token: 'card-token-xyz',
      amountCents: 5000,
      txRef: 'charge-1-1',
      email: 'owner@clinic.com',
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.flutterwave.com/v3/tokenized-charges',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'card-token-xyz',
          currency: 'USD',
          amount: '50.00',
          email: 'owner@clinic.com',
          tx_ref: 'charge-1-1',
        }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('verifies transaction endpoint contract', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        message: 'Tx Fetched',
        data: {
          id: 9999,
          tx_ref: 'charge-9-1',
          flw_ref: 'FLW-MOCK-REF',
          amount: 50,
          currency: 'USD',
          status: 'successful',
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const response = await verifyTransaction(9999);
    expect(response.data.id).toBe(9999);
    expect(response.data.currency).toBe('USD');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.flutterwave.com/v3/transactions/9999/verify',
      expect.objectContaining({ method: 'GET' }),
    );

    vi.unstubAllGlobals();
  });

  it('calls resend-hook endpoint for reconcile job', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'success' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const ok = await resendTransactionWebhook(8888);
    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.flutterwave.com/v3/transactions/8888/resend-hook',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  it('generates hosted checkout payment link with USD and string amount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/test-link' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { link } = await createHostedPaymentLink({
      amountCents: 5000,
      txRef: 'charge-first-pay',
      email: 'owner@clinic.com',
      title: 'Rota Subscription',
      redirectUrl: 'rota://checkout-complete',
    });

    expect(link).toBe('https://checkout.flutterwave.com/v3/hosted/pay/test-link');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.flutterwave.com/v3/payments',
      expect.objectContaining({
        body: JSON.stringify({
          tx_ref: 'charge-first-pay',
          amount: '50.00',
          currency: 'USD',
          redirect_url: 'rota://checkout-complete',
          customer: { email: 'owner@clinic.com' },
          customizations: { title: 'Rota Subscription' },
        }),
      }),
    );

    vi.unstubAllGlobals();
  });
});
