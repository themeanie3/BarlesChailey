import { Hono } from 'hono';
import { AlertPreferences, DEFAULT_ALERT_PREFERENCES } from '@barleschailey/feed';
import { board } from '../env';
import { requireMember, requireUser, resolveMemberCached, type AppEnv } from '../lib/auth';
import type { PrefsRecord } from '../engine/types';
import { recordToAlert, recordToDevice, recordToPreferences, rowToPrefsRecord, type PrefsRow } from '../lib/serialize';

export const meRoutes = new Hono<AppEnv>();
meRoutes.use('*', requireUser);

/** Works for pending members too, so the app can show the "awaiting approval" screen. */
meRoutes.get('/me', async (c) => {
  const user = c.var.user;
  const member = await resolveMemberCached(c, c.req.query('refresh') === '1');
  const b = board(c.env);
  let prefs: PrefsRecord | null = await b.getPrefs(user.id);
  if (!prefs && member.status === 'active') {
    // First request on this deployment: mirror the Postgres row into the Durable Object.
    const rows = (await c.var.sql`SELECT * FROM alert_preferences WHERE user_id = ${user.id}`) as PrefsRow[];
    if (rows[0]) {
      prefs = rowToPrefsRecord(rows[0]);
      await b.setPrefs(prefs);
    }
  }
  const devices = await b.listDevices(user.id);
  return c.json({
    user: { id: user.id, email: user.email ?? member.email, name: user.name },
    member: { role: member.role, status: member.status },
    preferences: prefs ? recordToPreferences(prefs) : DEFAULT_ALERT_PREFERENCES,
    devices: devices.map(recordToDevice),
    server: {
      env: c.env.APP_ENV,
      criticalSoundEnabled: c.env.ALERTS_CRITICAL_SOUND === 'true',
      interruptionLevel: c.env.ALERT_INTERRUPTION_LEVEL,
    },
  });
});

/** Postgres is the source of truth for preferences; the Durable Object keeps a mirror for matching. */
meRoutes.put('/me/preferences', requireMember, async (c) => {
  const parsed = AlertPreferences.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid preferences', issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const userId = c.var.user.id;
  await c.var.sql`INSERT INTO alert_preferences (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
  const updated = (await c.var.sql`
    UPDATE alert_preferences SET
      enabled = COALESCE(${p.enabled ?? null}, enabled),
      radius_miles = COALESCE(${p.radiusMiles ?? null}, radius_miles),
      categories = COALESCE(${p.categories ?? null}::incident_category[], categories),
      min_severity = COALESCE(${p.minSeverity ?? null}::severity, min_severity),
      location_max_age_hours = COALESCE(${p.locationMaxAgeHours ?? null}, location_max_age_hours),
      home_lat = CASE WHEN ${p.home !== undefined} THEN ${p.home?.lat ?? null} ELSE home_lat END,
      home_lon = CASE WHEN ${p.home !== undefined} THEN ${p.home?.lon ?? null} ELSE home_lon END,
      home_radius_miles = CASE WHEN ${p.home !== undefined} THEN ${p.home?.radiusMiles ?? null} ELSE home_radius_miles END,
      home_label = CASE WHEN ${p.home !== undefined} THEN ${p.home?.label ?? null} ELSE home_label END,
      quiet_start = CASE WHEN ${p.quietHours !== undefined} THEN ${p.quietHours?.start ?? null}::time ELSE quiet_start END,
      quiet_end = CASE WHEN ${p.quietHours !== undefined} THEN ${p.quietHours?.end ?? null}::time ELSE quiet_end END,
      quiet_allow_critical = CASE WHEN ${p.quietHours !== undefined} THEN ${p.quietHours?.allowCritical ?? true} ELSE quiet_allow_critical END,
      snooze_until = CASE WHEN ${p.snoozeUntil !== undefined} THEN ${p.snoozeUntil ?? null}::timestamptz ELSE snooze_until END,
      alert_on_upgrade = COALESCE(${p.alertOnUpgrade ?? null}, alert_on_upgrade),
      updated_at = now()
    WHERE user_id = ${userId}
    RETURNING *`) as PrefsRow[];
  const record = rowToPrefsRecord(updated[0]!);
  await board(c.env).setPrefs(record);
  return c.json({ preferences: recordToPreferences(record) });
});

meRoutes.get('/me/alerts', requireMember, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
  const alerts = await board(c.env).listAlerts(c.var.user.id, limit);
  return c.json({ alerts: alerts.map((a) => ({ ...recordToAlert(a), incident: a.incident })) });
});
