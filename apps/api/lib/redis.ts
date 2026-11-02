import Redis from 'ioredis';
import { env } from './config/env';
import { logger } from './log';

interface GlobalRedis {
  redisClient?: Redis;
}

const globalForRedis = globalThis as unknown as GlobalRedis;

function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  });

  client.on('error', (err) => {
    logger.warn({ err }, 'Redis connection warning');
  });

  return client;
}

export const redis = globalForRedis.redisClient ?? createRedisClient();

if (env.NODE_ENV !== 'production') {
  globalForRedis.redisClient = redis;
}
