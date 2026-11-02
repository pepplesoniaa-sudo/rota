import { describe, it, expect, beforeEach, vi } from 'vitest';

const secureStoreMock = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => secureStoreMock.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreMock.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStoreMock.delete(key);
  }),
}));

const asyncStorageMock = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageMock.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageMock.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      asyncStorageMock.delete(key);
    }),
    clear: vi.fn(async () => {
      asyncStorageMock.clear();
    }),
  },
}));

import {
  initializeAuth,
  handleLogout,
  refreshAccessToken,
  setAccessToken,
  getAccessToken,
} from '../../src/lib/api/client';
import { useAppStore } from '../../src/lib/state/app-store';
import { queryClient } from '../../src/lib/query/client';

describe('FR-32 Cold-start & Offline Recovery (Exit Criteria 2)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    secureStoreMock.clear();
    asyncStorageMock.clear();
    useAppStore.getState().reset();
    queryClient.clear();
    setAccessToken(null);
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('unauthenticated cold start: when no refresh token exists, returns unauthenticated', async () => {
    const result = await initializeAuth();
    expect(result.status).toBe('unauthenticated');
    expect(result.userId).toBeNull();
    expect(useAppStore.getState().userId).toBeNull();
  });

  it('successful cold start: exchanges refresh token for new access token and marks online', async () => {
    secureStoreMock.set('rota_refresh_token', 'valid_refresh_token');
    secureStoreMock.set('rota_last_user_id', 'user_123');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: 'new_access_token_abc',
        refreshToken: 'rotated_refresh_token_xyz',
        user: { id: 'user_123' },
      }),
    } as unknown as Response);

    const result = await initializeAuth();

    expect(result.status).toBe('authenticated');
    expect(result.userId).toBe('user_123');
    expect(getAccessToken()).toBe('new_access_token_abc');
    expect(secureStoreMock.get('rota_refresh_token')).toBe('rotated_refresh_token_xyz');
    expect(useAppStore.getState().isOnline).toBe(true);
    expect(useAppStore.getState().userId).toBe('user_123');
  });

  it('airplane-mode cold start: network error falls back to lastUserId within 2s without redirecting to login (FR-32, Exit Criteria 2)', async () => {
    secureStoreMock.set('rota_refresh_token', 'saved_offline_refresh_token');
    secureStoreMock.set('rota_last_user_id', 'offline_user_456');

    // Simulate airplane mode / offline network failure (fetch throws TypeError: Failed to fetch)
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const start = performance.now();
    const result = await initializeAuth();
    const duration = performance.now() - start;

    // Must resolve well within 2 seconds
    expect(duration).toBeLessThan(2000);

    // Must open in offline mode using last user id, NOT going to login screen
    expect(result.status).toBe('offline');
    expect(result.userId).toBe('offline_user_456');
    expect(useAppStore.getState().userId).toBe('offline_user_456');
    expect(useAppStore.getState().isOnline).toBe(false);

    // Refresh token must remain intact in SecureStore
    expect(secureStoreMock.get('rota_refresh_token')).toBe('saved_offline_refresh_token');
  });

  it('401 auth error logs out immediately and deletes credentials (FR-32)', async () => {
    secureStoreMock.set('rota_refresh_token', 'expired_token');
    secureStoreMock.set('rota_last_user_id', 'user_789');

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired' },
      }),
    } as unknown as Response);

    const result = await initializeAuth();

    expect(result.status).toBe('unauthenticated');
    expect(result.userId).toBeNull();

    // Verify full logout cleanup (Exit criteria 3)
    expect(secureStoreMock.has('rota_refresh_token')).toBe(false);
    expect(secureStoreMock.has('rota_last_user_id')).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(useAppStore.getState().userId).toBeNull();
  });

  it('handleLogout purges access token, SecureStore secrets, and QueryClient cache (Exit Criteria 3)', async () => {
    setAccessToken('in_memory_token');
    secureStoreMock.set('rota_refresh_token', 'some_token');
    secureStoreMock.set('rota_last_user_id', 'some_user');
    useAppStore.getState().setUserId('some_user');
    queryClient.setQueryData(['testKey'], { data: 'should_be_cleared' });

    expect(queryClient.getQueryData(['testKey'])).toBeDefined();

    await handleLogout();

    expect(getAccessToken()).toBeNull();
    expect(secureStoreMock.get('rota_refresh_token')).toBeUndefined();
    expect(secureStoreMock.get('rota_last_user_id')).toBeUndefined();
    expect(useAppStore.getState().userId).toBeNull();
    expect(queryClient.getQueryData(['testKey'])).toBeUndefined();
  });

  it('single-flight refresh: concurrent 401 requests trigger only one refresh call (L-33, FR-04)', async () => {
    secureStoreMock.set('rota_refresh_token', 'valid_refresh_token');

    let refreshCallCount = 0;
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/v1/auth/refresh')) {
        refreshCallCount++;
        // Artificial small delay to simulate in-flight network call
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'refreshed_access_token_123',
            refreshToken: 'refreshed_refresh_token_456',
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    });

    // Launch multiple concurrent refreshes
    const [t1, t2, t3] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    expect(t1).toBe('refreshed_access_token_123');
    expect(t2).toBe('refreshed_access_token_123');
    expect(t3).toBe('refreshed_access_token_123');
    expect(refreshCallCount).toBe(1);
  });
});
