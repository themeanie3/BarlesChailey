import { Hono } from 'hono';
import { z } from 'zod';
import { IncidentCategory, Severity } from '@barleschailey/feed';
import { requireAdmin, requireMember, requireUser, type AppEnv } from '../lib/auth';
import { hashApiKey, randomToken } from '../lib/crypto';
import { toIncident, type IncidentRow } from '../lib/serialize';
import { dispatchAlerts } from '../engine/alerts';
import { classify, invalidateRuleCache, loadRules } from '../engine/classify';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', requireUser, requireMember, requireAdmin);

adminRoutes.get('/members', async (c) => {
  const rows = (await c.var.sql`
    SELECT m.email, m.user_id AS "userId", m.role, m.status, m.display_name AS "displayName", m.created_at AS "createdAt",
           (SELECT count(*)::int FROM devices d WHERE d.user_id = m.user_id) AS devices
    FROM members m ORDER BY m.status, m.created_at`) as unknown[];
  return c.json({ members: rows });
});

const MemberPatch = z.object({ role: z.enum(['admin', 'member']).optional(), status: z.enum(['pending', 'active', 'revoked']).optional(), displayName: z.string().max(120).optional() });

/** Invite (creates an active member) or update a member by email. */
adminRoutes.put('/members/:email', async (c) => {
  const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'bad email' }, 400);
  const parsed = MemberPatch.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid member', issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const rows = (await c.var.sql`
    INSERT INTO members (email, role, status, display_name, invited_by)
    VALUES (${email}, ${p.role ?? 'member'}::member_role, ${p.status ?? 'active'}::member_status, ${p.displayName ?? null}, ${c.var.user.email})
    ON CONFLICT (email) DO UPDATE SET
      role = COALESCE(${p.role ?? null}::member_role, members.role),
      status = COALESCE(${p.status ?? null}::member_status, members.status),
      display_name = COALESCE(${p.displayName ?? null}, members.display_name),
      updated_at = now()
    RETURNING email, user_id AS "userId", role, status, display_name AS "displayName"`) as unknown[];
  return c.json({ member: rows[0] });
});

adminRoutes.delete('/members/:email', async (c) => {
  const email = decodeURIComponent(c.req.param('email')).trim().toLowerCase();
  if (email === c.var.user.email) return c.json({ error: 'cannot revoke yourself' }, 400);
  await c.var.sql`UPDATE members SET status = 'revoked', updated_at = now() WHERE email = ${email}`;
  return c.json({ ok: true });
});

const RulePatch = z.object({
  description: z.string().min(1).max(120).optional(),
  category: IncidentCategory.optional(),
  severity: Severity.optional(),
  alertable: z.boolean().optional(),
  isUpgrade: z.boolean().optional(),
});

adminRoutes.put('/call-types/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  if (!/^[A-Z0-9]{2,16}$/.test(code)) return c.json({ error: 'bad code' }, 400);
  const parsed = RulePatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid rule', issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const rows = (await c.var.sql`
    INSERT INTO call_type_rules (code, description, category, severity, alertable, is_upgrade)
    VALUES (${code}, ${p.description ?? code}, ${p.category ?? 'other'}::incident_category, ${p.severity ?? 'normal'}::severity, ${p.alertable ?? false}, ${p.isUpgrade ?? false})
    ON CONFLICT (code) DO UPDATE SET
      description = COALESCE(${p.description ?? null}, call_type_rules.description),
      category = COALESCE(${p.category ?? null}::incident_category, call_type_rules.category),
      severity = COALESCE(${p.severity ?? null}::severity, call_type_rules.severity),
      alertable = COALESCE(${p.alertable ?? null}, call_type_rules.alertable),
      is_upgrade = COALESCE(${p.isUpgrade ?? null}, call_type_rules.is_upgrade),
      updated_at = now()
    RETURNING code, description, category, severity, alertable, is_upgrade AS "isUpgrade"`) as unknown[];
  invalidateRuleCache();
  return c.json({ rule: rows[0] });
});

const Simulate = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  address: z.string().max(120).default('SIMULATED INCIDENT'),
  code: z.string().max(16).default('HOUSE'),
  description: z.string().max(120).optional(),
  box: z.string().regex(/^\d{4}$/).default('0301'),
  units: z.array(z.string()).default(['E703', 'T703', 'RS703', 'A703']),
});

/**
 * End-to-end drill: inserts a synthetic incident at the given point and runs
 * the real alert matcher against it. Simulated incidents are hidden from the
 * board unless ?includeSimulated=1 and are auto-cleared by the cron.
 */
adminRoutes.post('/simulate', async (c) => {
  const parsed = Simulate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid simulation', issues: parsed.error.issues }, 400);
  const s = parsed.data;
  const rules = await loadRules(c.var.sql);
  const cls = classify(s.code, rules);
  const rows = (await c.var.sql`
    INSERT INTO incidents (source, source_key, status, dispatched_at, address, city, lat, lon, formatted_address, geocode_status,
                           call_code, call_description, category, severity, alertable, box, station, battalion, units)
    VALUES ('simulation', ${`sim-${Date.now()}-${randomToken(4)}`}, 'active', now(), ${s.address.toUpperCase()}, 'ROCKVILLE', ${s.lat}, ${s.lon}, ${s.address}, 'ok',
            ${s.code.toUpperCase()}, ${s.description ?? rules.get(s.code.toUpperCase())?.description ?? s.code}, ${cls.category}::incident_category, ${cls.severity}::severity, true,
            ${s.box}, ${s.box.slice(0, 2)}, NULL, ${s.units}::text[])
    RETURNING *`) as IncidentRow[];
  const inc = rows[0]!;
  await c.var.sql`INSERT INTO incident_events (incident_id, kind, data) VALUES (${inc.id}, 'created', ${JSON.stringify({ simulatedBy: c.var.user.email })}::jsonb)`;
  const result = await dispatchAlerts(c.env, c.var.sql, inc, 'dispatch');
  return c.json({ incident: toIncident(inc), alerts: result });
});

adminRoutes.get('/stats', async (c) => {
  const [row] = (await c.var.sql`
    SELECT
      (SELECT count(*)::int FROM incidents WHERE status = 'active') AS active_incidents,
      (SELECT count(*)::int FROM incidents WHERE first_seen_at > now() - interval '24 hours') AS incidents_24h,
      (SELECT count(*)::int FROM alerts WHERE sent_at > now() - interval '24 hours') AS alerts_24h,
      (SELECT count(*)::int FROM alerts WHERE sent_at > now() - interval '24 hours' AND receipt_status = 'error') AS alert_errors_24h,
      (SELECT count(*)::int FROM devices WHERE push_enabled) AS devices,
      (SELECT count(*)::int FROM members WHERE status = 'active') AS active_members,
      (SELECT count(*)::int FROM members WHERE status = 'pending') AS pending_members,
      (SELECT count(*)::int FROM geocode_cache) AS geocode_cache_size,
      (SELECT last_push_at FROM feed_sources WHERE source = ${c.env.FEED_SOURCE}) AS last_push_at`) as Array<Record<string, unknown>>;
  return c.json(row);
});

const ApiKeyCreate = z.object({ name: z.string().min(1).max(60), scopes: z.array(z.enum(['read:feed', 'ingest'])).min(1) });

adminRoutes.get('/api-keys', async (c) => {
  const rows = (await c.var.sql`SELECT id, name, scopes, created_at AS "createdAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt" FROM api_keys ORDER BY created_at DESC`) as unknown[];
  return c.json({ apiKeys: rows });
});

/** The plaintext key is returned exactly once. */
adminRoutes.post('/api-keys', async (c) => {
  const parsed = ApiKeyCreate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid key request', issues: parsed.error.issues }, 400);
  const key = `bck_${randomToken(24)}`;
  const hash = await hashApiKey(c.env.API_KEY_PEPPER ?? '', key);
  const rows = (await c.var.sql`INSERT INTO api_keys (name, key_hash, scopes) VALUES (${parsed.data.name}, ${hash}, ${parsed.data.scopes}::text[]) RETURNING id, name, scopes`) as Array<{ id: string; name: string; scopes: string[] }>;
  return c.json({ apiKey: { ...rows[0]!, key } }, 201);
});

adminRoutes.delete('/api-keys/:id', async (c) => {
  await c.var.sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${c.req.param('id')} AND revoked_at IS NULL`;
  return c.json({ ok: true });
});
