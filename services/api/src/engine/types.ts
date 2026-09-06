import type { IncidentCategory, Severity } from '@barleschailey/feed';

/** Plain, storage-agnostic record shapes shared by the Durable Object, the Neon flush and the API. */

/**
 * Depth-limited JSON types. Deliberately not recursive: Durable Object RPC return types are
 * mapped through workers-types' serializer, and a recursive type makes that mapping diverge.
 */
type J0 = string | number | boolean | null;
type J1 = J0 | J0[] | { [key: string]: J0 | J0[] };
type J2 = J1 | J1[] | { [key: string]: J1 | J1[] };
export type JsonValue = J2 | J2[] | { [key: string]: J2 | J2[] };
export type JsonObject = { [key: string]: JsonValue };

export interface IncidentRecord {
  id: string;
  source: string;
  sourceKey: string;
  status: 'active' | 'cleared';
  dispatchedAt: string;
  address: string;
  city: string | null;
  lat: number | null;
  lon: number | null;
  formattedAddress: string | null;
  geocodeStatus: 'pending' | 'ok' | 'failed';
  geocodeAttempts: number;
  callCode: string;
  callDescription: string;
  category: IncidentCategory;
  severity: Severity;
  alertable: boolean;
  isUpgrade: boolean;
  box: string | null;
  station: string | null;
  battalion: string | null;
  units: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  clearedAt: string | null;
  updatedAt: string;
  version: number;
}

export type IncidentEventKind = 'created' | 'call_type_changed' | 'units_changed' | 'geocoded' | 'cleared' | 'reopened';

export interface IncidentEventRecord {
  id: string;
  incidentId: string;
  kind: IncidentEventKind;
  at: string;
  data: JsonObject;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  appVersion: string;
  deviceName: string | null;
  pushEnabled: boolean;
  criticalAlertsAuthorized: boolean;
  disabledReason: string | null;
  createdAt: string;
  lastSeenAt: string;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
  speedMps: number | null;
  recordedAt: string | null;
}

export interface PrefsRecord {
  userId: string;
  enabled: boolean;
  radiusMiles: number;
  categories: IncidentCategory[];
  minSeverity: Severity;
  locationMaxAgeHours: number;
  home: { lat: number; lon: number; radiusMiles: number; label: string | null } | null;
  quietHours: { start: string; end: string; allowCritical: boolean } | null;
  snoozeUntil: string | null;
  alertOnUpgrade: boolean;
  updatedAt: string;
}

export interface MemberRecord {
  userId: string;
  email: string;
  role: 'admin' | 'member';
  status: 'pending' | 'active' | 'revoked';
  syncedAt: string;
}

export interface AlertRecord {
  id: string;
  kind: 'dispatch' | 'upgrade' | 'test';
  incidentId: string | null;
  deviceId: string;
  userId: string;
  distanceM: number | null;
  matchedBy: 'device' | 'home' | 'test' | null;
  sentAt: string;
  expoTicketId: string | null;
  receiptStatus: 'pending' | 'ok' | 'error';
  receiptError: string | null;
  payload: JsonValue | null;
}
