import { SEVERITY_RANK } from '@barleschailey/feed';
import type { Env } from '../env';
import { intVar } from '../env';
import type { Sql } from '../lib/db';
import { geocodeAddress } from '../lib/geocode';
import type { IncidentRow } from '../lib/serialize';
import { parseFsasTimestamp } from '../lib/time';
import { dispatchAlerts, type AlertKind } from './alerts';
import { battalionForStation, cityForBox, classify, loadRules, stationForBox } from './classify';
import { hasTable, parseFsasTable, sourceKey, type FsasRow } from './parse-fsas';

export class IngestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface IngestResult {
  rows: number;
  created: number;
  updated: number;
  reopened: number;
  cleared: number;
  alertsQueued: number;
}

export function unitsDelta(prev: string[], next: string[]): { added: string[]; removed: string[]; changed: boolean } {
  const a = new Set(prev), b = new Set(next);
  const added = [...b].filter((u) => !a.has(u)).sort();
  const removed = [...a].filter((u) => !b.has(u)).sort();
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

interface PendingAlert { incident: IncidentRow; kind: AlertKind }
interface PendingEvent { incidentId: string; kind: string; data: Record<string, unknown> }

/** How long after first sight we keep retrying a pending geocode on every push. */
const GEOCODE_RETRY_WINDOW_MS = 15 * 60 * 1000;
const MAX_GEOCODES_PER_PUSH = 6;

/**
 * Ingest one FSAS table snapshot.
 *
 * Cost profile matters here (Cloudflare free tier allows 50 subrequests per
 * request, and every Neon HTTP call is one): the whole diff is persisted in
 * three round trips regardless of how many rows the board shows —
 *   1. read current incidents,
 *   2. one transaction with all inserts/updates/clears,
 *   3. one transaction with all events + the feed heartbeat.
 * Geocoding and alert fan-out then run in the background via `waitUntil`, and
 * only alertable incidents are geocoded eagerly.
 */
export async function ingestFsas(
  env: Env, sql: Sql, html: string, feedTs: number | null, ctx?: { waitUntil(p: Promise<unknown>): void },
): Promise<IngestResult> {
  if (!hasTable(html)) throw new IngestError('body does not contain an HTML table');
  const source = env.FEED_SOURCE;
  const grace = intVar(env.CLEAR_GRACE_SECONDS, 20);
  const rows = parseFsasTable(html);
  const rules = await loadRules(sql);
  const now = new Date();
  const result: IngestResult = { rows: rows.length, created: 0, updated: 0, reopened: 0, cleared: 0, alertsQueued: 0 };

  const keyed = new Map<string, FsasRow>();
  for (const r of rows) keyed.set(sourceKey(r), r);
  const keys = [...keyed.keys()];

  // 1. Current state.
  const existing = (await sql`
    SELECT * FROM incidents WHERE source = ${source} AND (status = 'active' OR source_key = ANY(${keys}::text[]))`) as IncidentRow[];
  const byKey = new Map(existing.map((r) => [r.source_key, r]));

  // 2. Plan the diff.
  type Planned =
    | { op: 'insert'; key: string; row: FsasRow; alertable: boolean }
    | { op: 'update'; prev: IncidentRow; row: FsasRow; events: PendingEvent[]; upgrade: boolean };
  const planned: Planned[] = [];
  const unchangedIds: string[] = [];

  for (const [key, row] of keyed) {
    const prev = byKey.get(key);
    if (!prev) {
      planned.push({ op: 'insert', key, row, alertable: classify(row.code, rules).alertable });
      continue;
    }
    const events: PendingEvent[] = [];
    let upgrade = false;
    if (prev.call_code !== row.code || prev.call_description !== row.description) {
      const cls = classify(row.code, rules);
      events.push({ incidentId: prev.id, kind: 'call_type_changed', data: { from: { code: prev.call_code, description: prev.call_description, severity: prev.severity }, to: { code: row.code, description: row.description, severity: cls.severity } } });
      upgrade = cls.alertable && (SEVERITY_RANK[cls.severity] > SEVERITY_RANK[prev.severity] || cls.isUpgrade);
    }
    const delta = unitsDelta(prev.units ?? [], row.units);
    if (delta.changed) events.push({ incidentId: prev.id, kind: 'units_changed', data: { added: delta.added, removed: delta.removed, units: row.units } });
    if (prev.status === 'cleared') events.push({ incidentId: prev.id, kind: 'reopened', data: { clearedAt: prev.cleared_at } });
    if (events.length) planned.push({ op: 'update', prev, row, events, upgrade });
    else unchangedIds.push(prev.id);
  }

  // 3. One transaction for every write that changes an incident row.
  const writes = planned.map((p) => {
    if (p.op === 'insert') {
      const cls = classify(p.row.code, rules);
      const station = stationForBox(p.row.box);
      const dispatchedAt = parseFsasTimestamp(p.row.time, env.FEED_TIMEZONE, now) ?? now;
      return sql`
        INSERT INTO incidents (source, source_key, status, dispatched_at, address, city, call_code, call_description,
                               category, severity, alertable, box, station, battalion, units, first_seen_at, last_seen_at, raw)
        VALUES (${source}, ${p.key}, 'active', ${dispatchedAt.toISOString()}, ${p.row.address}, ${cityForBox(p.row.box)}, ${p.row.code}, ${p.row.description},
                ${cls.category}::incident_category, ${cls.severity}::severity, ${cls.alertable}, ${p.row.box}, ${station}, ${battalionForStation(station)},
                ${p.row.units}::text[], now(), now(), ${JSON.stringify(p.row.cells)}::jsonb)
        ON CONFLICT (source, source_key) DO NOTHING
        RETURNING *`;
    }
    const cls = classify(p.row.code, rules);
    return sql`
      UPDATE incidents SET
        last_seen_at = now(), status = 'active', cleared_at = NULL,
        units = ${p.row.units}::text[], call_code = ${p.row.code}, call_description = ${p.row.description},
        category = ${cls.category}::incident_category, severity = ${cls.severity}::severity, alertable = ${cls.alertable},
        version = version + 1, raw = ${JSON.stringify(p.row.cells)}::jsonb
      WHERE id = ${p.prev.id}
      RETURNING *`;
  });
  writes.push(sql`UPDATE incidents SET last_seen_at = now() WHERE id = ANY(${unchangedIds}::uuid[])`);
  writes.push(sql`
    UPDATE incidents SET status = 'cleared', cleared_at = now(), version = version + 1
    WHERE source = ${source} AND status = 'active'
      AND NOT (source_key = ANY(${keys}::text[]))
      AND last_seen_at < now() - make_interval(secs => ${grace})
    RETURNING id, units`);
  const results = (await sql.transaction(writes)) as unknown[][];

  // 4. Collect outcomes.
  const events: PendingEvent[] = [];
  const toGeocode: IncidentRow[] = [];
  const pendingAlerts: PendingAlert[] = [];
  planned.forEach((p, i) => {
    const row = (results[i] as IncidentRow[] | undefined)?.[0];
    if (p.op === 'insert') {
      if (!row) return; // lost a race with a concurrent push; next push treats it as existing
      result.created++;
      events.push({ incidentId: row.id, kind: 'created', data: { code: p.row.code, description: p.row.description, units: p.row.units, box: p.row.box } });
      if (row.alertable) {
        toGeocode.push(row);
        pendingAlerts.push({ incident: row, kind: 'dispatch' });
      }
      return;
    }
    const inc = row ?? p.prev;
    result.updated++;
    if (p.prev.status === 'cleared') result.reopened++;
    events.push(...p.events);
    if (p.upgrade) pendingAlerts.push({ incident: inc, kind: 'upgrade' });
  });
  // Alertable incidents whose geocode is still pending get retried for a while.
  for (const inc of existing) {
    if (inc.alertable && inc.lat == null && inc.geocode_status === 'pending' && keyed.has(inc.source_key)
        && now.getTime() - new Date(inc.first_seen_at).getTime() < GEOCODE_RETRY_WINDOW_MS
        && !toGeocode.some((g) => g.id === inc.id)) {
      toGeocode.push(inc);
      if (!pendingAlerts.some((p) => p.incident.id === inc.id)) pendingAlerts.push({ incident: inc, kind: 'dispatch' });
    }
  }
  const clearedRows = (results[results.length - 1] as Array<{ id: string; units: string[] }>) ?? [];
  result.cleared = clearedRows.length;
  for (const c of clearedRows) events.push({ incidentId: c.id, kind: 'cleared', data: { units: c.units } });

  // 5. Events + heartbeat in one transaction.
  await sql.transaction([
    sql`
      INSERT INTO incident_events (incident_id, kind, data)
      SELECT * FROM unnest(${events.map((e) => e.incidentId)}::uuid[], ${events.map((e) => e.kind)}::incident_event_kind[], ${events.map((e) => JSON.stringify(e.data))}::jsonb[])`,
    sql`
      INSERT INTO feed_sources (source, last_push_at, last_push_ts, last_row_count, last_error, updated_at)
      VALUES (${source}, now(), ${feedTs}, ${rows.length}, NULL, now())
      ON CONFLICT (source) DO UPDATE SET last_push_at = now(), last_push_ts = EXCLUDED.last_push_ts,
        last_row_count = EXCLUDED.last_row_count, last_error = NULL, updated_at = now()`,
  ]);

  result.alertsQueued = pendingAlerts.length;
  const post = postProcess(env, sql, toGeocode.slice(0, MAX_GEOCODES_PER_PUSH), pendingAlerts);
  if (ctx) ctx.waitUntil(post);
  else await post;
  return result;
}

/** Geocode one incident (cache-first) and persist the result. Returns the refreshed row. */
export async function geocodeIncident(env: Env, sql: Sql, inc: IncidentRow): Promise<IncidentRow> {
  if (inc.lat != null && inc.lon != null) return inc;
  const g = await geocodeAddress(env, sql, inc.address, inc.city);
  if (g.status === 'ok') {
    const [rows] = (await sql.transaction([
      sql`UPDATE incidents SET lat = ${g.lat}, lon = ${g.lon}, formatted_address = ${g.formattedAddress}, geocode_status = 'ok', version = version + 1
          WHERE id = ${inc.id} RETURNING *`,
      sql`INSERT INTO incident_events (incident_id, kind, data) VALUES (${inc.id}, 'geocoded', ${JSON.stringify({ lat: g.lat, lon: g.lon, formattedAddress: g.formattedAddress })}::jsonb)`,
    ])) as [IncidentRow[], unknown[]];
    return rows[0] ?? inc;
  }
  if (g.status === 'failed') {
    await sql`UPDATE incidents SET geocode_status = 'failed' WHERE id = ${inc.id} AND geocode_status = 'pending'`;
    return { ...inc, geocode_status: 'failed' };
  }
  return inc;
}

async function postProcess(env: Env, sql: Sql, toGeocode: IncidentRow[], pendingAlerts: PendingAlert[]): Promise<void> {
  const located = new Map<string, IncidentRow>();
  for (const inc of toGeocode) {
    try {
      located.set(inc.id, await geocodeIncident(env, sql, inc));
    } catch (err) {
      console.error('geocode failed', inc.id, (err as Error).message);
    }
  }
  for (const p of pendingAlerts) {
    const inc = located.get(p.incident.id) ?? p.incident;
    if (inc.lat == null || inc.lon == null) continue;
    try {
      const r = await dispatchAlerts(env, sql, inc, p.kind);
      if (r.candidates) console.log(`alerts ${p.kind} ${inc.call_code} @ ${inc.address}: ${r.sent} sent, ${r.skipped} skipped, ${r.errors} errors`);
    } catch (err) {
      console.error('dispatchAlerts failed', inc.id, (err as Error).message);
    }
  }
}
