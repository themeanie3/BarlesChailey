/**
 * Periodic flush of Durable Object state into Neon. One HTTP transaction per
 * flush so the database wakes once, does all the work, and goes back to sleep.
 */
import { neon } from '@neondatabase/serverless';
import type { Env } from '../env';
import type { AlertRecord, DeviceRecord, IncidentEventRecord, IncidentRecord } from '../engine/types';

export interface FlushBatch {
  incidents: IncidentRecord[];
  events: IncidentEventRecord[];
  devices: DeviceRecord[];
  alerts: AlertRecord[];
}

export function isEmptyBatch(b: FlushBatch): boolean {
  return !b.incidents.length && !b.events.length && !b.devices.length && !b.alerts.length;
}

export async function flushToNeon(env: Env, batch: FlushBatch): Promise<void> {
  if (isEmptyBatch(batch)) return;
  const sql = neon(env.DATABASE_URL);
  const queries = [];

  for (const i of batch.incidents) {
    queries.push(sql`
      INSERT INTO incidents (id, source, source_key, status, dispatched_at, address, city, lat, lon, formatted_address, geocode_status,
        call_code, call_description, category, severity, alertable, box, station, battalion, units, first_seen_at, last_seen_at, cleared_at, version)
      VALUES (${i.id}::uuid, ${i.source}, ${i.sourceKey}, ${i.status}::incident_status, ${i.dispatchedAt}::timestamptz, ${i.address}, ${i.city},
        ${i.lat}, ${i.lon}, ${i.formattedAddress}, ${i.geocodeStatus}::geocode_status, ${i.callCode}, ${i.callDescription},
        ${i.category}::incident_category, ${i.severity}::severity, ${i.alertable}, ${i.box}, ${i.station}, ${i.battalion}, ${i.units}::text[],
        ${i.firstSeenAt}::timestamptz, ${i.lastSeenAt}::timestamptz, ${i.clearedAt}::timestamptz, ${i.version})
      ON CONFLICT (source, source_key) DO UPDATE SET
        status = EXCLUDED.status, lat = EXCLUDED.lat, lon = EXCLUDED.lon, formatted_address = EXCLUDED.formatted_address,
        geocode_status = EXCLUDED.geocode_status, call_code = EXCLUDED.call_code, call_description = EXCLUDED.call_description,
        category = EXCLUDED.category, severity = EXCLUDED.severity, alertable = EXCLUDED.alertable, units = EXCLUDED.units,
        last_seen_at = EXCLUDED.last_seen_at, cleared_at = EXCLUDED.cleared_at, version = EXCLUDED.version
      WHERE incidents.version <= EXCLUDED.version`);
  }
  for (const e of batch.events) {
    queries.push(sql`
      INSERT INTO incident_events (id, incident_id, kind, at, data)
      SELECT ${e.id}::uuid, ${e.incidentId}::uuid, ${e.kind}::incident_event_kind, ${e.at}::timestamptz, ${JSON.stringify(e.data)}::jsonb
      WHERE EXISTS (SELECT 1 FROM incidents WHERE id = ${e.incidentId}::uuid)
      ON CONFLICT (id) DO NOTHING`);
  }
  for (const d of batch.devices) {
    queries.push(sql`
      INSERT INTO devices (id, user_id, expo_push_token, platform, app_version, device_name, push_enabled, critical_alerts_authorized, disabled_reason, created_at, last_seen_at)
      VALUES (${d.id}::uuid, ${d.userId}, ${d.expoPushToken}, ${d.platform}::device_platform, ${d.appVersion}, ${d.deviceName}, ${d.pushEnabled},
        ${d.criticalAlertsAuthorized}, ${d.disabledReason}, ${d.createdAt}::timestamptz, ${d.lastSeenAt}::timestamptz)
      ON CONFLICT (expo_push_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, app_version = EXCLUDED.app_version,
        device_name = EXCLUDED.device_name, push_enabled = EXCLUDED.push_enabled, critical_alerts_authorized = EXCLUDED.critical_alerts_authorized,
        disabled_reason = EXCLUDED.disabled_reason, last_seen_at = EXCLUDED.last_seen_at`);
    if (d.lat != null && d.lon != null && d.recordedAt) {
      queries.push(sql`
        INSERT INTO device_locations (device_id, lat, lon, accuracy_m, speed_mps, recorded_at, updated_at)
        SELECT id, ${d.lat}, ${d.lon}, ${d.accuracyM}, ${d.speedMps}, ${d.recordedAt}::timestamptz, now() FROM devices WHERE expo_push_token = ${d.expoPushToken}
        ON CONFLICT (device_id) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, accuracy_m = EXCLUDED.accuracy_m,
          speed_mps = EXCLUDED.speed_mps, recorded_at = EXCLUDED.recorded_at, updated_at = now()`);
    }
  }
  for (const a of batch.alerts) {
    queries.push(sql`
      INSERT INTO alerts (id, kind, incident_id, device_id, user_id, distance_m, matched_by, sent_at, expo_ticket_id, receipt_status, receipt_error, payload)
      SELECT ${a.id}::uuid, ${a.kind}::alert_kind,
        (SELECT id FROM incidents WHERE id = ${a.incidentId}::uuid), d.id, ${a.userId}, ${a.distanceM}, ${a.matchedBy},
        ${a.sentAt}::timestamptz, ${a.expoTicketId}, ${a.receiptStatus}::receipt_status, ${a.receiptError}, ${JSON.stringify(a.payload ?? null)}::jsonb
      FROM devices d WHERE d.id = ${a.deviceId}::uuid
      ON CONFLICT (id) DO UPDATE SET expo_ticket_id = EXCLUDED.expo_ticket_id, receipt_status = EXCLUDED.receipt_status, receipt_error = EXCLUDED.receipt_error`);
  }
  await sql.transaction(queries);
}
