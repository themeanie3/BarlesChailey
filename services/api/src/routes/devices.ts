import { Hono } from 'hono';
import { DeviceRegistration, LocationUpdate } from '@barleschailey/feed';
import { requireMember, requireUser, type AppEnv } from '../lib/auth';
import { buildTestMessage, sendExpoPush } from '../lib/push';
import { toDevice, type DeviceRow } from '../lib/serialize';

export const deviceRoutes = new Hono<AppEnv>();
deviceRoutes.use('*', requireUser, requireMember);

const UUID = /^[0-9a-f-]{36}$/i;

/** Register (or refresh) this device. Keyed by Expo push token; a token that moves to another account follows the account. */
deviceRoutes.post('/devices', async (c) => {
  const parsed = DeviceRegistration.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid device', issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const rows = (await c.var.sql`
    INSERT INTO devices (user_id, expo_push_token, platform, app_version, device_name, critical_alerts_authorized, push_enabled, disabled_reason, last_seen_at)
    VALUES (${c.var.user.id}, ${d.expoPushToken}, ${d.platform}::device_platform, ${d.appVersion}, ${d.deviceName ?? null}, ${d.criticalAlertsAuthorized ?? false}, true, NULL, now())
    ON CONFLICT (expo_push_token) DO UPDATE SET
      user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, app_version = EXCLUDED.app_version,
      device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
      critical_alerts_authorized = EXCLUDED.critical_alerts_authorized,
      push_enabled = true, disabled_reason = NULL, last_seen_at = now()
    RETURNING *`) as DeviceRow[];
  return c.json({ device: toDevice(rows[0]!) });
});

async function ownedDevice(c: { var: AppEnv['Variables'] }, id: string): Promise<DeviceRow | null> {
  if (!UUID.test(id)) return null;
  const rows = (await c.var.sql`SELECT * FROM devices WHERE id = ${id} AND user_id = ${c.var.user.id}`) as DeviceRow[];
  return rows[0] ?? null;
}

deviceRoutes.put('/devices/:id/location', async (c) => {
  const device = await ownedDevice(c, c.req.param('id'));
  if (!device) return c.json({ error: 'not found' }, 404);
  const parsed = LocationUpdate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid location', issues: parsed.error.issues }, 400);
  const l = parsed.data;
  const recordedAt = new Date(l.recordedAt);
  if (recordedAt.getTime() > Date.now() + 5 * 60_000) return c.json({ error: 'recordedAt is in the future' }, 400);
  await c.var.sql.transaction([
    c.var.sql`
      INSERT INTO device_locations (device_id, lat, lon, accuracy_m, speed_mps, recorded_at, updated_at)
      VALUES (${device.id}, ${l.lat}, ${l.lon}, ${l.accuracyM ?? null}, ${l.speedMps ?? null}, ${recordedAt.toISOString()}, now())
      ON CONFLICT (device_id) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, accuracy_m = EXCLUDED.accuracy_m,
        speed_mps = EXCLUDED.speed_mps, recorded_at = GREATEST(device_locations.recorded_at, EXCLUDED.recorded_at), updated_at = now()`,
    c.var.sql`UPDATE devices SET last_seen_at = now() WHERE id = ${device.id}`,
  ]);
  return c.json({ ok: true, recordedAt: recordedAt.toISOString() });
});

deviceRoutes.delete('/devices/:id', async (c) => {
  const device = await ownedDevice(c, c.req.param('id'));
  if (!device) return c.json({ error: 'not found' }, 404);
  await c.var.sql`DELETE FROM devices WHERE id = ${device.id}`;
  return c.json({ ok: true });
});

deviceRoutes.post('/devices/:id/test-alert', async (c) => {
  const device = await ownedDevice(c, c.req.param('id'));
  if (!device) return c.json({ error: 'not found' }, 404);
  const rows = (await c.var.sql`SELECT expo_push_token FROM devices WHERE id = ${device.id}`) as Array<{ expo_push_token: string }>;
  const message = buildTestMessage(c.env, rows[0]!.expo_push_token, device.critical_alerts_authorized);
  const [ticket] = await sendExpoPush(c.env, [message]);
  await c.var.sql`
    INSERT INTO alerts (kind, device_id, user_id, expo_ticket_id, receipt_status, receipt_error, payload)
    VALUES ('test', ${device.id}, ${c.var.user.id}, ${ticket?.id ?? null}, ${ticket?.status === 'ok' ? 'pending' : 'error'}::receipt_status,
            ${ticket?.status === 'ok' ? null : `${ticket?.details?.error ?? 'ticket'}: ${ticket?.message ?? 'unknown'}`},
            ${JSON.stringify({ title: message.title, body: message.body })}::jsonb)`;
  if (ticket?.status !== 'ok') return c.json({ ok: false, error: ticket?.message ?? 'push rejected', details: ticket?.details ?? null }, 502);
  return c.json({ ok: true, ticketId: ticket.id, critical: typeof message.sound === 'object' });
});
