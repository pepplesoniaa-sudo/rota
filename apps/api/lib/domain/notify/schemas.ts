import { z } from 'zod';

/**
 * DB-3: One Zod schema per JSON column.
 * Strict schema for Notification.data.
 */
export const notificationDataSchema = z
  .object({
    url: z.string().optional(),
    invalidate: z.array(z.string()).optional(),
    teamId: z.string().uuid().optional(),
    shiftId: z.string().uuid().optional(),
    swapId: z.string().uuid().optional(),
    membershipId: z.string().uuid().optional(),
  })
  .strict();

export type NotificationData = z.infer<typeof notificationDataSchema>;

/**
 * Strict schema for Notification.quietWindowAtSend.
 */
export const quietWindowAtSendSchema = z
  .object({
    timezone: z.string(),
    quietStartMinute: z.number().int(),
    quietEndMinute: z.number().int(),
  })
  .strict();

export type QuietWindowAtSend = z.infer<typeof quietWindowAtSendSchema>;
