import { Prisma } from '@prisma/client';
import { AppError, ERROR_CODES } from '@rota/shared';
import { logger } from '../log';
import { getRequestContext, getTenantScope } from './scope';

export const SHARD_MODELS = new Set([
  'shift',
  'swapRequest',
  'availabilityBlock',
  'activityEvent',
  'teamDailyStats',
  'memberWeeklyStats',
]);

function normalizeModelName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

function validateTeamScopeArgs(
  scopeTeamId: string,
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  requestId: string,
) {
  if (operation === 'create') {
    const data = args?.['data'] as Record<string, unknown> | undefined;
    if (!data || data['teamId'] === undefined) {
      logger.error({ requestId, model, operation }, 'Shard create missing teamId');
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISSING,
        500,
        `Shard model ${model} create requires teamId`,
      );
    }
    if (data['teamId'] !== scopeTeamId) {
      logger.error(
        { requestId, model, operation, targetTeamId: data['teamId'], scopeTeamId },
        'Shard create teamId mismatch',
      );
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        500,
        'Query teamId does not match tenant scope',
      );
    }
    return;
  }

  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const data = args?.['data'];
    const items = Array.isArray(data) ? data : data ? [data] : [];
    if (items.length === 0) {
      return;
    }
    for (const item of items) {
      const record = item as Record<string, unknown>;
      if (record['teamId'] === undefined) {
        logger.error({ requestId, model, operation }, 'Shard createMany missing teamId');
        throw new AppError(
          ERROR_CODES.TENANT_SCOPE_MISSING,
          500,
          `Shard model ${model} createMany requires teamId on each item`,
        );
      }
      if (record['teamId'] !== scopeTeamId) {
        logger.error(
          { requestId, model, operation, targetTeamId: record['teamId'], scopeTeamId },
          'Shard createMany teamId mismatch',
        );
        throw new AppError(
          ERROR_CODES.TENANT_SCOPE_MISMATCH,
          500,
          'Query teamId does not match tenant scope',
        );
      }
    }
    return;
  }

  if (operation === 'upsert') {
    const where = args?.['where'] as Record<string, unknown> | undefined;
    const create = args?.['create'] as Record<string, unknown> | undefined;
    if (!where || where['teamId'] === undefined || !create || create['teamId'] === undefined) {
      logger.error({ requestId, model, operation }, 'Shard upsert missing teamId');
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISSING,
        500,
        `Shard model ${model} upsert requires teamId in where and create`,
      );
    }
    if (where['teamId'] !== scopeTeamId || create['teamId'] !== scopeTeamId) {
      logger.error({ requestId, model, operation }, 'Shard upsert teamId mismatch');
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        500,
        'Query teamId does not match tenant scope',
      );
    }
    return;
  }

  // All other operations: findMany, findFirst, findUnique, count, aggregate, groupBy, update, updateMany, delete, deleteMany
  const where = args?.['where'] as Record<string, unknown> | undefined;
  if (!where || where['teamId'] === undefined) {
    logger.error({ requestId, model, operation }, 'Shard query where clause missing teamId');
    throw new AppError(
      ERROR_CODES.TENANT_SCOPE_MISSING,
      500,
      `Shard model ${model} query requires teamId in where filter`,
    );
  }

  const teamIdFilter = where['teamId'];
  if (typeof teamIdFilter === 'string') {
    if (teamIdFilter !== scopeTeamId) {
      logger.error(
        { requestId, model, operation, queryTeamId: teamIdFilter, scopeTeamId },
        'Shard query teamId mismatch',
      );
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        500,
        'Query teamId does not match tenant scope',
      );
    }
  } else if (typeof teamIdFilter === 'object' && teamIdFilter !== null) {
    const obj = teamIdFilter as Record<string, unknown>;
    if (obj['equals'] !== undefined && obj['equals'] !== scopeTeamId) {
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        500,
        'Query teamId does not match tenant scope',
      );
    }
    if (Array.isArray(obj['in'])) {
      const inList = obj['in'] as string[];
      if (inList.length === 0 || inList.some((id) => id !== scopeTeamId)) {
        throw new AppError(
          ERROR_CODES.TENANT_SCOPE_MISMATCH,
          500,
          'Query teamId in filter does not match tenant scope',
        );
      }
    }
  }
}

function validateUserScopeArgs(
  scopeTeamIds: string[],
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  requestId: string,
) {
  const where = args?.['where'] as Record<string, unknown> | undefined;
  if (!where || where['teamId'] === undefined) {
    logger.error(
      { requestId, model, operation },
      'User-scoped shard query missing teamId in where',
    );
    throw new AppError(
      ERROR_CODES.TENANT_SCOPE_MISSING,
      500,
      `Shard model ${model} query in user scope requires teamId in where filter`,
    );
  }

  const teamIdFilter = where['teamId'];
  if (typeof teamIdFilter === 'string') {
    if (!scopeTeamIds.includes(teamIdFilter)) {
      logger.error(
        { requestId, model, operation, queryTeamId: teamIdFilter, scopeTeamIds },
        'User-scoped shard query teamId mismatch',
      );
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        500,
        'Query teamId is not in user active teams',
      );
    }
  } else if (typeof teamIdFilter === 'object' && teamIdFilter !== null) {
    const obj = teamIdFilter as Record<string, unknown>;
    if (obj['equals'] !== undefined && !scopeTeamIds.includes(obj['equals'] as string)) {
      throw new AppError(
        ERROR_CODES.TENANT_SCOPE_MISMATCH,
        500,
        'Query teamId is not in user active teams',
      );
    }
    if (Array.isArray(obj['in'])) {
      const inList = obj['in'] as string[];
      if (inList.length === 0 || !inList.every((id) => scopeTeamIds.includes(id))) {
        throw new AppError(
          ERROR_CODES.TENANT_SCOPE_MISMATCH,
          500,
          'Query teamId in filter includes teams outside user active teams',
        );
      }
    }
  }
}

export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenantScope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const normalized = normalizeModelName(model);
        if (!SHARD_MODELS.has(normalized)) {
          // Global models and outbox are not shard-isolated
          return query(args);
        }

        const reqContext = getRequestContext();
        const scope = getTenantScope();
        const requestId = reqContext?.requestId ?? 'unknown';

        if (!scope) {
          logger.error(
            { requestId, model, operation },
            'Shard query blocked: tenant scope missing',
          );
          throw new AppError(
            ERROR_CODES.TENANT_SCOPE_MISSING,
            500,
            'Shard queries must run within a tenant scope',
          );
        }

        if (scope.type === 'system') {
          logger.info(
            { jobId: scope.jobId, model, operation },
            'Executing shard query in system scope',
          );
          return query(args);
        }

        if (scope.type === 'team') {
          validateTeamScopeArgs(
            scope.teamId,
            model,
            operation,
            args as Record<string, unknown> | undefined,
            requestId,
          );
        } else if (scope.type === 'user') {
          validateUserScopeArgs(
            scope.teamIds,
            model,
            operation,
            args as Record<string, unknown> | undefined,
            requestId,
          );
        }

        return query(args);
      },
    },
  },
});
