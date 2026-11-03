import { z } from 'zod';

/**
 * DB-3: One Zod schema per JSON column.
 * Outbox.payload schemas for every supported job kind.
 */

export const feedAppendPayloadSchema = z
  .object({
    teamId: z.string().uuid(),
    membershipId: z.string().uuid(),
    userId: z.string().uuid(),
    joinedAt: z.string().datetime(),
  })
  .strict();

export type FeedAppendPayload = z.infer<typeof feedAppendPayloadSchema>;

export const notifyFanoutPayloadSchema = z
  .object({
    sourceKey: z.string().min(1),
    teamId: z.string().uuid(),
    type: z.string().min(1),
  })
  .strict();

export type NotifyFanoutPayload = z.infer<typeof notifyFanoutPayloadSchema>;

export const emailSendPayloadSchema = z
  .object({
    template: z.string().min(1),
    to: z.string().email(),
    vars: z.record(z.unknown()),
    emailMessageId: z.string().uuid(),
  })
  .strict();

export type EmailSendPayload = z.infer<typeof emailSendPayloadSchema>;

export const maintenancePurgeTeamPayloadSchema = z
  .object({
    teamId: z.string().uuid(),
  })
  .strict();

export type MaintenancePurgeTeamPayload = z.infer<typeof maintenancePurgeTeamPayloadSchema>;

export const outboxPayloadSchema = z.union([
  feedAppendPayloadSchema,
  notifyFanoutPayloadSchema,
  emailSendPayloadSchema,
  maintenancePurgeTeamPayloadSchema,
]);

export type OutboxPayload = z.infer<typeof outboxPayloadSchema>;

/**
 * Validates payload against strict Zod schema per DB-3.
 */
export function validateOutboxPayload(kind: string, payload: unknown) {
  switch (kind) {
    case 'feed.append':
      return feedAppendPayloadSchema.parse(payload);
    case 'notify.fanout':
      return notifyFanoutPayloadSchema.parse(payload);
    case 'email.send':
      return emailSendPayloadSchema.parse(payload);
    case 'maintenance.purge-team':
      return maintenancePurgeTeamPayloadSchema.parse(payload);
    default:
      return outboxPayloadSchema.parse(payload);
  }
}
