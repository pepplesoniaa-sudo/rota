import { AppError, ERROR_CODES } from '@rota/shared';
import { dbShard0 } from '../../db';
import { createHostedPaymentLink } from '../../billing/flutterwave/client';
import { logger } from '../../log';

export interface CheckoutResult {
  checkoutUrl: string;
  txRef: string;
}

/**
 * Creates a Flutterwave hosted checkout session for an unpaid charge (FR-35, B-11, MB-5).
 * Generates a new ChargeAttempt with unique txRef = {chargeId}-{attemptNo}.
 */
export async function createChargeCheckout(
  teamId: string,
  chargeId: string,
): Promise<CheckoutResult> {
  const charge = await dbShard0.charge.findUnique({
    where: { id: chargeId },
    include: {
      team: {
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
      },
      attempts: {
        select: { id: true, attemptNo: true },
        orderBy: { attemptNo: 'desc' },
      },
    },
  });

  if (!charge || charge.teamId !== teamId) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 404, 'Charge not found');
  }

  if (charge.status === 'PAID') {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 400, 'Charge is already paid');
  }

  // Calculate next attemptNo
  const lastAttempt = charge.attempts[0];
  const nextAttemptNo = (lastAttempt?.attemptNo ?? 0) + 1;
  const txRef = `${charge.id}-${nextAttemptNo}`;

  // 1. Commit new ChargeAttempt before calling provider (MB-7, B-11)
  const attempt = await dbShard0.chargeAttempt.create({
    data: {
      chargeId: charge.id,
      attemptNo: nextAttemptNo,
      txRef,
      method: 'CHECKOUT',
      amountCents: charge.amountCents,
      status: 'PENDING',
    },
  });

  // 2. Call Flutterwave to generate hosted payment link
  const redirectUrl = `rota://billing?tx_ref=${txRef}&status=successful`;
  const paymentLink = await createHostedPaymentLink({
    amountCents: charge.amountCents,
    txRef,
    email: charge.team.owner.email,
    title: `Rota - ${charge.team.name}`,
    redirectUrl,
  });

  // 3. Store checkout URL on attempt
  await dbShard0.chargeAttempt.update({
    where: { id: attempt.id },
    data: {
      checkoutUrl: paymentLink.link,
    },
  });

  logger.info(
    { chargeId: charge.id, attemptId: attempt.id, txRef },
    'Created hosted checkout link',
  );

  return {
    checkoutUrl: paymentLink.link,
    txRef,
  };
}
