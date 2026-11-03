import { z } from 'zod';
import { Plan } from '../enums';

export const changePlanBodySchema = z
  .object({
    plan: z.nativeEnum(Plan),
  })
  .strict();

export type ChangePlanBody = z.infer<typeof changePlanBodySchema>;

export const checkoutParamsSchema = z
  .object({
    teamId: z.string().uuid(),
    chargeId: z.string().uuid(),
  })
  .strict();

export type CheckoutParams = z.infer<typeof checkoutParamsSchema>;

export const cursorQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export const flutterwaveWebhookSchema = z
  .object({
    event: z.string().optional(),
    data: z.record(z.unknown()),
    'event.type': z.string().optional(),
  })
  .passthrough();

export type FlutterwaveWebhookBody = z.infer<typeof flutterwaveWebhookSchema>;
