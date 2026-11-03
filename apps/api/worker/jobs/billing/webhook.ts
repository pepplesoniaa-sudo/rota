import { z } from 'zod';
import { dbShard0 } from '../../../lib/db';
import { logger } from '../../../lib/log';
import { runInSystemScope } from '../../../lib/data/scope';
import { verifyTransaction } from '../../../lib/billing/flutterwave/client';
import { providerAmountToCents } from '../../../lib/billing/flutterwave/money';
import { encryptCardToken } from '../../../lib/billing/flutterwave/encryption';
import { createLedgerEntry } from '../../../lib/billing/ledger';
import { redis } from '../../../lib/redis';
import { LedgerEntryType, SubscriptionStatus } from '@prisma/client';

export const billingWebhookJobSchema = z
  .object({
    webhookEventId: z.string().uuid(),
  })
  .strict();

export type BillingWebhookJobData = z.infer<typeof billingWebhookJobSchema>;

/**
 * Worker handler for billing.webhook (PRD 6.2, FR-42, B-9, B-10, B-11, MB-5, MB-6, MB-8).
 * Runs in system tenant scope (B-20).
 */
export async function handleBillingWebhook(data: unknown): Promise<{
  processed: boolean;
  duplicate?: boolean;
  doublePayment?: boolean;
}> {
  const parsed = billingWebhookJobSchema.parse(data);
  const jobId = `webhook:${parsed.webhookEventId}`;

  return runInSystemScope(jobId, async () => {
    // 1. Load WebhookEvent
    const webhookEvent = await dbShard0.webhookEvent.findUnique({
      where: { id: parsed.webhookEventId },
    });

    if (!webhookEvent) {
      logger.warn({ webhookEventId: parsed.webhookEventId }, 'Webhook event not found');
      return { processed: false };
    }

    if (webhookEvent.status === 'PROCESSED') {
      logger.info({ webhookEventId: parsed.webhookEventId }, 'Webhook event already processed');
      return { processed: true, duplicate: true };
    }

    const payload = (webhookEvent.payload as Record<string, unknown>) ?? {};
    const eventData = (payload.data as Record<string, unknown>) ?? {};
    const transactionId = eventData.id ? String(eventData.id) : null;

    if (!transactionId) {
      logger.error(
        { webhookEventId: webhookEvent.id },
        'Missing transaction id in webhook payload',
      );
      await dbShard0.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FAILED', error: 'Missing transaction id' },
      });
      return { processed: false };
    }

    // 2. Server-side transaction verification (B-9 / MB-5)
    let verifyResult;
    try {
      verifyResult = await verifyTransaction(transactionId);
    } catch (err: unknown) {
      logger.error({ err, transactionId }, 'Failed to verify transaction with Flutterwave API');
      await dbShard0.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: 'FAILED',
          error: err instanceof Error ? err.message : 'Verification failed',
        },
      });
      return { processed: false };
    }

    const vData = verifyResult.data;
    const verifiedTxRef = vData.tx_ref;
    const verifiedStatus = vData.status;
    const verifiedCurrency = vData.currency;
    const verifiedAmountCents = providerAmountToCents(vData.amount);

    // 3. Find ChargeAttempt by txRef
    const attempt = await dbShard0.chargeAttempt.findUnique({
      where: { txRef: verifiedTxRef },
      include: {
        charge: {
          include: {
            team: {
              include: {
                subscription: true,
              },
            },
          },
        },
      },
    });

    if (!attempt) {
      logger.error({ verifiedTxRef }, 'No ChargeAttempt found for verified tx_ref (MB-6)');
      await dbShard0.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FAILED', error: `Unknown tx_ref: ${verifiedTxRef}` },
      });
      return { processed: false };
    }

    // 4. Exact match checks (MB-6 / B-9): amount in cents, currency USD, status successful
    const mismatches: string[] = [];
    if (verifiedStatus !== 'successful') {
      mismatches.push(`status expected successful, got ${verifiedStatus}`);
    }
    if (verifiedCurrency !== 'USD') {
      mismatches.push(`currency expected USD, got ${verifiedCurrency}`);
    }
    if (verifiedAmountCents !== attempt.amountCents) {
      mismatches.push(`amount expected ${attempt.amountCents}, got ${verifiedAmountCents}`);
    }

    if (mismatches.length > 0) {
      const errorMsg = mismatches.join('; ');
      logger.error({ errorMsg, verifiedTxRef }, 'Transaction verification mismatch (MB-6)');
      await dbShard0.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FAILED', error: errorMsg },
      });
      return { processed: false };
    }

    // 5. In single transaction on shard 0 (MB-8), update state and write ledger
    const teamId = attempt.charge.teamId;
    const charge = attempt.charge;
    const now = new Date();

    const result = await dbShard0.$transaction(async (tx) => {
      // Check if attempt already marked PAID (duplicate webhook)
      if (attempt.status === 'PAID') {
        logger.info(
          { txRef: attempt.txRef },
          'Attempt already marked PAID; duplicate webhook (B-10)',
        );
        await tx.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { status: 'PROCESSED', processedAt: now },
        });
        return { processed: true, duplicate: true };
      }

      // Check if charge already marked PAID via another attempt (DOUBLE_PAYMENT, B-11)
      if (charge.status === 'PAID') {
        logger.warn(
          { chargeId: charge.id, txRef: attempt.txRef },
          'Charge already PAID by another attempt; recording DOUBLE_PAYMENT (B-11)',
        );

        await tx.chargeAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'PAID',
            providerTxId: String(vData.id),
            lastVerifyStatus: vData.status,
            lastVerifiedAt: now,
          },
        });

        // Still record PAYMENT_CONFIRMED because money arrived (B-11)
        await createLedgerEntry(tx, {
          teamId,
          chargeId: charge.id,
          type: LedgerEntryType.PAYMENT_CONFIRMED,
          amountCents: -attempt.amountCents, // Negative for money received (PRD 8.7)
          currency: 'USD',
          idempotencyKey: `payment:${vData.id}`,
          description: `Double payment confirmed (tx ${vData.id})`,
          metadata: { doublePayment: true, txRef: attempt.txRef },
          occurredAt: now,
        });

        await tx.webhookEvent.update({
          where: { id: webhookEvent.id },
          data: { status: 'PROCESSED', processedAt: now },
        });

        return { processed: true, doublePayment: true };
      }

      // First successful payment
      // Conditional update on charge status <> 'PAID' (B-11)
      await tx.chargeAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'PAID',
          providerTxId: String(vData.id),
          lastVerifyStatus: vData.status,
          lastVerifiedAt: now,
        },
      });

      await tx.charge.update({
        where: { id: charge.id },
        data: {
          status: 'PAID',
          paidAt: now,
        },
      });

      // Write PAYMENT_CONFIRMED ledger entry (MB-9: payment:{providerTxId})
      await createLedgerEntry(tx, {
        teamId,
        chargeId: charge.id,
        type: LedgerEntryType.PAYMENT_CONFIRMED,
        amountCents: -attempt.amountCents, // Negative for money received (PRD 8.7)
        currency: 'USD',
        idempotencyKey: `payment:${vData.id}`,
        description: `Payment confirmed (tx ${vData.id})`,
        metadata: { txRef: attempt.txRef, flwRef: vData.flw_ref },
        occurredAt: now,
      });

      // If renewal charge collected deferred prorations, mark each collected deferred charge PAID (PRD 8.4, MB-8)
      const lineItems = (charge.lineItems as Array<{ deferredChargeId?: string }>) ?? [];
      for (const item of lineItems) {
        if (item.deferredChargeId) {
          await tx.charge.updateMany({
            where: { id: item.deferredChargeId, status: 'DEFERRED' },
            data: {
              status: 'PAID',
              collectedByChargeId: charge.id,
              paidAt: now,
            },
          });
        }
      }

      // Save card token if first successful payment and card details present (B-17, PRD 8.5)
      if (vData.card?.token) {
        const existingCard = await tx.paymentMethod.findFirst({
          where: { teamId, disabledAt: null },
        });

        if (!existingCard) {
          const encryptedToken = encryptCardToken(vData.card.token);
          const [expMonthStr, expYearStr] = (vData.card.expiry ?? '12/99').split('/');
          const parsedMonth = parseInt(expMonthStr ?? '12', 10);
          const parsedYear = parseInt(`20${expYearStr ?? '99'}`, 10);

          await tx.paymentMethod.create({
            data: {
              teamId,
              providerTokenEncrypted: encryptedToken,
              cardBrand: vData.card.type ?? 'CARD',
              cardLast4: vData.card.last_4digits ?? '0000',
              expMonth: Number.isFinite(parsedMonth) ? parsedMonth : 12,
              expYear: Number.isFinite(parsedYear) ? parsedYear : 2099,
            },
          });
        }
      }

      // Update Subscription to ACTIVE and clear grace fields (FR-40, PRD 8.6)
      await tx.subscription.update({
        where: { teamId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          graceEndsAt: null,
          readOnlySince: null,
          version: { increment: 1 },
        },
      });

      // Mark WebhookEvent PROCESSED
      await tx.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: 'PROCESSED',
          processedAt: now,
        },
      });

      return { processed: true };
    });

    try {
      await redis.del(`team:${teamId}`);
    } catch {
      // Non-fatal
    }

    return result;
  });
}
