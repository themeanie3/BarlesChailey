import { expoClient } from '@better-auth/expo/client';
import { emailOTPClient, jwtClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { config } from './config';
import { KEYS, storage } from './storage';

/**
 * Better Auth client pointed at Neon Managed Better Auth. The Expo plugin keeps
 * the session cookie in the Keychain and re-attaches it to every auth request.
 *
 * Token flow: Neon session → short-lived Neon JWT (`/token`) → exchanged once at
 * our API for a 30-day API token. Only that exchange touches Neon; all routine
 * calls (polling, location pings) use the API token, so the database can sleep.
 */
export const authClient = createAuthClient({
  baseURL: config.neonAuthUrl,
  plugins: [
    expoClient({ scheme: 'barleschailey', storagePrefix: 'bc', storage: SecureStore }),
    emailOTPClient(),
    jwtClient(),
  ],
});

interface CachedToken { token: string; exp: number }

/** Re-exchange when the API token is within a day of expiring. */
const RENEW_BEFORE_MS = 24 * 3600 * 1000;

function decodeExp(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

let inflight: Promise<string | null> | null = null;

async function exchange(): Promise<string | null> {
  const res = await authClient.token();
  const neonJwt = res.data?.token ?? null;
  if (!neonJwt) return null;
  const r = await fetch(`${config.apiUrl}/v1/auth/exchange`, {
    method: 'POST',
    headers: { authorization: `Bearer ${neonJwt}`, accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`exchange failed: HTTP ${r.status}`);
  const body = (await r.json()) as { token: string; expiresAt: string };
  await storage.setJSON(KEYS.jwt, { token: body.token, exp: decodeExp(body.token) || Date.parse(body.expiresAt) } satisfies CachedToken);
  return body.token;
}

/** Returns the API token, exchanging a fresh Neon JWT for a new one when missing, forced, or close to expiry. */
export async function getApiToken(force = false): Promise<string | null> {
  if (!force) {
    const cached = await storage.getJSON<CachedToken>(KEYS.jwt);
    if (cached && cached.exp - Date.now() > RENEW_BEFORE_MS) return cached.token;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      return await exchange();
    } catch (err) {
      console.warn('getApiToken failed', err);
      // Keep using a still-valid cached token if the exchange is temporarily unavailable.
      const cached = await storage.getJSON<CachedToken>(KEYS.jwt);
      return cached && cached.exp > Date.now() ? cached.token : null;
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
