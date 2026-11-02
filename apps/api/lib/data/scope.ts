import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantScopeType = 'team' | 'user' | 'system';

export interface TeamTenantScope {
  type: 'team';
  teamId: string;
}

export interface UserTenantScope {
  type: 'user';
  userId: string;
  teamIds: string[];
}

export interface SystemTenantScope {
  type: 'system';
  jobId: string;
}

export type TenantScope = TeamTenantScope | UserTenantScope | SystemTenantScope;

export interface RequestContext {
  requestId: string;
  scope?: TenantScope;
  readPrimary: boolean;
  readSource: 'primary' | 'replica';
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function getTenantScope(): TenantScope | undefined {
  return requestContextStorage.getStore()?.scope;
}

export function runInRequestContext<T>(
  context: RequestContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return requestContextStorage.run(context, fn);
}

/**
 * Worker-only execution helper for system-scoped jobs.
 * Per B-20, system scope is never reachable from route handlers.
 */
export function runInSystemScope<T>(jobId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return requestContextStorage.run(
    {
      requestId: `job-${jobId}`,
      scope: { type: 'system', jobId },
      readPrimary: true,
      readSource: 'primary',
    },
    fn,
  );
}
