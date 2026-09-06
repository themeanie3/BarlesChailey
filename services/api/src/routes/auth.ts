import { Hono } from 'hono';
import { API_TOKEN_TTL_SECONDS, authenticateNeon, issueApiToken, resolveMemberCached, type AppEnv } from '../lib/auth';

export const authRoutes = new Hono<AppEnv>();

/**
 * Exchange a Neon Auth JWT (from the app's Better Auth session) for a 30-day
 * API token. This is the only authenticated call that touches Neon Auth, so
 * the phone's polling and location pings never wake the database.
 * Membership is resolved here too; pending members still get a token so the
 * app can show the "awaiting approval" screen and poll /v1/me.
 */
authRoutes.post('/auth/exchange', async (c) => {
  const denied = await authenticateNeon(c);
  if (denied) return denied;
  const member = await resolveMemberCached(c, true);
  const user = c.var.user;
  const { token, expiresAt } = await issueApiToken(c.env, { id: user.id, email: user.email ?? (member.email || null), name: user.name });
  return c.json({ token, expiresAt, ttlSeconds: API_TOKEN_TTL_SECONDS, member: { role: member.role, status: member.status } });
});
