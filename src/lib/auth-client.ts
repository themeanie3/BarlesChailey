import { expoClient } from '@better-auth/expo/client';
import { emailOTPClient, jwtClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { config } from './config';
import { KEYS, storage } from './storage';

/**
 * Better Auth client pointed at Neon Managed Better Auth. The Expo plugin keeps
 * the session cookie in the Keychain and re-attaches it to every auth request.
 * Neon's JWT plugin turns that session into a short-lived JWT for our API.
 */
export const authClient = createAuthClient({
  baseURL: config.neonAuthUrl,
  plugins: [
    expoClient({ scheme: 'barleschailey', storagePrefix: 'bc', storage: SecureStore }),
    emailOTPClient(),
    jwtClient(),
  ],
});

interface CachedJwt { token: string; exp: number }

function decodeExp(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

let inflight: Promise<string | null> | null = null;

/** Returns a JWT for the API, refreshing it from Neon Auth when it is within a minute of expiring. */
export async function getApiToken(force = false): Promise<string | null> {
  if (!force) {
    const cached = await storage.getJSON<CachedJwt>(KEYS.jwt);
    if (cached && cached.exp - Date.now() > 60_000) return cached.token;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await authClient.token();
      const token = res.data?.token ?? null;
      if (token) await storage.setJSON(KEYS.jwt, { token, exp: decodeExp(token) } satisfies CachedJwt);
      return token;
    } catch (err) {
      console.warn('getApiToken failed', err);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function signOutEverywhere(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    await storage.remove(KEYS.jwt);
  }
}
