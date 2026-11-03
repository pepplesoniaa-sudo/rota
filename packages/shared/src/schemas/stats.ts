import { z } from 'zod';

export const StatsQuery = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(28).optional(),
  })
  .strict();

export type StatsQuery = z.infer<typeof StatsQuery>;

export const DailyStatItem = z
  .object({
    date: z.string(), // ISO YYYY-MM-DD
    scheduledMinutes: z.number().int(),
    scheduledHours: z.number(), // scheduledMinutes / 60 rounded to 1 decimal
    shiftCount: z.number().int(),
    swapsRequested: z.number().int(),
    swapsApproved: z.number().int(),
    swapsRejected: z.number().int(),
    medianApprovalMinutes: z.number().int().nullable(),
  })
  .strict();

export type DailyStatItem = z.infer<typeof DailyStatItem>;

export const MemberWeeklyStatItem = z
  .object({
    userId: z.string().uuid(),
    weekStart: z.string(), // ISO YYYY-MM-DD
    scheduledMinutes: z.number().int(),
    scheduledHours: z.number(),
    overFortyHours: z.boolean(), // true when scheduledMinutes > 2400 (40 hours)
  })
  .strict();

export type MemberWeeklyStatItem = z.infer<typeof MemberWeeklyStatItem>;

export const StatsResponse = z
  .object({
    dailyStats: z.array(DailyStatItem),
    memberWeeklyStats: z.array(MemberWeeklyStatItem),
  })
  .strict();

export type StatsResponse = z.infer<typeof StatsResponse>;

