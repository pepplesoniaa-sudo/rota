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

/**
 * Parameters for routes scoped to a team (PRD 7.2).
 */
export const TeamParams = z
  .object({
    teamId: z.string().uuid(),
  })
  .strict();

export type TeamParams = z.infer<typeof TeamParams>;

/**
 * Parameters for member-specific team routes (PRD 7.2).
 */
export const MemberParams = z
  .object({
    teamId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict();

export type MemberParams = z.infer<typeof MemberParams>;

/**
 * Parameters for invite-specific team routes (PRD 7.2).
 */
export const InviteParams = z
  .object({
    teamId: z.string().uuid(),
    inviteId: z.string().uuid(),
  })
  .strict();

export type InviteParams = z.infer<typeof InviteParams>;

/**
 * Parameters for public invite token routes (PRD 7.2).
 */
export const InviteTokenParams = z
  .object({
    token: z.string().min(1),
  })
  .strict();

export type InviteTokenParams = z.infer<typeof InviteTokenParams>;

/**
 * Invite creation request body (FR-09, PRD 7.2, CS-10).
 * Managers can invite STAFF only; Owners can invite STAFF or MANAGER.
 */
export const CreateInviteBody = z
  .object({
    role: z.enum(['STAFF', 'MANAGER']),
    email: z.string().email().optional(),
  })
  .strict();

export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

export const SeatImpact = z
  .object({
    addsPaidSeat: z.boolean(),
    monthlyIncreaseCents: z.number().int(),
    prorationCentsIfAcceptedNow: z.number().int(),
  })
  .strict();

export type SeatImpact = z.infer<typeof SeatImpact>;

export const InviteResponse = z
  .object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    role: z.enum(['STAFF', 'MANAGER']),
    email: z.string().email().nullable(),
    expiresAt: z.string().datetime(),
    inviteUrl: z.string(),
    seatImpact: SeatImpact,
  })
  .strict();

export type InviteResponse = z.infer<typeof InviteResponse>;

export const InviteSummaryResponse = z
  .object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    role: z.enum(['STAFF', 'MANAGER']),
    email: z.string().email().nullable(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type InviteSummaryResponse = z.infer<typeof InviteSummaryResponse>;

export const InviteListResponse = z
  .object({
    invites: z.array(InviteSummaryResponse),
  })
  .strict();

export type InviteListResponse = z.infer<typeof InviteListResponse>;

/**
 * Public invite details inspection response (FR-10, PRD 7.2).
 */
export const InviteDetailsResponse = z
  .object({
    teamId: z.string().uuid(),
    teamName: z.string(),
    role: z.enum(['STAFF', 'MANAGER']),
    email: z.string().email().nullable(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type InviteDetailsResponse = z.infer<typeof InviteDetailsResponse>;

/**
 * Accept invite request body (FR-10, PRD 7.2).
 */
export const AcceptInviteBody = z.object({}).strict().optional();

export type AcceptInviteBody = z.infer<typeof AcceptInviteBody>;

export const AcceptInviteResponse = z
  .object({
    ok: z.boolean(),
    teamId: z.string().uuid(),
    role: z.enum(['STAFF', 'MANAGER']),
  })
  .strict();

export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponse>;

/**
 * Member role update request body (FR-11, PRD 7.2, CS-10).
 */
export const UpdateMemberRoleBody = z
  .object({
    role: z.enum(['STAFF', 'MANAGER']),
  })
  .strict();

export type UpdateMemberRoleBody = z.infer<typeof UpdateMemberRoleBody>;

export const MemberResponse = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
    joinedAt: z.string().datetime(),
  })
  .strict();

export type MemberResponse = z.infer<typeof MemberResponse>;

export const MemberListResponse = z
  .object({
    members: z.array(MemberResponse),
  })
  .strict();

export type MemberListResponse = z.infer<typeof MemberListResponse>;

/**
 * Team update request body (PRD 7.2, CS-10).
 * Owner can update name and/or timezone.
 */
export const UpdateTeamBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Team name must be at least 2 characters')
      .max(80, 'Team name cannot exceed 80 characters')
      .optional(),
    timezone: z
      .string()
      .refine(isValidIanaTimezone, {
        message: 'Invalid IANA timezone',
      })
      .optional(),
  })
  .strict()
  .refine((data) => data.name !== undefined || data.timezone !== undefined, {
    message: 'At least one of name or timezone must be provided',
  });

export type UpdateTeamBody = z.infer<typeof UpdateTeamBody>;

/**
 * Team deletion request body (FR-14, PRD 7.2).
 * Owner must confirm by typing the exact team name.
 */
export const DeleteTeamBody = z
  .object({
    teamName: z.string().trim().min(1, 'Team name confirmation is required'),
  })
  .strict();

export type DeleteTeamBody = z.infer<typeof DeleteTeamBody>;

export const DeleteTeamResponse = z
  .object({
    ok: z.literal(true),
    teamId: z.string().uuid(),
  })
  .strict();

export type DeleteTeamResponse = z.infer<typeof DeleteTeamResponse>;

/**
 * Full team details response (PRD 7.2).
 */
export const TeamDetailsResponse = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    timezone: z.string(),
    shardIndex: z.number().int().min(0).max(1),
    weekStartsOn: z.number().int().min(1).max(7),
    ownerUserId: z.string().uuid(),
    role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
    memberCount: z.number().int().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();

export type TeamDetailsResponse = z.infer<typeof TeamDetailsResponse>;

/**
 * Transfer ownership request body (FR-13, PRD 7.2, CS-10).
 */
export const TransferOwnershipBody = z
  .object({
    targetUserId: z.string().uuid(),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBody>;

export const TransferOwnershipResponse = z
  .object({
    ok: z.boolean(),
    teamId: z.string().uuid(),
    newOwnerUserId: z.string().uuid(),
  })
  .strict();

export type TransferOwnershipResponse = z.infer<typeof TransferOwnershipResponse>;

/**
 * Team switcher item and response (FR-08, PRD 7.2, CS-10).
 */
export const MyTeamsItem = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    timezone: z.string(),
    role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
    weekStartsOn: z.number().int().min(1).max(7),
    joinedAt: z.string().datetime(),
  })
  .strict();

export type MyTeamsItem = z.infer<typeof MyTeamsItem>;

export const MyTeamsResponse = z
  .object({
    teams: z.array(MyTeamsItem),
  })
  .strict();

export type MyTeamsResponse = z.infer<typeof MyTeamsResponse>;
