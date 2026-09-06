import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from '../env';

/** Owner-role HTTP client. One per request; the driver is stateless. */
export type Sql = NeonQueryFunction<false, false>;

export function db(env: Env): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}
