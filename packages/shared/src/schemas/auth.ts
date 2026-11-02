import { z } from 'zod';

export function isValidIanaTimezone(zone: string): boolean {
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone').includes(zone);
  }
  return zone.length > 0;
}

/**
 * Register request body (FR-01, PRD 7.2, DB-4, UP-9, CS-10).
 * - email: lowercase, trimmed, max 255
 * - password: 10 to 128 chars
 * - timezone: validated IANA timezone
 * - displayName: optional, 1 to 80 chars
 * - strict(): rejects unknown fields
 */
export const RegisterBody = z
  .object({
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .toLowerCase()
      .max(255, 'Email cannot exceed 255 characters'),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters')
      .max(128, 'Password cannot exceed 128 characters'),
    displayName: z
      .string()
      .trim()
      .min(1, 'Display name cannot be empty')
      .max(80, 'Display name cannot exceed 80 characters')
      .optional(),
    timezone: z.string().refine(isValidIanaTimezone, {
      message: 'Invalid IANA timezone',
    }),
  })
  .strict();

export type RegisterBody = z.infer<typeof RegisterBody>;

export const RegisterResponse = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: z
      .object({
        id: z.string().uuid(),
        email: z.string().email(),
        displayName: z.string(),
      })
      .strict(),
  })
  .strict();

export type RegisterResponse = z.infer<typeof RegisterResponse>;

/**
 * Login request body (FR-02, PRD 7.2, DB-4, UP-9, CS-10).
 */
export const LoginBody = z
  .object({
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .toLowerCase()
      .max(255, 'Email cannot exceed 255 characters'),
    password: z
      .string()
      .min(1, 'Password is required')
      .max(128, 'Password cannot exceed 128 characters'),
    deviceName: z
      .string()
      .trim()
      .min(1)
      .max(100, 'Device name cannot exceed 100 characters')
      .optional(),
  })
  .strict();

export type LoginBody = z.infer<typeof LoginBody>;

export const LoginResponse = RegisterResponse;
export type LoginResponse = RegisterResponse;

/**
 * Refresh request body (FR-03, PRD 7.2, CS-10).
 */
export const RefreshBody = z
  .object({
    refreshToken: z.string().min(1, 'Refresh token is required').max(255),
    deviceName: z
      .string()
      .trim()
      .min(1)
      .max(100, 'Device name cannot exceed 100 characters')
      .optional(),
  })
  .strict();

export type RefreshBody = z.infer<typeof RefreshBody>;

export const RefreshResponse = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
  })
  .strict();

export type RefreshResponse = z.infer<typeof RefreshResponse>;

/**
 * Single-device logout request body (FR-03, PRD 7.2, CS-10).
 */
export const LogoutBody = z
  .object({
    refreshToken: z.string().min(1, 'Refresh token is required').max(255),
  })
  .strict();

export type LogoutBody = z.infer<typeof LogoutBody>;

/**
 * Empty body schema for endpoints expecting no payload (PRD 7.2, CS-10).
 */
export const EmptyBody = z.object({}).strict();
export type EmptyBody = z.infer<typeof EmptyBody>;
