import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AppError } from '@rota/shared';
import { computeShardIndex, shouldReadPrimary, teamQuery } from '../../lib/data/router';
import {
  getRequestContext,
  getTenantScope,
  runInRequestContext,
  runInSystemScope,
} from '../../lib/data/scope';
import { tenantScopeExtension } from '../../lib/data/tenant-extension';

describe('Tenant Scope & Request Context (scope.ts)', () => {
  it('stores and retrieves request context within runInRequestContext', async () => {
    const context = {
      requestId: 'test-req-123',
      scope: { type: 'team' as const, teamId: 'team-abc-1' },
      readPrimary: false,
      readSource: 'replica' as const,
    };

    await runInRequestContext(context, async () => {
      const stored = getRequestContext();
      expect(stored).toEqual(context);
      expect(getTenantScope()).toEqual({ type: 'team', teamId: 'team-abc-1' });
    });

    // Outside the runner, store is empty
    expect(getRequestContext()).toBeUndefined();
    expect(getTenantScope()).toBeUndefined();
  });

  it('runs worker jobs in system scope with runInSystemScope', async () => {
    await runInSystemScope('job-nightly-purge', async () => {
      const stored = getRequestContext();
      expect(stored?.scope).toEqual({
        type: 'system',
        jobId: 'job-nightly-purge',
      });
      expect(stored?.readPrimary).toBe(true);
      expect(stored?.readSource).toBe('primary');
    });
  });
});

describe('Shard Router (router.ts)', () => {
  it('computes deterministic shard index (PRD 7.6)', () => {
    const teamId1 = '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e';
    const shard1 = computeShardIndex(teamId1);
    expect([0, 1]).toContain(shard1);
    // Deterministic check
    expect(computeShardIndex(teamId1)).toBe(shard1);

    const teamId2 = '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5f';
    const shard2 = computeShardIndex(teamId2);
    expect([0, 1]).toContain(shard2);
  });

  it('shouldReadPrimary returns true if explicit header is passed', async () => {
    const result = await shouldReadPrimary({ headerFlag: true });
    expect(result).toBe(true);
  });

  it('teamQuery enforces tenant scope match', async () => {
    const targetTeamId = '018f3a2c-7b4d-7a32-9c1e-5f8a2b3c4d5e';
    const otherTeamId = '018f3a2c-7b4d-7a32-9c1e-000000000000';

    // 1. Without tenant scope -> throws TENANT_SCOPE_MISSING
    await expect(teamQuery(targetTeamId, Prisma.sql`SELECT 1`)).rejects.toThrowError(AppError);

    // 2. With mismatched team scope -> throws TENANT_SCOPE_MISMATCH
    await runInRequestContext(
      {
        requestId: 'req-mismatch',
        scope: { type: 'team', teamId: otherTeamId },
        readPrimary: true,
        readSource: 'primary',
      },
      async () => {
        await expect(teamQuery(targetTeamId, Prisma.sql`SELECT 1`)).rejects.toThrowError(AppError);
      },
    );
  });
});

describe('Tenant Scope Prisma Extension (tenant-extension.ts)', () => {
  // Test the extension by creating a mock Prisma client extended with tenantScopeExtension
  const mockBaseClient = {
    $extends: (ext: unknown) => {
      if (typeof ext === 'function') {
        return ext(mockBaseClient);
      }
      return ext;
    },
    $allOperations: null as unknown,
  };

  const extension = tenantScopeExtension(mockBaseClient as unknown as Prisma.TransactionClient);
  // Extract the $allOperations hook from the extension definition
  const allOperations = (
    extension as unknown as {
      query: {
        $allModels: {
          $allOperations: (params: {
            model: string;
            operation: string;
            args: unknown;
            query: (args: unknown) => Promise<unknown>;
          }) => Promise<unknown>;
        };
      };
    }
  ).query.$allModels.$allOperations;

  it('allows global models without any tenant scope', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ id: 'user-1' });

    const result = await allOperations({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: 'user-1' } },
      query: mockQuery,
    });

    expect(result).toEqual({ id: 'user-1' });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('blocks shard model queries when tenant scope is missing', async () => {
    const mockQuery = vi.fn();

    await expect(
      allOperations({
        model: 'Shift',
        operation: 'findMany',
        args: { where: { teamId: 'team-1' } },
        query: mockQuery,
      }),
    ).rejects.toThrow('Shard queries must run within a tenant scope');

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('blocks shard model queries when where filter lacks teamId', async () => {
    const mockQuery = vi.fn();

    await runInRequestContext(
      {
        requestId: 'req-1',
        scope: { type: 'team', teamId: 'team-1' },
        readPrimary: false,
        readSource: 'replica',
      },
      async () => {
        await expect(
          allOperations({
            model: 'Shift',
            operation: 'findMany',
            args: { where: { status: 'PUBLISHED' } },
            query: mockQuery,
          }),
        ).rejects.toThrow('Shard model Shift query requires teamId in where filter');
      },
    );

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('blocks shard model queries when teamId mismatches team scope', async () => {
    const mockQuery = vi.fn();

    await runInRequestContext(
      {
        requestId: 'req-2',
        scope: { type: 'team', teamId: 'team-1' },
        readPrimary: false,
        readSource: 'replica',
      },
      async () => {
        await expect(
          allOperations({
            model: 'Shift',
            operation: 'findMany',
            args: { where: { teamId: 'team-2' } },
            query: mockQuery,
          }),
        ).rejects.toThrow('Query teamId does not match tenant scope');
      },
    );

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('permits shard model queries matching team scope', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: 'shift-1' }]);

    await runInRequestContext(
      {
        requestId: 'req-3',
        scope: { type: 'team', teamId: 'team-1' },
        readPrimary: false,
        readSource: 'replica',
      },
      async () => {
        const result = await allOperations({
          model: 'Shift',
          operation: 'findMany',
          args: { where: { teamId: 'team-1' } },
          query: mockQuery,
        });

        expect(result).toEqual([{ id: 'shift-1' }]);
        expect(mockQuery).toHaveBeenCalledTimes(1);
      },
    );
  });

  it('permits shard model queries in system scope without filter', async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: 'shift-1' }]);

    await runInSystemScope('job-sweep', async () => {
      const result = await allOperations({
        model: 'Shift',
        operation: 'findMany',
        args: { where: {} },
        query: mockQuery,
      });

      expect(result).toEqual([{ id: 'shift-1' }]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  it('enforces user scope active team list', async () => {
    const mockQuery = vi.fn().mockResolvedValue([]);

    await runInRequestContext(
      {
        requestId: 'req-user-1',
        scope: { type: 'user', userId: 'user-1', teamIds: ['team-a', 'team-b'] },
        readPrimary: false,
        readSource: 'replica',
      },
      async () => {
        // Allowed team
        await allOperations({
          model: 'Shift',
          operation: 'findMany',
          args: { where: { teamId: 'team-a' } },
          query: mockQuery,
        });
        expect(mockQuery).toHaveBeenCalledTimes(1);

        // Disallowed foreign team
        await expect(
          allOperations({
            model: 'Shift',
            operation: 'findMany',
            args: { where: { teamId: 'team-c' } },
            query: mockQuery,
          }),
        ).rejects.toThrow('Query teamId is not in user active teams');
      },
    );
  });
});
