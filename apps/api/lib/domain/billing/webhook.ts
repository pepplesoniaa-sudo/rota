import { AppError, ERROR_CODES } from '@rota/shared';
import { dbShard0 } from '../../db';
import { verifyWebhookSignature } from '../../billing/flutterwave/signature';
import { logger } from '../../log';
import { getQueue, JobId, JOB_RETRY_POLICIES } from '../../../worker/queues';
import { Prisma } from '@prisma/client';

export interface WebhookResult {
  received: boolean;
}

/**
 * Handles incoming Flutterwave webhook (FR-42, B-10, MB-5, MB-6).
 * Verifies verif-hash in constant time, stores event and enqueues billing.webhook job.
 */
export async function handleFlutterwaveWebhook(
  body: Record<string, unknown>,
  signatureHeader?: string | null,
): Promise<WebhookResult> {
  // 1. Compare verif-hash in constant time (B-10)
  const isValid = verifyWebhookSignature(signatureHeader);
  if (!isValid) {
    logger.warn({ signatureHeader }, 'Webhook signature mismatch (B-10)');
    throw new AppError(ERROR_CODES.WEBHOOK_SIGNATURE_INVALID, 401, 'Invalid webhook signature');
  }

  // 2. Extract provider event key
  const data = (body.data as Record<string, unknown>) ?? {};
  const providerEventKey = String(data.id ?? data.flw_ref ?? body.id ?? crypto.randomUUID());
  const eventType = String(body.event ?? body['event.type'] ?? 'charge.completed');

  // 3. Store WebhookEvent (idempotent by providerEventKey, PRD 6.2)
  let webhookEventId: string;
  try {
    const webhookEvent = await dbShard0.webhookEvent.create({
      data: {
        provider: 'flutterwave',
        providerEventKey,
        eventType,
        payload: body as Prisma.InputJsonValue,
        status: 'RECEIVED',
      },
    });
    webhookEventId = webhookEvent.id;
  } catch (err: unknown) {
    if (
      (err as { code?: string })?.code === 'P2002' ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
    ) {
      logger.info({ providerEventKey }, 'Duplicate webhook event received; skipping re-queue');
      return { received: true };
    }
    throw err;
  }

  // 4. Enqueue billing.webhook job (B-10: returns 200 within 2s, processes in worker)
  const billingQueue = getQueue('billing');
  await billingQueue.add(
    'billing.webhook',
    { webhookEventId },
    {
      jobId: JobId.billingWebhook(providerEventKey),
      ...JOB_RETRY_POLICIES['billing.webhook'],
    },
  );

  logger.info({ providerEventKey, webhookEventId }, 'Enqueued billing.webhook job');
  return { received: true };
}
