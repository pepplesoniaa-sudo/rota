import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getRefreshToken,
  setRefreshToken,
  clearRefreshToken,
  getLastUserId,
  setLastUserId,
  clearLastUserId,
  clearAuthSecrets,
} from '../../src/lib/storage/secure-store';

vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(async () => {
        store.clear();
      }),
    },
  };
});

describe('L-5 & FR-32 Secure Storage for Tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores refresh token in expo-secure-store and NEVER in AsyncStorage (L-5)', async () => {
    const testToken = 'rt_sec_test_random_token_32_bytes_sample';
    await setRefreshToken(testToken);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('rota_refresh_token', testToken);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    const retrieved = await getRefreshToken();
    expect(retrieved).toBe(testToken);
  });

  it('clears refresh token on clearRefreshToken', async () => {
    await setRefreshToken('token_to_delete');
    await clearRefreshToken();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('rota_refresh_token');
    const retrieved = await getRefreshToken();
    expect(retrieved).toBeNull();
  });

  it('stores and retrieves lastUserId for offline cold start (FR-32)', async () => {
    const userId = '018f6e80-7711-7000-8000-000000000001';
    await setLastUserId(userId);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('rota_last_user_id', userId);
    const retrieved = await getLastUserId();
    expect(retrieved).toBe(userId);

    await clearLastUserId();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('rota_last_user_id');
    expect(await getLastUserId()).toBeNull();
  });

  it('clearAuthSecrets purges all stored credentials and user tracking', async () => {
    await setRefreshToken('token_abc');
    await setLastUserId('user_xyz');

    await clearAuthSecrets();

    expect(await getRefreshToken()).toBeNull();
    expect(await getLastUserId()).toBeNull();
  });
});
