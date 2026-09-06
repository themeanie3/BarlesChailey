import { Hono } from 'hono';
import { DeviceRegistration, LocationUpdate } from '@barleschailey/feed';
import { board } from '../env';
import { requireMember, requireUser, type AppEnv } from '../lib/auth';
import { recordToDevice } from '../lib/serialize';
import type { TestAlertResult } from '../board/board-state';

export const deviceRoutes = new Hono<AppEnv>();
deviceRoutes.use('*', requireUser, requireMember);

const UUID = /^[0-9a-f-]{36}$/i;

/** Register (or refresh) this device. Keyed by Expo push token; a token that moves to another account follows the account. */
deviceRoutes.post('/devices', async (c) => {
  const parsed = DeviceRegistration.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid device', issues: parsed.error.issues }, 400);
  const d = parsed.data;
  const device = await board(c.env).upsertDevice({
    userId: c.var.user.id, expoPushToken: d.expoPushToken, platform: d.platform, appVersion: d.appVersion,
    deviceName: d.deviceName ?? null, criticalAlertsAuthorized: d.criticalAlertsAuthorized ?? false,
  });
  return c.json({ device: recordToDevice(device) });
});

deviceRoutes.put('/devices/:id/location', async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) return c.json({ error: 'not found' }, 404);
  const parsed = LocationUpdate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid location', issues: parsed.error.issues }, 400);
  const l = parsed.data;
  const recordedAt = new Date(l.recordedAt);
  if (recordedAt.getTime() > Date.now() + 5 * 60_000) return c.json({ error: 'recordedAt is in the future' }, 400);
  const ok = await board(c.env).updateLocation(id, c.var.user.id, {
    lat: l.lat, lon: l.lon, accuracyM: l.accuracyM ?? null, speedMps: l.speedMps ?? null, recordedAt: recordedAt.toISOString(),
  });
  if (!ok) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, recordedAt: recordedAt.toISOString() });
});

deviceRoutes.delete('/devices/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) return c.json({ error: 'not found' }, 404);
  const ok = await board(c.env).deleteDevice(id, c.var.user.id);
  if (!ok) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

deviceRoutes.post('/devices/:id/test-alert', async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) return c.json({ error: 'not found' }, 404);
  const r: TestAlertResult = await board(c.env).sendTestAlert(id, c.var.user.id);
  if (r.ok) return c.json({ ok: true, ticketId: r.ticketId ?? null, critical: r.critical });
  const status: 404 | 502 = r.error === 'device not found' ? 404 : 502;
  return c.json({ ok: false, error: r.error ?? 'push rejected', details: r.details ?? null }, status);
});
