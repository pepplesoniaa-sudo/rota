import {
  clearAuthSecrets,
  getLastUserId,
  getRefreshToken,
  setLastUserId,
  setRefreshToken,
} from '../storage/secure-store';
import { useAppStore } from '../state/app-store';
import { queryClient } from '../query/client';

export interface ApiFetchOptions extends RequestInit {
  skipAuth?: boolean;
}

let inMemoryAccessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function setAccessToken(token: string | null): void {
  inMemoryAccessToken = token;
}

/**
 * Single-flight token refresh mutex (L-33, FR-04).
 * If multiple requests fail with 401, only one refresh call is sent.
 */
export async function refreshAccessToken(
  apiBaseUrl = 'http://localhost:3000',
): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) {
        await handleLogout();
        return null;
      }

      const res = await fetch(`${apiBaseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          // Refresh token invalid or expired: full logout
          await handleLogout();
        }
        return null;
      }

      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      setAccessToken(data.accessToken);
      await setRefreshToken(data.refreshToken);

      return data.accessToken;
    } catch {
      // Network failure during refresh: do not log out (FR-32)
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Clears secure tokens, TanStack Query cache, and resets client state on logout.
 */
export async function handleLogout(): Promise<void> {
  setAccessToken(null);
  await clearAuthSecrets();
  queryClient.clear();
  useAppStore.getState().reset();
}

/**
 * Cold-start initialization (FR-32).
 * - Attempts to refresh access token using stored refresh token.
 * - If network error occurs, opens in offline mode using lastUserId without logging out.
 * - Only 401 logs the user out.
 */
export async function initializeAuth(apiBaseUrl = 'http://localhost:3000'): Promise<{
  status: 'authenticated' | 'offline' | 'unauthenticated';
  userId: string | null;
}> {
  const refreshToken = await getRefreshToken();
  const lastUserId = await getLastUserId();

  if (!refreshToken) {
    return { status: 'unauthenticated', userId: null };
  }

  try {
    const res = await fetch(`${apiBaseUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (res.status === 401) {
      await handleLogout();
      return { status: 'unauthenticated', userId: null };
    }

    if (res.ok) {
      const data = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
        user?: { id: string };
      };
      setAccessToken(data.accessToken);
      await setRefreshToken(data.refreshToken);

      const userId = data.user?.id ?? lastUserId;
      if (userId) {
        await setLastUserId(userId);
        useAppStore.getState().setUserId(userId);
      }
      useAppStore.getState().setOnline(true);
      return { status: 'authenticated', userId };
    }

    // Server error (5xx) or other non-401 response: treat as offline fallback
    if (lastUserId) {
      useAppStore.getState().setUserId(lastUserId);
      useAppStore.getState().setOnline(false);
      return { status: 'offline', userId: lastUserId };
    }
    return { status: 'unauthenticated', userId: null };
  } catch {
    // Network error: cold start opens in offline mode (FR-32)
    if (lastUserId) {
      useAppStore.getState().setUserId(lastUserId);
      useAppStore.getState().setOnline(false);
      return { status: 'offline', userId: lastUserId };
    }
    return { status: 'unauthenticated', userId: null };
  }
}

/**
 * Universal authenticated fetch with automatic 401 retry via single-flight refresh.
 */
export async function apiFetch<T>(
  url: string,
  options: ApiFetchOptions = {},
  apiBaseUrl = 'http://localhost:3000',
): Promise<T> {
  const headers = new Headers(options.headers);

  if (!options.skipAuth && inMemoryAccessToken) {
    headers.set('authorization', `Bearer ${inMemoryAccessToken}`);
  }
  if (!headers.has('content-type') && options.body) {
    headers.set('content-type', 'application/json');
  }

  const targetUrl = url.startsWith('http') ? url : `${apiBaseUrl}${url}`;

  let res = await fetch(targetUrl, {
    ...options,
    headers,
  });

  if (res.status === 401 && !options.skipAuth) {
    const newToken = await refreshAccessToken(apiBaseUrl);
    if (newToken) {
      headers.set('authorization', `Bearer ${newToken}`);
      res = await fetch(targetUrl, {
        ...options,
        headers,
      });
    }
  }

  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as {
      error?: { code: string; message: string };
    };
    const err = new Error(errorData.error?.message ?? `API error ${res.status}`);
    (err as Error & { code?: string; status?: number }).code = errorData.error?.code;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }

  return res.json() as Promise<T>;
}
