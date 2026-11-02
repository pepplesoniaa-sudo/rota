import { z } from 'zod';

export const FeedEventTypeEnum = z.enum([
  'SHIFT_CREATED',
  'SHIFT_CHANGED',
  'SHIFT_SWAPPED',
  'MEMBER_JOINED',
  'SCHEDULE_PUBLISHED',
]);
export type FeedEventTypeEnum = z.infer<typeof FeedEventTypeEnum>;

/**
 * Feed pagination query parameters (FR-26, PRD 7.2, PRD 7.10).
 * Cursor is base64url(JSON.stringify({ t: createdAtIsoMillis, id })).
 */
export const FeedQuery = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type FeedQuery = z.infer<typeof FeedQuery>;

export const FeedEventItem = z
  .object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    type: FeedEventTypeEnum,
    actorUserId: z.string().uuid().nullable(),
    subjectShiftId: z.string().uuid().nullable().optional(),
    subjectUserId: z.string().uuid().nullable().optional(),
    payload: z.record(z.unknown()),
    createdAt: z.string().datetime(),
  })
  .strict();

export type FeedEventItem = z.infer<typeof FeedEventItem>;

export const FeedResponse = z
  .object({
    events: z.array(FeedEventItem),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type FeedResponse = z.infer<typeof FeedResponse>;
