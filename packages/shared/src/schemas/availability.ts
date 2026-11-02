import { z } from 'zod';

/**
 * Individual availability block input.
 */
export const AvailabilityBlockInput = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(2880),
  })
  .strict();

export type AvailabilityBlockInput = z.infer<typeof AvailabilityBlockInput>;

/**
 * Replace availability request body (FR-19, PRD 7.2, CS-10).
 */
export const ReplaceAvailabilityBody = z
  .object({
    blocks: z.array(AvailabilityBlockInput).max(28),
  })
  .strict();

export type ReplaceAvailabilityBody = z.infer<typeof ReplaceAvailabilityBody>;

/**
 * Availability query parameters (PRD 7.2, CS-10).
 */
export const AvailabilityQuery = z
  .object({
    userId: z.string().uuid().optional(),
  })
  .strict();

export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>;

/**
 * Availability block item in responses.
 */
export const AvailabilityBlockItem = z
  .object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    userId: z.string().uuid(),
    dayOfWeek: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AvailabilityBlockItem = z.infer<typeof AvailabilityBlockItem>;

export const AvailabilityResponse = z
  .object({
    blocks: z.array(AvailabilityBlockItem),
  })
  .strict();

export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>;
