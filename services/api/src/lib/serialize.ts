import { FEED_VERSION, type Alert, type AlertPreferences, type Device, type Incident, type IncidentEvent } from '@barleschailey/feed';
import type { AlertRecord, DeviceRecord, IncidentEventRecord, IncidentRecord, PrefsRecord } from '../engine/types';

// ---------------------------------------------------------------------------
// Durable Object records -> feed contract
// ---------------------------------------------------------------------------

export function recordToIncident(r: IncidentRecord): Incident {
  return {
    id: r.id,
    feedVersion: FEED_VERSION,
    source: r.source,
    sourceKey: r.sourceKey,
    status: r.status,
    dispatchedAt: r.dispatchedAt,
    address: r.address,
    city: r.city,
    location: r.lat != null && r.lon != null ? { lat: r.lat, lon: r.lon, formattedAddress: r.formattedAddress, geocodeStatus: 'ok' } : null,
    call: { code: r.callCode, description: r.callDescription, category: r.category, severity: r.severity, alertable: r.alertable },
    box: r.box,
    station: r.station,
    battalion: r.battalion,
    units: r.units,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    clearedAt: r.clearedAt,
    updatedAt: r.updatedAt,
    version: r.version,
  };
}

export function recordToEvent(e: IncidentEventRecord): IncidentEvent {
  return { id: e.id, incidentId: e.incidentId, kind: e.kind, at: e.at, data: e.data };
}

export function recordToDevice(d: DeviceRecord): Device {
  return {
    id: d.id, platform: d.platform, appVersion: d.appVersion, deviceName: d.deviceName, pushEnabled: d.pushEnabled,
    criticalAlertsAuthorized: d.criticalAlertsAuthorized, lastSeenAt: d.lastSeenAt, lastLocationAt: d.recordedAt,
  };
}

export function recordToPreferences(p: PrefsRecord): AlertPreferences {
  return {
    enabled: p.enabled, radiusMiles: p.radiusMiles, categories: p.categories, minSeverity: p.minSeverity,
    locationMaxAgeHours: p.locationMaxAgeHours, home: p.home, quietHours: p.quietHours, snoozeUntil: p.snoozeUntil, alertOnUpgrade: p.alertOnUpgrade,
  };
}

export function recordToAlert(a: AlertRecord): Alert {
  return {
    id: a.id, kind: a.kind, incidentId: a.incidentId, deviceId: a.deviceId,
    distanceMiles: a.distanceM == null ? null : Math.round((a.distanceM / 1609.344) * 100) / 100,
    sentAt: a.sentAt, receiptStatus: a.receiptStatus, receiptError: a.receiptError,
  };
}

// ---------------------------------------------------------------------------
// Postgres rows (cold path) -> records / contract
// ---------------------------------------------------------------------------

export interface IncidentRow {
  id: string;
  source: string;
  source_key: string;
  status: 'active' | 'cleared';
  dispatched_at: string | Date;
  address: string;
  city: string | null;
  lat: number | null;
  lon: number | null;
  formatted_address: string | null;
  geocode_status: 'pending' | 'ok' | 'failed';
  call_code: string;
  call_description: string;
  category: Incident['call']['category'];
  severity: Incident['call']['severity'];
  alertable: boolean;
  box: string | null;
  station: string | null;
  battalion: string | null;
  units: string[];
  first_seen_at: string | Date;
  last_seen_at: string | Date;
  cleared_at: string | Date | null;
  updated_at: string | Date;
  version: number;
}

export const iso = (v: string | Date | null | undefined): string | null => (v == null ? null : new Date(v).toISOString());
const isoReq = (v: string | Date): string => new Date(v).toISOString();

export function rowToIncidentRecord(r: IncidentRow): IncidentRecord {
  return {
    id: r.id, source: r.source, sourceKey: r.source_key, status: r.status, dispatchedAt: isoReq(r.dispatched_at), address: r.address, city: r.city,
    lat: r.lat, lon: r.lon, formattedAddress: r.formatted_address, geocodeStatus: r.geocode_status, geocodeAttempts: 0,
    callCode: r.call_code, callDescription: r.call_description, category: r.category, severity: r.severity, alertable: r.alertable, isUpgrade: false,
    box: r.box, station: r.station, battalion: r.battalion, units: r.units ?? [],
    firstSeenAt: isoReq(r.first_seen_at), lastSeenAt: isoReq(r.last_seen_at), clearedAt: iso(r.cleared_at), updatedAt: isoReq(r.updated_at), version: r.version,
  };
}

export function toIncident(r: IncidentRow): Incident {
  return recordToIncident(rowToIncidentRecord(r));
}

export interface EventRow { id: string; incident_id: string; kind: IncidentEvent['kind']; at: string | Date; data: Record<string, unknown> }
export function toEvent(r: EventRow): IncidentEvent {
  return { id: r.id, incidentId: r.incident_id, kind: r.kind, at: isoReq(r.at), data: r.data ?? {} };
}

export interface PrefsRow {
  user_id: string;
  enabled: boolean; radius_miles: string | number; categories: AlertPreferences['categories'] | string; min_severity: AlertPreferences['minSeverity'];
  location_max_age_hours: number; home_lat: number | null; home_lon: number | null; home_radius_miles: string | number | null; home_label: string | null;
  quiet_start: string | null; quiet_end: string | null; quiet_allow_critical: boolean; snooze_until: string | Date | null; alert_on_upgrade: boolean;
  updated_at: string | Date;
}
const hhmm = (t: string | null): string | null => (t ? t.slice(0, 5) : null);

/** Enum arrays come back from the HTTP driver as Postgres array literals; plain arrays pass through. */
function parseCategories(v: PrefsRow['categories']): AlertPreferences['categories'] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean) as AlertPreferences['categories'];
  return [];
}

export function rowToPrefsRecord(r: PrefsRow): PrefsRecord {
  return {
    userId: r.user_id,
    enabled: r.enabled,
    radiusMiles: Number(r.radius_miles),
    categories: parseCategories(r.categories),
    minSeverity: r.min_severity,
    locationMaxAgeHours: r.location_max_age_hours,
    home:
      r.home_lat != null && r.home_lon != null
        ? { lat: r.home_lat, lon: r.home_lon, radiusMiles: Number(r.home_radius_miles ?? r.radius_miles), label: r.home_label }
        : null,
    quietHours: r.quiet_start && r.quiet_end ? { start: hhmm(r.quiet_start)!, end: hhmm(r.quiet_end)!, allowCritical: r.quiet_allow_critical } : null,
    snoozeUntil: iso(r.snooze_until),
    alertOnUpgrade: r.alert_on_upgrade,
    updatedAt: isoReq(r.updated_at),
  };
}

export function toPreferences(r: PrefsRow): AlertPreferences {
  return recordToPreferences(rowToPrefsRecord(r));
}
