import type { Env } from '../env';
import type { Sql } from '../lib/db';
import { buildIncidentMessage, sendExpoPush, type ExpoMessage, type IncidentForPush } from '../lib/push';
import { inQuietWindow } from '../lib/time';
import type { IncidentRow } from '../lib/serialize';

export type AlertKind = 'dispatch' | 'upgrade';

interface Candidate {
  device_id: string;
  user_id: string;
  expo_push_token: string;
  critical_alerts_authorized: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  quiet_allow_critical: boolean;
  alert_on_upgrade: boolean;
  device_dist_m: number | null;
  home_dist_m: number | null;
}

export interface DispatchResult {
  candidates: number;
  sent: number;
  skipped: number;
  errors: number;
}

export function toPushIncident(r: IncidentRow): IncidentForPush {
  return {
    id: r.id, address: r.address, city: r.city, callCode: r.call_code, callDescription: r.call_description,
    category: r.category, severity: r.severity, box: r.box, units: r.units ?? [], lat: r.lat, lon: r.lon,
  };
}

/**
 * Find every device that should be paged for this incident and page it once.
 *
 * Matching happens in SQL with PostGIS: a device qualifies if its last fix is
 * fresh and within the member's radius, or if the member set a home point and
 * the incident is within that radius. Quiet hours and upgrade opt-outs are
 * applied here in TypeScript. The partial unique index on alerts guarantees a
 * device is never paged twice for the same incident+kind, even if two pushes
 * from the station race each other. Four round trips total, independent of
 * how many devices match: candidates, claim, Expo send, ticket bookkeeping.
 */
export async function dispatchAlerts(env: Env, sql: Sql, incident: IncidentRow, kind: AlertKind): Promise<DispatchResult> {
  const result: DispatchResult = { candidates: 0, sent: 0, skipped: 0, errors: 0 };
  if (incident.lat == null || incident.lon == null || !incident.alertable) return result;

  const candidates = (await sql`
    WITH inc AS (SELECT ST_SetSRID(ST_MakePoint(${incident.lon}, ${incident.lat}), 4326)::geography AS g)
    SELECT d.id AS device_id, d.user_id, d.expo_push_token, d.critical_alerts_authorized,
           p.quiet_start::text AS quiet_start, p.quiet_end::text AS quiet_end, p.quiet_allow_critical, p.alert_on_upgrade,
           CASE WHEN dl.geom IS NOT NULL AND dl.recorded_at > now() - make_interval(hours => p.location_max_age_hours)
                THEN ST_Distance(dl.geom, inc.g) END AS device_dist_m,
           CASE WHEN p.home_geom IS NOT NULL THEN ST_Distance(p.home_geom, inc.g) END AS home_dist_m
    FROM devices d
    JOIN members m ON m.user_id = d.user_id AND m.status = 'active'
    JOIN alert_preferences p ON p.user_id = d.user_id
    LEFT JOIN device_locations dl ON dl.device_id = d.id
    CROSS JOIN inc
    WHERE d.push_enabled AND p.enabled
      AND (p.snooze_until IS NULL OR p.snooze_until < now())
      AND (cardinality(p.categories) = 0 OR ${incident.category}::incident_category = ANY(p.categories))
      AND severity_rank(${incident.severity}::severity) >= severity_rank(p.min_severity)
      AND (
        (dl.geom IS NOT NULL AND dl.recorded_at > now() - make_interval(hours => p.location_max_age_hours)
           AND ST_DWithin(dl.geom, inc.g, p.radius_miles * 1609.344))
        OR (p.home_geom IS NOT NULL AND ST_DWithin(p.home_geom, inc.g, COALESCE(p.home_radius_miles, p.radius_miles) * 1609.344))
      )`) as Candidate[];
  result.candidates = candidates.length;
  if (!candidates.length) return result;

  const now = new Date();
  const pushIncident = toPushIncident(incident);
  const wanted: Array<{ c: Candidate; message: ExpoMessage; distance: number | null; matchedBy: string }> = [];

  for (const c of candidates) {
    if (kind === 'upgrade' && !c.alert_on_upgrade) { result.skipped++; continue; }
    if (c.quiet_start && c.quiet_end && inQuietWindow(now, env.FEED_TIMEZONE, c.quiet_start, c.quiet_end)) {
      const breakThrough = c.quiet_allow_critical && incident.severity === 'critical';
      if (!breakThrough) { result.skipped++; continue; }
    }
    const distance = c.device_dist_m ?? c.home_dist_m;
    const matchedBy = c.device_dist_m != null ? 'device' : 'home';
    const message = buildIncidentMessage(env, {
      to: c.expo_push_token, incident: pushIncident, kind, distanceM: distance, deviceCriticalAuthorized: c.critical_alerts_authorized,
    });
    wanted.push({ c, message, distance, matchedBy });
  }
  if (!wanted.length) return result;

  // Claim (incident, device, kind) slots in one statement; rows already claimed by a racing push are skipped.
  const claimed = (await sql`
    INSERT INTO alerts (kind, incident_id, device_id, user_id, distance_m, matched_by, payload)
    SELECT ${kind}::alert_kind, ${incident.id}::uuid, u.device_id, u.user_id, u.distance_m, u.matched_by, u.payload
    FROM unnest(${wanted.map((w) => w.c.device_id)}::uuid[], ${wanted.map((w) => w.c.user_id)}::text[],
                ${wanted.map((w) => w.distance)}::float8[], ${wanted.map((w) => w.matchedBy)}::text[],
                ${wanted.map((w) => JSON.stringify({ title: w.message.title, body: w.message.body, data: w.message.data }))}::jsonb[])
         AS u(device_id, user_id, distance_m, matched_by, payload)
    ON CONFLICT (incident_id, device_id, kind) WHERE incident_id IS NOT NULL DO NOTHING
    RETURNING id, device_id`) as Array<{ id: string; device_id: string }>;
  const byDevice = new Map(claimed.map((r) => [r.device_id, r.id]));
  const queued = wanted.filter((w) => byDevice.has(w.c.device_id));
  result.skipped += wanted.length - queued.length;
  if (!queued.length) return result;

  const tickets = await sendExpoPush(env, queued.map((q) => q.message));
  const okIds: string[] = [], okTickets: string[] = [];
  const errIds: string[] = [], errMsgs: string[] = [];
  const deadDevices: string[] = [];
  queued.forEach((q, i) => {
    const alertId = byDevice.get(q.c.device_id)!;
    const t = tickets[i];
    if (t?.status === 'ok' && t.id) {
      okIds.push(alertId); okTickets.push(t.id); result.sent++;
    } else {
      const code = t?.details?.error ?? 'ticket';
      errIds.push(alertId); errMsgs.push(`${code}: ${t?.message ?? 'unknown'}`); result.errors++;
      if (code === 'DeviceNotRegistered') deadDevices.push(q.c.device_id);
    }
  });
  await sql.transaction([
    sql`UPDATE alerts a SET expo_ticket_id = u.ticket FROM unnest(${okIds}::uuid[], ${okTickets}::text[]) AS u(id, ticket) WHERE a.id = u.id`,
    sql`UPDATE alerts a SET receipt_status = 'error', receipt_error = u.msg FROM unnest(${errIds}::uuid[], ${errMsgs}::text[]) AS u(id, msg) WHERE a.id = u.id`,
    sql`UPDATE devices SET push_enabled = false, disabled_reason = 'DeviceNotRegistered' WHERE id = ANY(${deadDevices}::uuid[])`,
  ]);
  return result;
}
