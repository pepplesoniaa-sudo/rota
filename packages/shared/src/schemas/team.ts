import { z } from 'zod';
import { isValidIanaTimezone } from './auth';

/**
 * Team creation request body (FR-07, PRD 7.2, CS-10).
 * - name: 2 to 80 characters
 * - timezone: valid IANA timezone
 * - weekStartsOn: 1 (Monday) or 7 (Sunday), default 1
 * - strict(): rejects unknown fields
 */
export const CreateTeamBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Team name must be at least 2 characters')
      .max(80, 'Team name cannot exceed 80 characters'),
    timezone: z.string().refine(isValidIanaTimezone, {
      message: 'Invalid IANA timezone',
    }),
    weekStartsOn: z
      .union([z.literal(1), z.literal(7)])
      .default(1)
      .optional(),
  })
  .strict();

export type CreateTeamBody = z.infer<typeof CreateTeamBody>;

export const TeamResponse = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    timezone: z.string(),
    shardIndex: z.number().int().min(0).max(1),
    weekStartsOn: z.number().int().min(1).max(7),
    role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
    createdAt: z.string().datetime(),
  })
  .strict();

export type TeamResponse = z.infer<typeof TeamResponse>;
