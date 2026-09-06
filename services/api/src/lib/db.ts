import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from '../env';

/** Owner-role HTTP client. One per request; the driver is stateless. */
export type Sql = NeonQueryFunction<false, false>;

export function db(env: Env): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

/**
 * RLS-enforced client for a specific user. Uses Neon's JWT self-verification on
 * the "authenticated" role when DATABASE_AUTHENTICATED_URL is configured;
 * otherwise falls back to the owner client (callers still filter by user id).
 */
export function userDb(env: Env, jwt: string): Sql {
  if (env.DATABASE_AUTHENTICATED_URL) {
    return neon(env.DATABASE_AUTHENTICATED_URL, { authToken: jwt });
  }
  return db(env);
}
