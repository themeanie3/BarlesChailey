import { Hono } from 'hono';
import { AlertPreferences, DEFAULT_ALERT_PREFERENCES } from '@barleschailey/feed';
import { requireMember, requireUser, resolveMember, type AppEnv } from '../lib/auth';
import { toAlert, toDevice, toPreferences, type AlertRow, type DeviceRow, type PrefsRow } from '../lib/serialize';

export const meRoutes = new Hono<AppEnv>();
meRoutes.use('*', requireUser);

/** Works for pending members too, so the app can show the "awaiting approval" screen. */
meRoutes.get('/me', async (c) => {
  const user = c.var.user;
  const member = await resolveMember(c.var.sql, c.env, user);
  const prefsRows = (await c.var.sql`SELECT * FROM alert_preferences WHERE user_id = ${user.id}`) as PrefsRow[];
  const devices = (await c.var.sql`
    SELECT d.*, dl.recorded_at AS last_location_at FROM devices d LEFT JOIN device_locations dl ON dl.device_id = d.id
    WHERE d.user_id = ${user.id} ORDER BY d.last_seen_at DESC`) as DeviceRow[];
  return c.json({
    user: { id: user.id, email: user.email ?? member.email, name: user.name },
    member: { role: member.role, status: member.status },
    preferences: prefsRows[0] ? toPreferences(prefsRows[0]) : DEFAULT_ALERT_PREFERENCES,
    devices: devices.map(toDevice),
    server: {
      env: c.env.APP_ENV,
      criticalSoundEnabled: c.env.ALERTS_CRITICAL_SOUND === 'true',
      interruptionLevel: c.env.ALERT_INTERRUPTION_LEVEL,
    },
  });
});

meRoutes.put('/me/preferences', requireMember, async (c) => {
  const parsed = AlertPreferences.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid preferences', issues: parsed.error.issues }, 400);
  const p = parsed.data;
  const userId = c.var.user.id;
  const rows = (await c.var.sql`
    INSERT INTO alert_preferences (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`) as unknown[];
  void rows;
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
  return c.json({ preferences: toPreferences(updated[0]!) });
});

meRoutes.get('/me/alerts', requireMember, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
  const rows = (await c.var.sql`
    SELECT a.*, i.call_code, i.call_description, i.address, i.city, i.category, i.severity, i.status AS incident_status, i.dispatched_at
    FROM alerts a LEFT JOIN incidents i ON i.id = a.incident_id
    WHERE a.user_id = ${c.var.user.id} ORDER BY a.sent_at DESC LIMIT ${limit}`) as Array<AlertRow & {
    call_code: string | null; call_description: string | null; address: string | null; city: string | null;
    category: string | null; severity: string | null; incident_status: string | null; dispatched_at: string | null;
  }>;
  return c.json({
    alerts: rows.map((r) => ({
      ...toAlert(r),
      incident: r.incident_id
        ? { id: r.incident_id, callCode: r.call_code, callDescription: r.call_description, address: r.address, city: r.city, category: r.category, severity: r.severity, status: r.incident_status, dispatchedAt: r.dispatched_at ? new Date(r.dispatched_at).toISOString() : null }
        : null,
    })),
  });
});
