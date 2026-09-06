import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { listVar } from '../env';
import { db, type Sql } from './db';
import { hashApiKey, secretsEqual } from './crypto';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  jwt: string;
  claims: JWTPayload;
}

export interface Member {
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'active' | 'revoked';
}

export interface ApiKeyPrincipal {
  id: string;
  name: string;
  scopes: string[];
}

export type Vars = {
  user: AuthUser;
  member: Member;
  apiKey: ApiKeyPrincipal | null;
  sql: Sql;
};

export type AppEnv = { Bindings: Env; Variables: Vars };

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(url: string) {
  let set = jwksCache.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
    jwksCache.set(url, set);
  }
  return set;
}

/** Verify a Neon Auth (Better Auth JWT plugin) token against the branch JWKS. */
export async function verifyBearer(env: Env, token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, jwksFor(env.NEON_AUTH_JWKS_URL), {
    ...(env.NEON_AUTH_JWT_ISSUER ? { issuer: env.NEON_AUTH_JWT_ISSUER } : {}),
    clockTolerance: 30,
  });
  if (!payload.sub) throw new Error('token has no subject');
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
  const name = typeof payload.name === 'string' ? payload.name : null;
  return { id: payload.sub, email, name, jwt: token, claims: payload };
}

/** Attaches a per-request owner-role SQL client. */
export const withDb: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('sql', db(c.env));
  c.set('apiKey', null);
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401);
  let user: AuthUser;
  try {
    user = await verifyBearer(c.env, header.slice(7).trim());
  } catch (err) {
    return c.json({ error: 'unauthorized', detail: (err as Error).message }, 401);
  }
  if (!user.email) {
    // Neon Auth keeps users in the same database; fall back to it if the JWT omits email.
    const rows = (await c.var.sql`SELECT email, name FROM neon_auth."user" WHERE id = ${user.id} LIMIT 1`) as Array<{ email: string; name: string | null }>;
    if (rows[0]) {
      user.email = rows[0].email.toLowerCase();
      user.name = user.name ?? rows[0].name;
    }
  }
  c.set('user', user);
  await next();
};

interface MemberRow { email: string; user_id: string | null; role: Member['role']; status: Member['status'] }

/**
 * Find or create the membership row for a signed-in user. First sign-in by an
 * address listed in ADMIN_EMAILS becomes an active admin; anyone else lands in
 * "pending" until an admin approves them.
 */
export async function resolveMember(sql: Sql, env: Env, user: AuthUser): Promise<Member> {
  const email = user.email;
  const rows = (await sql`
    SELECT email, user_id, role, status FROM members
    WHERE user_id = ${user.id} OR (${email}::text IS NOT NULL AND email = ${email}::citext)
    ORDER BY (user_id = ${user.id}) DESC LIMIT 1`) as MemberRow[];
  let row = rows[0];
  if (row && row.user_id && row.user_id !== user.id) {
    // The email is already bound to a different auth user; do not silently hijack it.
    return { email: row.email, role: 'member', status: 'pending' };
  }
  if (!row) {
    if (!email) return { email: '', role: 'member', status: 'pending' };
    const admins = listVar(env.ADMIN_EMAILS).map((e) => e.toLowerCase());
    const isAdmin = admins.includes(email);
    const inserted = (await sql`
      INSERT INTO members (email, user_id, role, status, display_name)
      VALUES (${email}, ${user.id}, ${isAdmin ? 'admin' : 'member'}::member_role, ${isAdmin ? 'active' : 'pending'}::member_status, ${user.name})
      ON CONFLICT (email) DO UPDATE SET user_id = COALESCE(members.user_id, EXCLUDED.user_id), updated_at = now()
      RETURNING email, user_id, role, status`) as MemberRow[];
    row = inserted[0]!;
  } else if (!row.user_id) {
    await sql`UPDATE members SET user_id = ${user.id}, display_name = COALESCE(display_name, ${user.name}), updated_at = now() WHERE email = ${row.email}`;
  }
  if (row.status === 'active') {
    await sql`INSERT INTO alert_preferences (user_id) VALUES (${user.id}) ON CONFLICT (user_id) DO NOTHING`;
  }
  return { email: row.email, role: row.role, status: row.status };
}

export const requireMember: MiddlewareHandler<AppEnv> = async (c, next) => {
  const member = await resolveMember(c.var.sql, c.env, c.var.user);
  c.set('member', member);
  if (member.status !== 'active') {
    return c.json({ error: member.status === 'revoked' ? 'revoked' : 'pending_approval', member }, 403);
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.member?.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
};

export async function lookupApiKey(sql: Sql, env: Env, key: string): Promise<ApiKeyPrincipal | null> {
  const hash = await hashApiKey(env.API_KEY_PEPPER ?? '', key);
  const rows = (await sql`
    UPDATE api_keys SET last_used_at = now() WHERE key_hash = ${hash} AND revoked_at IS NULL
    RETURNING id, name, scopes`) as ApiKeyPrincipal[];
  return rows[0] ?? null;
}

/** Ingest is authenticated by the station's shared secret or an API key with the `ingest` scope. */
export const requireIngestAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const pushSecret = c.req.header('x-push-secret');
  if (pushSecret && (await secretsEqual(pushSecret, c.env.PUSH_SECRET))) return next();
  const apiKey = c.req.header('x-api-key');
  if (apiKey) {
    const principal = await lookupApiKey(c.var.sql, c.env, apiKey);
    if (principal?.scopes.includes('ingest')) {
      c.set('apiKey', principal);
      return next();
    }
  }
  return c.json({ error: 'forbidden' }, 403);
};

/** Feed reads accept either a member's JWT or an API key with `read:feed` (for dashboards). */
export const requireReader: MiddlewareHandler<AppEnv> = async (c, next) => {
  const apiKey = c.req.header('x-api-key');
  if (apiKey) {
    const principal = await lookupApiKey(c.var.sql, c.env, apiKey);
    if (principal?.scopes.includes('read:feed')) {
      c.set('apiKey', principal);
      return next();
    }
    return c.json({ error: 'forbidden' }, 403);
  }
  return requireUser(c, async () => requireMember(c, next));
};
