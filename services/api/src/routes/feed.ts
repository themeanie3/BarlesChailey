import { Hono } from 'hono';
import { FEED_VERSION } from '@barleschailey/feed';
import { intVar } from '../env';
import { requireReader, type AppEnv } from '../lib/auth';
import { toEvent, toIncident, type EventRow, type IncidentRow } from '../lib/serialize';
import { geocodeIncident } from '../engine/ingest';

export const feedRoutes = new Hono<AppEnv>();
feedRoutes.use('*', requireReader);

feedRoutes.get('/feed/status', async (c) => {
  const staleAfter = intVar(c.env.STALE_AFTER_SECONDS, 20);
  const [src] = (await c.var.sql`SELECT last_push_at, last_row_count FROM feed_sources WHERE source = ${c.env.FEED_SOURCE}`) as Array<{ last_push_at: string | null; last_row_count: number | null }>;
  const [cnt] = (await c.var.sql`SELECT count(*)::int AS n FROM incidents WHERE status = 'active' AND source = ${c.env.FEED_SOURCE}`) as Array<{ n: number }>;
  const last = src?.last_push_at ? new Date(src.last_push_at) : null;
  return c.json({
    feedVersion: FEED_VERSION,
    source: c.env.FEED_SOURCE,
    lastPushAt: last?.toISOString() ?? null,
    stale: !last || Date.now() - last.getTime() > staleAfter * 1000,
    staleAfterSeconds: staleAfter,
    activeIncidents: cnt?.n ?? 0,
    serverTime: new Date().toISOString(),
  });
});

/**
 * List incidents. Default: active board, newest dispatch first.
 *   ?status=active|cleared|all
 *   ?since=<ISO>   only incidents updated after this instant (any status) — use for incremental sync
 *   ?limit=1..200
 *   ?includeSimulated=1  include admin test incidents
 */
feedRoutes.get('/incidents', async (c) => {
  const status = c.req.query('status') ?? 'active';
  const since = c.req.query('since');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 200);
  const includeSim = c.req.query('includeSimulated') === '1';
  if (since && Number.isNaN(Date.parse(since))) return c.json({ error: 'bad since' }, 400);
  if (!['active', 'cleared', 'all'].includes(status)) return c.json({ error: 'bad status' }, 400);
  const rows = (await c.var.sql`
    SELECT * FROM incidents
    WHERE (${includeSim} OR source <> 'simulation')
      AND (${since ?? null}::timestamptz IS NULL OR updated_at > ${since ?? null}::timestamptz)
      AND (${since ?? null}::timestamptz IS NOT NULL OR ${status} = 'all' OR status = ${status}::incident_status)
    ORDER BY dispatched_at DESC
    LIMIT ${limit}`) as IncidentRow[];
  return c.json({ feedVersion: FEED_VERSION, incidents: rows.map(toIncident), serverTime: new Date().toISOString() });
});

feedRoutes.get('/incidents/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'not found' }, 404);
  const rows = (await c.var.sql`SELECT * FROM incidents WHERE id = ${id}`) as IncidentRow[];
  let inc = rows[0];
  if (!inc) return c.json({ error: 'not found' }, 404);
  // Non-alertable calls are geocoded lazily, the first time someone actually looks at them.
  if (inc.lat == null && inc.geocode_status === 'pending') {
    try {
      inc = await geocodeIncident(c.env, c.var.sql, inc);
    } catch (err) {
      console.warn('lazy geocode failed', (err as Error).message);
    }
  }
  const events = (await c.var.sql`SELECT * FROM incident_events WHERE incident_id = ${id} ORDER BY at`) as EventRow[];
  return c.json({ feedVersion: FEED_VERSION, incident: toIncident(inc), events: events.map(toEvent) });
});

feedRoutes.get('/call-types', async (c) => {
  const rows = (await c.var.sql`SELECT code, description, category, severity, alertable, is_upgrade AS "isUpgrade" FROM call_type_rules ORDER BY category, severity DESC, code`) as unknown[];
  return c.json({ feedVersion: FEED_VERSION, rules: rows });
});
