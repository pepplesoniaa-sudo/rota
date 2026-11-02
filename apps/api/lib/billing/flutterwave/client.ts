import { env } from '../../config/env';
import { logger } from '../../log';
import { centsToProviderAmount } from './money';

const FLW_BASE_URL = 'https://api.flutterwave.com/v3';

export interface TokenizedChargeParams {
  token: string;
  amountCents: number;
  txRef: string;
  email: string;
}

export interface HostedPaymentLinkParams {
  amountCents: number;
  txRef: string;
  email: string;
  title: string;
  redirectUrl: string;
}

export interface FlwVerifyResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    flw_ref: string;
    amount: number | string;
    currency: string;
    status: 'successful' | 'failed' | string;
    card?: {
      first_6digits?: string;
      last_4digits?: string;
      issuer?: string;
      type?: string;
      token?: string;
      expiry?: string;
    };
  };
}

/**
 * Executes a tokenized card charge for renewals and seat additions.
 * PRD 6.2 (billing.charge) / B-1 / B-2 / B-3.
 */
export async function chargeTokenizedCard(
  params: TokenizedChargeParams,
): Promise<{ success: boolean; data: unknown }> {
  const payload = {
    token: params.token,
    currency: 'USD',
    amount: centsToProviderAmount(params.amountCents),
    email: params.email,
    tx_ref: params.txRef,
  };

  logger.info(
    { txRef: params.txRef, amountCents: params.amountCents },
    'Executing Flutterwave tokenized charge',
  );

  const res = await fetch(`${FLW_BASE_URL}/tokenized-charges`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FLW_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseBody = (await res.json()) as { status: string; data: unknown };
  return {
    success: res.ok && responseBody.status === 'success',
    data: responseBody.data,
  };
}

/**
 * Server-side transaction verification.
 * PRD 7.10 / B-9: GET /v3/transactions/{id}/verify.
 */
export async function verifyTransaction(
  transactionId: number | string,
): Promise<FlwVerifyResponse> {
  const res = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/verify`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${env.FLW_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Flutterwave transaction verification failed with status ${res.status}`);
  }

  return (await res.json()) as FlwVerifyResponse;
}

/**
 * Requests Flutterwave to resend a webhook for an unconfirmed transaction.
 * PRD 6.2 (billing.reconcile).
 */
export async function resendTransactionWebhook(transactionId: number | string): Promise<boolean> {
  const res = await fetch(`${FLW_BASE_URL}/transactions/${transactionId}/resend-hook`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FLW_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  return res.ok;
}

/**
 * Creates a hosted checkout payment link for first-time payment.
 * PRD 8.5 / FR-35.
 */
export async function createHostedPaymentLink(
  params: HostedPaymentLinkParams,
): Promise<{ link: string }> {
  const payload = {
    tx_ref: params.txRef,
    amount: centsToProviderAmount(params.amountCents),
    currency: 'USD',
    redirect_url: params.redirectUrl,
    customer: {
      email: params.email,
    },
    customizations: {
      title: params.title,
    },
  };

  const res = await fetch(`${FLW_BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FLW_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = (await res.json()) as { data?: { link?: string } };
  if (!res.ok || !body.data?.link) {
    throw new Error('Failed to generate Flutterwave payment link');
  }

  return { link: body.data.link };
}
