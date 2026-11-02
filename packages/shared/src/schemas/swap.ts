import { z } from 'zod';
import { ShiftItem } from './shift';

export const SwapTypeEnum = z.enum(['TRADE', 'GIVEAWAY']);
export type SwapTypeEnum = z.infer<typeof SwapTypeEnum>;

export const SwapStatusEnum = z.enum([
  'PENDING_PEER',
  'PENDING_MANAGER',
  'APPROVED',
  'REJECTED',
  'DECLINED',
  'CANCELED',
  'EXPIRED',
]);
export type SwapStatusEnum = z.infer<typeof SwapStatusEnum>;

/**
 * Create swap request body (FR-21, PRD 7.2, CS-10).
 */
export const CreateSwapBody = z
  .object({
    requesterShiftId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    targetShiftId: z.string().uuid().optional(),
    message: z.string().trim().max(280).optional(),
  })
  .strict();

export type CreateSwapBody = z.infer<typeof CreateSwapBody>;

/**
 * Coworker peer action body (accept/decline) or requester cancel body (FR-22, FR-25, PRD 7.2).
 */
export const SwapActionBody = z
  .object({
    note: z.string().trim().max(280).optional(),
  })
  .strict();

export type SwapActionBody = z.infer<typeof SwapActionBody>;

/**
 * Manager decision body (approve/reject) (FR-23, PRD 7.2).
 */
export const SwapDecisionBody = z
  .object({
    note: z.string().trim().max(280).optional(),
  })
  .strict();

export type SwapDecisionBody = z.infer<typeof SwapDecisionBody>;

/**
 * Route parameter for swaps (PRD 7.2).
 */
export const SwapParams = z
  .object({
    teamId: z.string().uuid(),
    swapId: z.string().uuid(),
  })
  .strict();

export type SwapParams = z.infer<typeof SwapParams>;

/**
 * List swaps query parameters (PRD 7.2).
 */
export const SwapListQuery = z
  .object({
    status: SwapStatusEnum.optional(),
  })
  .strict();

export type SwapListQuery = z.infer<typeof SwapListQuery>;

/**
 * Full swap representation in API responses.
 */
export const SwapItem = z
  .object({
    id: z.string().uuid(),
    teamId: z.string().uuid(),
    type: SwapTypeEnum,
    status: SwapStatusEnum,
    requesterUserId: z.string().uuid(),
    requesterShiftId: z.string().uuid(),
    requesterShiftVersion: z.number().int().positive(),
    targetUserId: z.string().uuid(),
    targetShiftId: z.string().uuid().nullable(),
    targetShiftVersion: z.number().int().positive().nullable(),
    message: z.string().nullable(),
    peerRespondedAt: z.string().datetime().nullable(),
    decidedByUserId: z.string().uuid().nullable(),
    decidedAt: z.string().datetime().nullable(),
    decisionNote: z.string().nullable(),
    expiresAt: z.string().datetime(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    requesterShift: ShiftItem.optional(),
    targetShift: ShiftItem.nullable().optional(),
  })
  .strict();

export type SwapItem = z.infer<typeof SwapItem>;

export const SwapResponse = z
  .object({
    swap: SwapItem,
  })
  .strict();

export type SwapResponse = z.infer<typeof SwapResponse>;

export const SwapListResponse = z
  .object({
    swaps: z.array(SwapItem),
  })
  .strict();

export type SwapListResponse = z.infer<typeof SwapListResponse>;
