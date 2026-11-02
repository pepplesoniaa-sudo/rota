import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1),
  SHARD_0_PRIMARY_URL: z.string().min(1).optional(),
  SHARD_0_REPLICA_URL: z.string().min(1).optional(),
  SHARD_1_PRIMARY_URL: z.string().min(1).optional(),
  SHARD_1_REPLICA_URL: z.string().min(1).optional(),
  SHARD_1_DIRECT_URL: z.string().min(1).optional(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_KID: z.string().default('current'),
  JWT_PREVIOUS_SECRET: z
    .string()
    .optional()
    .refine((val) => !val || val.length >= 32, {
      message: 'JWT_PREVIOUS_SECRET must be at least 32 characters long if provided',
    }),
  JWT_PREVIOUS_KID: z.string().default('previous'),

  // Card encryption key (32 bytes = 64 hex characters)
  CARD_ENCRYPTION_KEY: z.string().refine(
    (key) => {
      try {
        const buf = Buffer.from(key, 'hex');
        return buf.length === 32;
      } catch {
        return false;
      }
    },
    { message: 'CARD_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex characters)' },
  ),

  // Flutterwave test keys
  FLW_SECRET_KEY: z
    .string()
    .startsWith('FLWSECK_TEST-', 'FLW_SECRET_KEY must start with FLWSECK_TEST-'),
  FLW_PUBLIC_KEY: z
    .string()
    .startsWith('FLWPUBK_TEST-', 'FLW_PUBLIC_KEY must start with FLWPUBK_TEST-'),
  FLW_SECRET_HASH: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

// Validate process.env once at boot
export const env = envSchema.parse(process.env);
