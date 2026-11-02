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

/**
 * Password reset request body (FR-06, PRD 7.2, DB-4, CS-10).
 */
export const PasswordResetRequestBody = z
  .object({
    email: z
      .string()
      .trim()
      .email('Invalid email address')
      .toLowerCase()
      .max(255, 'Email cannot exceed 255 characters'),
  })
  .strict();

export type PasswordResetRequestBody = z.infer<typeof PasswordResetRequestBody>;

/**
 * Password reset confirm body (FR-06, PRD 7.2, CS-10).
 */
export const PasswordResetConfirmBody = z
  .object({
    token: z.string().min(1, 'Token is required').max(255),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters')
      .max(128, 'Password cannot exceed 128 characters'),
  })
  .strict();

export type PasswordResetConfirmBody = z.infer<typeof PasswordResetConfirmBody>;

/**
 * Me response (FR-08, PRD 7.2, CS-10).
 */
export const MeResponse = z
  .object({
    user: z
      .object({
        id: z.string().uuid(),
        email: z.string().email(),
        displayName: z.string(),
        createdAt: z.string(),
      })
      .strict(),
  })
  .strict();

export type MeResponse = z.infer<typeof MeResponse>;

/**
 * User Settings response (PRD 7.2, CS-10).
 */
export const SettingsResponse = z
  .object({
    settings: z
      .object({
        userId: z.string().uuid(),
        timezone: z.string(),
        quietHoursEnabled: z.boolean(),
        quietStartMinute: z.number().int().min(0).max(1439),
        quietEndMinute: z.number().int().min(0).max(1439),
        notifyShiftChanges: z.boolean(),
        notifySwaps: z.boolean(),
        notifyMemberJoined: z.boolean(),
        notifyShiftReminders: z.boolean(),
        quietAfterNightShift: z.boolean(),
        use24HourClock: z.boolean(),
        weekStartsOn: z.number().int().min(1).max(7),
        version: z.number().int().positive(),
        updatedAt: z.string(),
      })
      .strict(),
  })
  .strict();

export type SettingsResponse = z.infer<typeof SettingsResponse>;

/**
 * Update User Settings request body (PRD 7.2, CS-10).
 */
export const UpdateSettingsBody = z
  .object({
    timezone: z
      .string()
      .refine(isValidIanaTimezone, {
        message: 'Invalid IANA timezone',
      })
      .optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietStartMinute: z.number().int().min(0).max(1439).optional(),
    quietEndMinute: z.number().int().min(0).max(1439).optional(),
    notifyShiftChanges: z.boolean().optional(),
    notifySwaps: z.boolean().optional(),
    notifyMemberJoined: z.boolean().optional(),
    notifyShiftReminders: z.boolean().optional(),
    quietAfterNightShift: z.boolean().optional(),
    use24HourClock: z.boolean().optional(),
    weekStartsOn: z.number().int().min(1).max(7).optional(),
    version: z.number().int().positive(),
  })
  .strict();

export type UpdateSettingsBody = z.infer<typeof UpdateSettingsBody>;

/**
 * Register push token request body (PRD 7.2, CS-10).
 */
export const RegisterPushTokenBody = z
  .object({
    expoPushToken: z.string().trim().min(1).max(255),
    platform: z.enum(['IOS', 'ANDROID']),
    deviceId: z.string().trim().min(1).max(100),
  })
  .strict();

export type RegisterPushTokenBody = z.infer<typeof RegisterPushTokenBody>;

export const PushTokenResponse = z
  .object({
    pushToken: z
      .object({
        id: z.string().uuid(),
        expoPushToken: z.string(),
        platform: z.enum(['IOS', 'ANDROID']),
        deviceId: z.string(),
        createdAt: z.string(),
      })
      .strict(),
  })
  .strict();

export type PushTokenResponse = z.infer<typeof PushTokenResponse>;

/**
 * Push token path parameters (PRD 7.2, CS-10).
 */
export const PushTokenParams = z
  .object({
    pushTokenId: z.string().uuid(),
  })
  .strict();

export type PushTokenParams = z.infer<typeof PushTokenParams>;
