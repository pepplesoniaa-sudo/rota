import { PrismaClient } from '@prisma/client';
import { readReplicas } from '@prisma/extension-read-replicas';
import { env } from './config/env';
import { tenantScopeExtension } from './data/tenant-extension';

interface GlobalPrisma {
  prismaShard0?: ReturnType<typeof createShard0Client>;
  prismaShard1?: ReturnType<typeof createShard1Client>;
}

const globalForPrisma = globalThis as unknown as GlobalPrisma;

function createShard0Client() {
  const primaryUrl = env.SHARD_0_PRIMARY_URL ?? env.DATABASE_URL;
  const replicaUrl = env.SHARD_0_REPLICA_URL ?? primaryUrl;

  const client = new PrismaClient({
    datasources: {
      db: {
        url: primaryUrl,
      },
    },
  });

  return client
    .$extends(
      readReplicas({
        url: replicaUrl,
      }),
    )
    .$extends(tenantScopeExtension);
}

function createShard1Client() {
  const primaryUrl = env.SHARD_1_PRIMARY_URL ?? env.DATABASE_URL;
  const replicaUrl = env.SHARD_1_REPLICA_URL ?? primaryUrl;

  const client = new PrismaClient({
    datasources: {
      db: {
        url: primaryUrl,
      },
    },
  });

  return client
    .$extends(
      readReplicas({
        url: replicaUrl,
      }),
    )
    .$extends(tenantScopeExtension);
}

export const dbShard0 = globalForPrisma.prismaShard0 ?? createShard0Client();
export const dbShard1 = globalForPrisma.prismaShard1 ?? createShard1Client();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prismaShard0 = dbShard0;
  globalForPrisma.prismaShard1 = dbShard1;
}

export function getShardClient(shardIndex: number) {
  return shardIndex === 1 ? dbShard1 : dbShard0;
}
