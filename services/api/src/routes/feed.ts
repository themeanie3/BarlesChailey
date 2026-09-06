import { Hono } from 'hono';
import { FEED_VERSION } from '@barleschailey/feed';
import { board, intVar } from '../env';
import { requireReader, type AppEnv } from '../lib/auth';
import { geocodeAddress, neonGeocodeCache } from '../lib/geocode';
import { recordToEvent, recordToIncident, toEvent, toIncident, type EventRow, type IncidentRow } from '../lib/serialize';

export const feedRoutes = new Hono<AppEnv>();
feedRoutes.use('*', requireReader);

const UUID = /^[0-9a-f-]{36}$/i;

feedRoutes.get('/feed/status', async (c) => {
  const staleAfter = intVar(c.env.STALE_AFTER_SECONDS, 20);
  const s = await board(c.env).status();
  const last = s.lastPushAt ? new Date(s.lastPushAt) : null;
  return c.json({
    feedVersion: FEED_VERSION,
    source: c.env.FEED_SOURCE,
    lastPushAt: last?.toISOString() ?? null,
    stale: !last || Date.now() - last.getTime() > staleAfter * 1000,
    staleAfterSeconds: staleAfter,
    activeIncidents: s.activeIncidents,
    serverTime: new Date().toISOString(),
  });
});

/**
 * List incidents from the live board (active + the last 7 days).
 *   ?status=active|cleared|all
 *   ?since=<ISO>   only incidents updated after this instant (any status) — use for incremental sync
 *   ?limit=1..200
 *   ?includeSimulated=1  include admin test incidents
 * Older history lives in Postgres: ?archive=1 reads from there instead (wakes the database).
 */
feedRoutes.get('/incidents', async (c) => {
  const status = (c.req.query('status') ?? 'active') as 'active' | 'cleared' | 'all';
  const since = c.req.query('since') ?? null;
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 200);
  const includeSim = c.req.query('includeSimulated') === '1';
  if (since && Number.isNaN(Date.parse(since))) return c.json({ error: 'bad since' }, 400);
  if (!['active', 'cleared', 'all'].includes(status)) return c.json({ error: 'bad status' }, 400);
  if (c.req.query('archive') === '1') {
    const rows = (await c.var.sql`
      SELECT * FROM incidents
      WHERE (${includeSim} OR source <> 'simulation')
        AND (${since}::timestamptz IS NULL OR updated_at > ${since}::timestamptz)
        AND (${since}::timestamptz IS NOT NULL OR ${status} = 'all' OR status = ${status}::incident_status)
      ORDER BY dispatched_at DESC LIMIT ${limit}`) as IncidentRow[];
    return c.json({ feedVersion: FEED_VERSION, incidents: rows.map(toIncident), serverTime: new Date().toISOString() });
  }
  const incidents = await board(c.env).listIncidents({ status, since, limit, includeSimulated: includeSim });
  return c.json({ feedVersion: FEED_VERSION, incidents: incidents.map(recordToIncident), serverTime: new Date().toISOString() });
});

feedRoutes.get('/incidents/:id', async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) return c.json({ error: 'not found' }, 404);
  const b = board(c.env);
  const hot = await b.getIncident(id);
  if (hot) {
    let incident = hot.incident;
    // Non-alertable calls are geocoded lazily, the first time someone actually looks at them.
    if (incident.lat == null && incident.geocodeStatus === 'pending') {
      try {
        incident = (await b.geocodeIncident(id)) ?? incident;
      } catch (err) {
        console.warn('lazy geocode failed', (err as Error).message);
      }
    }
    return c.json({ feedVersion: FEED_VERSION, incident: recordToIncident(incident), events: hot.events.map(recordToEvent) });
  }
  // Cold path: archived incident in Postgres.
  const rows = (await c.var.sql`SELECT * FROM incidents WHERE id = ${id}`) as IncidentRow[];
  const inc = rows[0];
  if (!inc) return c.json({ error: 'not found' }, 404);
  if (inc.lat == null && inc.geocode_status === 'pending') {
    const g = await geocodeAddress(c.env, neonGeocodeCache(c.var.sql), inc.address, inc.city);
    if (g.status === 'ok') {
      await c.var.sql`UPDATE incidents SET lat = ${g.lat}, lon = ${g.lon}, formatted_address = ${g.formattedAddress}, geocode_status = 'ok', version = version + 1 WHERE id = ${id}`;
      Object.assign(inc, { lat: g.lat, lon: g.lon, formatted_address: g.formattedAddress, geocode_status: 'ok' });
    }
  }
  const events = (await c.var.sql`SELECT * FROM incident_events WHERE incident_id = ${id} ORDER BY at`) as EventRow[];
  return c.json({ feedVersion: FEED_VERSION, incident: toIncident(inc), events: events.map(toEvent) });
});

feedRoutes.get('/call-types', async (c) => {
  const rules = await board(c.env).getRules();
  return c.json({ feedVersion: FEED_VERSION, rules });
});
