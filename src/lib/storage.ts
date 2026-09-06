import * as SecureStore from 'expo-secure-store';

/** Small typed wrapper over SecureStore. Values must stay readable after a reboot (before first unlock) for the background task. */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key, OPTIONS);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value, OPTIONS);
    } catch (err) {
      console.warn('storage.set failed', key, err);
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key, OPTIONS);
    } catch {
      /* ignore */
    }
  },
  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await storage.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async setJSON(key: string, value: unknown): Promise<void> {
    await storage.set(key, JSON.stringify(value));
  },
};

export const KEYS = {
  deviceId: 'bc.deviceId',
  jwt: 'bc.jwt',
  lastLocationSent: 'bc.lastLocationSent',
} as const;
