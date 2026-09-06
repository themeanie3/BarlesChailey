import { FEED_VERSION, type Alert, type AlertPreferences, type Device, type Incident, type IncidentEvent } from '@barleschailey/feed';

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

export function toIncident(r: IncidentRow): Incident {
  return {
    id: r.id,
    feedVersion: FEED_VERSION,
    source: r.source,
    sourceKey: r.source_key,
    status: r.status,
    dispatchedAt: isoReq(r.dispatched_at),
    address: r.address,
    city: r.city,
    location:
      r.lat != null && r.lon != null
        ? { lat: r.lat, lon: r.lon, formattedAddress: r.formatted_address, geocodeStatus: 'ok' }
        : r.geocode_status === 'failed'
          ? null
          : null,
    call: {
      code: r.call_code,
      description: r.call_description,
      category: r.category,
      severity: r.severity,
      alertable: r.alertable,
    },
    box: r.box,
    station: r.station,
    battalion: r.battalion,
    units: r.units ?? [],
    firstSeenAt: isoReq(r.first_seen_at),
    lastSeenAt: isoReq(r.last_seen_at),
    clearedAt: iso(r.cleared_at),
    updatedAt: isoReq(r.updated_at),
    version: r.version,
  };
}

export interface EventRow { id: string; incident_id: string; kind: IncidentEvent['kind']; at: string | Date; data: Record<string, unknown> }
export function toEvent(r: EventRow): IncidentEvent {
  return { id: r.id, incidentId: r.incident_id, kind: r.kind, at: isoReq(r.at), data: r.data ?? {} };
}

export interface PrefsRow {
  enabled: boolean; radius_miles: string | number; categories: AlertPreferences['categories']; min_severity: AlertPreferences['minSeverity'];
  location_max_age_hours: number; home_lat: number | null; home_lon: number | null; home_radius_miles: string | number | null; home_label: string | null;
  quiet_start: string | null; quiet_end: string | null; quiet_allow_critical: boolean; snooze_until: string | Date | null; alert_on_upgrade: boolean;
}
const hhmm = (t: string | null): string | null => (t ? t.slice(0, 5) : null);
export function toPreferences(r: PrefsRow): AlertPreferences {
  return {
    enabled: r.enabled,
    radiusMiles: Number(r.radius_miles),
    categories: r.categories ?? [],
    minSeverity: r.min_severity,
    locationMaxAgeHours: r.location_max_age_hours,
    home:
      r.home_lat != null && r.home_lon != null
        ? { lat: r.home_lat, lon: r.home_lon, radiusMiles: Number(r.home_radius_miles ?? r.radius_miles), label: r.home_label }
        : null,
    quietHours: r.quiet_start && r.quiet_end ? { start: hhmm(r.quiet_start)!, end: hhmm(r.quiet_end)!, allowCritical: r.quiet_allow_critical } : null,
    snoozeUntil: iso(r.snooze_until),
    alertOnUpgrade: r.alert_on_upgrade,
  };
}

export interface DeviceRow {
  id: string; platform: Device['platform']; app_version: string; device_name: string | null; push_enabled: boolean;
  critical_alerts_authorized: boolean; last_seen_at: string | Date; last_location_at?: string | Date | null;
}
export function toDevice(r: DeviceRow): Device {
  return {
    id: r.id, platform: r.platform, appVersion: r.app_version, deviceName: r.device_name, pushEnabled: r.push_enabled,
    criticalAlertsAuthorized: r.critical_alerts_authorized, lastSeenAt: isoReq(r.last_seen_at), lastLocationAt: iso(r.last_location_at ?? null),
  };
}

export interface AlertRow {
  id: string; kind: Alert['kind']; incident_id: string | null; device_id: string; distance_m: number | null; sent_at: string | Date;
  receipt_status: Alert['receiptStatus']; receipt_error: string | null;
}
export function toAlert(r: AlertRow): Alert {
  return {
    id: r.id, kind: r.kind, incidentId: r.incident_id, deviceId: r.device_id,
    distanceMiles: r.distance_m == null ? null : Math.round((r.distance_m / 1609.344) * 100) / 100,
    sentAt: isoReq(r.sent_at), receiptStatus: r.receipt_status, receiptError: r.receipt_error,
  };
}
