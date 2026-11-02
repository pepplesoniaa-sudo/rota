import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'rota_refresh_token';
const LAST_USER_ID_KEY = 'rota_last_user_id';

/**
 * L-5: Refresh token stored in expo-secure-store ONLY.
 * Never use AsyncStorage or any unencrypted store for tokens.
 */
export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setRefreshToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function clearRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    // Ignore error if already deleted
  }
}

/**
 * FR-32: Store last user id to permit offline cold start when network is unavailable.
 */
export async function getLastUserId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(LAST_USER_ID_KEY);
  } catch {
    return null;
  }
}

export async function setLastUserId(userId: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_USER_ID_KEY, userId);
}

export async function clearLastUserId(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAST_USER_ID_KEY);
  } catch {
    // Ignore error if already deleted
  }
}

export async function clearAuthSecrets(): Promise<void> {
  await clearRefreshToken();
  await clearLastUserId();
}
