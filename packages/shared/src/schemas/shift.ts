import { z } from 'zod';

const localDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const localDateRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Create shift request body (FR-15, PRD 7.2, CS-10).
 */
export const CreateShiftBody = z
  .object({
    assigneeUserId: z.string().uuid(),
    startsLocal: z.string().regex(localDateTimeRegex, {
      message:
        'startsLocal must be an ISO local date-time without offset (e.g. 2026-11-03T07:00:00)',
    }),
    endsLocal: z.string().regex(localDateTimeRegex, {
      message: 'endsLocal must be an ISO local date-time without offset (e.g. 2026-11-03T15:30:00)',
    }),
    startsUseLaterOffset: z.boolean().optional(),
    endsUseLaterOffset: z.boolean().optional(),
    position: z.string().trim().min(1).max(60),
    location: z.string().trim().min(1).max(100).optional(),
    notes: z.string().trim().min(1).max(500).optional(),
    acknowledgeAvailability: z.boolean().optional(),
  })
  .strict();

export type CreateShiftBody = z.infer<typeof CreateShiftBody>;

/**
 * Update shift request body (FR-16, PRD 7.2, CS-10).
 */
export const UpdateShiftBody = z
  .object({
    assigneeUserId: z.string().uuid().optional(),
    startsLocal: z.string().regex(localDateTimeRegex).optional(),
    endsLocal: z.string().regex(localDateTimeRegex).optional(),
    startsUseLaterOffset: z.boolean().optional(),
    endsUseLaterOffset: z.boolean().optional(),
    position: z.string().trim().min(1).max(60).optional(),
    location: z.string().trim().min(1).max(100).nullable().optional(),
    notes: z.string().trim().min(1).max(500).nullable().optional(),
    acknowledgeAvailability: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .strict();

export type UpdateShiftBody = z.infer<typeof UpdateShiftBody>;

/**
 * Shift route parameters (PRD 7.2, CS-10).
 */
export const ShiftParams = z
  .object({
    teamId: z.string().uuid(),
    shiftId: z.string().uuid(),
  })
  .strict();

export type ShiftParams = z.infer<typeof ShiftParams>;

/**
 * Delete shift query parameter (FR-16, PRD 7.2, CS-10).
 */
export const DeleteShiftQuery = z
  .object({
    version: z.coerce.number().int().positive(),
  })
  .strict();

export type DeleteShiftQuery = z.infer<typeof DeleteShiftQuery>;

/**
 * Shift date range query parameters (FR-18, PRD 7.2, CS-10).
 */
export const ShiftRangeQuery = z
  .object({
    from: z.string().regex(localDateRegex, { message: 'from must be YYYY-MM-DD' }),
    to: z.string().regex(localDateRegex, { message: 'to must be YYYY-MM-DD' }),
  })
  .strict();

export type ShiftRangeQuery = z.infer<typeof ShiftRangeQuery>;

/**
 * Shift object representation.
 */
export const ShiftItem = z
  .object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    assigneeUserId: z.string().uuid(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    startsLocal: z.string(),
    endsLocal: z.string(),
    position: z.string(),
    location: z.string().nullable(),
    notes: z.string().nullable(),
    status: z.enum(['DRAFT', 'PUBLISHED']),
    publishedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
    createdByUserId: z.string().uuid(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    needsCover: z.boolean().optional(),
  })
  .strict();

export type ShiftItem = z.infer<typeof ShiftItem>;

export const ShiftResponse = z
  .object({
    shift: ShiftItem,
  })
  .strict();

export type ShiftResponse = z.infer<typeof ShiftResponse>;

export const ShiftListResponse = z
  .object({
    shifts: z.array(ShiftItem),
  })
  .strict();

export type ShiftListResponse = z.infer<typeof ShiftListResponse>;

/**
 * Publish shifts request body (FR-15c, PRD 7.2, CS-10).
 */
export const PublishShiftsBody = z
  .object({
    from: z.string().regex(localDateRegex).optional(),
    to: z.string().regex(localDateRegex).optional(),
    shiftIds: z.array(z.string().uuid()).optional(),
  })
  .strict()
  .refine(
    (data) => Boolean((data.from && data.to) || (data.shiftIds && data.shiftIds.length > 0)),
    {
      message: 'Either (from and to) or non-empty shiftIds must be provided',
    },
  );

export type PublishShiftsBody = z.infer<typeof PublishShiftsBody>;

export const PublishShiftsResponse = z
  .object({
    ok: z.boolean(),
    publishedCount: z.number().int().min(0),
  })
  .strict();

export type PublishShiftsResponse = z.infer<typeof PublishShiftsResponse>;

/**
 * Copy week request body (FR-15b, PRD 7.2, CS-10).
 */
export const CopyWeekBody = z
  .object({
    fromWeekStart: z
      .string()
      .regex(localDateRegex, { message: 'fromWeekStart must be YYYY-MM-DD' }),
  })
  .strict();

export type CopyWeekBody = z.infer<typeof CopyWeekBody>;

export const CopyWeekResponse = z
  .object({
    copiedCount: z.number().int().min(0),
    skippedCount: z.number().int().min(0),
    skippedShifts: z.array(
      z
        .object({
          shiftId: z.string().uuid(),
          reason: z.enum(['OVERLAP', 'TIME_NONEXISTENT', 'ASSIGNEE_INACTIVE']),
        })
        .strict(),
    ),
  })
  .strict();

export type CopyWeekResponse = z.infer<typeof CopyWeekResponse>;

/**
 * My shifts query parameters (FR-17, PRD 7.2, CS-10).
 */
export const MyShiftsQuery = z
  .object({
    from: z.string().regex(localDateRegex).optional(),
    to: z.string().regex(localDateRegex).optional(),
  })
  .strict();

export type MyShiftsQuery = z.infer<typeof MyShiftsQuery>;

export const MyShiftItem = z
  .object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    teamName: z.string(),
    teamTimezone: z.string(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    startsLocal: z.string(),
    endsLocal: z.string(),
    position: z.string(),
    location: z.string().nullable(),
    notes: z.string().nullable(),
    version: z.number().int().positive(),
    hasOverlapAcrossTeams: z.boolean().optional(),
    overlappingTeamNames: z.array(z.string()).optional(),
  })
  .strict();

export type MyShiftItem = z.infer<typeof MyShiftItem>;

export const MyShiftsResponse = z
  .object({
    shifts: z.array(MyShiftItem),
  })
  .strict();

export type MyShiftsResponse = z.infer<typeof MyShiftsResponse>;
