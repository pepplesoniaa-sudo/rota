import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'rota_refresh_token';
const LAST_USER_ID_KEY = 'rota_last_user_id';

const isWeb = typeof window !== 'undefined' && typeof window.document !== 'undefined';
const webMemoryStorage = new Map<string, string>();

async function secureGet(key: string): Promise<string | null> {
  if (isWeb) {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(key);
    }
    return webMemoryStorage.get(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(key, value);
      return;
    }
    webMemoryStorage.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(key);
      return;
    }
    webMemoryStorage.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/**
 * L-5: Refresh token stored in expo-secure-store ONLY on mobile devices.
 * Never use AsyncStorage or any unencrypted store for tokens.
 */
export async function getRefreshToken(): Promise<string | null> {
  try {
    return await secureGet(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setRefreshToken(token: string): Promise<void> {
  await secureSet(REFRESH_TOKEN_KEY, token);
}

export async function clearRefreshToken(): Promise<void> {
  try {
    await secureDelete(REFRESH_TOKEN_KEY);
  } catch {
    // Ignore error if already deleted
  }
}

/**
 * FR-32: Store last user id to permit offline cold start when network is unavailable.
 */
export async function getLastUserId(): Promise<string | null> {
  try {
    return await secureGet(LAST_USER_ID_KEY);
  } catch {
    return null;
  }
}

export async function setLastUserId(userId: string): Promise<void> {
  await secureSet(LAST_USER_ID_KEY, userId);
}

export async function clearLastUserId(): Promise<void> {
  try {
    await secureDelete(LAST_USER_ID_KEY);
  } catch {
    // Ignore error if already deleted
  }
}

export async function clearAuthSecrets(): Promise<void> {
  await clearRefreshToken();
  await clearLastUserId();
}
