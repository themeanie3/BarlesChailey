/**
 * BarlesChailey dispatch feed contract, version 1.
 *
 * Every consumer (the iOS app, the station dashboard, future tools) speaks this
 * shape and only this shape. The raw CAD/FSAS table never leaves the ingest
 * layer. Bump FEED_VERSION and add a new module for breaking changes; additive
 * optional fields are fine within v1.
 */
import { z } from 'zod';

export const FEED_VERSION = 1 as const;

export const IncidentCategory = z.enum(['fire', 'rescue', 'ems', 'hazmat', 'service', 'other']);
export type IncidentCategory = z.infer<typeof IncidentCategory>;

/** Ordered from least to most urgent. Used for "alert me at >= X" preferences. */
export const Severity = z.enum(['low', 'normal', 'high', 'critical']);
export type Severity = z.infer<typeof Severity>;
export const SEVERITY_RANK: Record<Severity, number> = { low: 0, normal: 1, high: 2, critical: 3 };

export const IncidentStatus = z.enum(['active', 'cleared']);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const GeocodeStatus = z.enum(['pending', 'ok', 'failed']);

export const Location = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  formattedAddress: z.string().nullable(),
  geocodeStatus: GeocodeStatus,
});
export type Location = z.infer<typeof Location>;

export const CallType = z.object({
  /** CAD call code exactly as dispatched, e.g. "HOUSE", "CPR2", "PICTRAP1". */
  code: z.string().min(1),
  /** Human readable CAD description, e.g. "HOUSE FIRE". */
  description: z.string(),
  category: IncidentCategory,
  severity: Severity,
  /** Whether this call type is eligible to page off-duty responders at all. */
  alertable: z.boolean(),
});
export type CallType = z.infer<typeof CallType>;

export const Incident = z.object({
  id: z.uuid(),
  feedVersion: z.literal(FEED_VERSION),
  /** Identifier of the upstream system, e.g. "mcfrs-fsas". */
  source: z.string(),
  /** Stable identity of the incident inside the source (dispatch time + address + box). */
  sourceKey: z.string(),
  status: IncidentStatus,
  /** ISO-8601 UTC instant the CAD system dispatched the call. */
  dispatchedAt: z.iso.datetime(),
  /** Street address exactly as shown by CAD (uppercase, unnormalized). */
  address: z.string(),
  /** Best-effort city derived from the box area (helps geocoding and display). */
  city: z.string().nullable(),
  location: Location.nullable(),
  call: CallType,
  /** 4-digit MCFRS box area, e.g. "0314". Null when CAD shows no box. */
  box: z.string().nullable(),
  /** 2-digit first-due station derived from the box, e.g. "03". */
  station: z.string().nullable(),
  /** MCFRS battalion (1-5) derived from the station, when known. */
  battalion: z.string().nullable(),
  /** Units currently assigned, e.g. ["E703", "T703", "RS703"]. */
  units: z.array(z.string()),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  clearedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  /** Monotonic per-incident revision; increments on every change. */
  version: z.number().int().nonnegative(),
});
export type Incident = z.infer<typeof Incident>;

export const IncidentEventKind = z.enum([
  'created',
  'call_type_changed',
  'units_changed',
  'geocoded',
  'cleared',
  'reopened',
]);
export type IncidentEventKind = z.infer<typeof IncidentEventKind>;

export const IncidentEvent = z.object({
  id: z.uuid(),
  incidentId: z.uuid(),
  kind: IncidentEventKind,
  at: z.iso.datetime(),
  /** Kind-specific payload (previous/next values). */
  data: z.record(z.string(), z.unknown()),
});
export type IncidentEvent = z.infer<typeof IncidentEvent>;

export const FeedStatus = z.object({
  feedVersion: z.literal(FEED_VERSION),
  source: z.string(),
  /** Last time the ingest endpoint accepted a push from the station. */
  lastPushAt: z.iso.datetime().nullable(),
  /** True when no push has arrived within STALE_AFTER_SECONDS. */
  stale: z.boolean(),
  staleAfterSeconds: z.number().int(),
  activeIncidents: z.number().int(),
  serverTime: z.iso.datetime(),
});
export type FeedStatus = z.infer<typeof FeedStatus>;

export const IncidentListResponse = z.object({
  feedVersion: z.literal(FEED_VERSION),
  incidents: z.array(Incident),
  serverTime: z.iso.datetime(),
});
export type IncidentListResponse = z.infer<typeof IncidentListResponse>;

export const IncidentDetailResponse = z.object({
  feedVersion: z.literal(FEED_VERSION),
  incident: Incident,
  events: z.array(IncidentEvent),
});
export type IncidentDetailResponse = z.infer<typeof IncidentDetailResponse>;

// ---------------------------------------------------------------------------
// Responder-side contracts (devices, preferences, alerts)
// ---------------------------------------------------------------------------

export const Platform = z.enum(['ios', 'android']);

export const DeviceRegistration = z.object({
  expoPushToken: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/),
  platform: Platform,
  appVersion: z.string(),
  deviceName: z.string().max(120).optional(),
  /** Whether the OS granted critical-alert authorization (iOS only). */
  criticalAlertsAuthorized: z.boolean().optional(),
});
export type DeviceRegistration = z.infer<typeof DeviceRegistration>;

export const Device = z.object({
  id: z.uuid(),
  platform: Platform,
  appVersion: z.string(),
  deviceName: z.string().nullable(),
  pushEnabled: z.boolean(),
  criticalAlertsAuthorized: z.boolean(),
  lastSeenAt: z.iso.datetime(),
  lastLocationAt: z.iso.datetime().nullable(),
});
export type Device = z.infer<typeof Device>;

export const LocationUpdate = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().nullable().optional(),
  speedMps: z.number().nullable().optional(),
  /** When the fix was taken on the device. */
  recordedAt: z.iso.datetime(),
});
export type LocationUpdate = z.infer<typeof LocationUpdate>;

/** "HH:MM" 24h local time. */
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const AlertPreferences = z.object({
  enabled: z.boolean(),
  /** Alert when the incident is within this many miles of the device's last fix. */
  radiusMiles: z.number().min(0.25).max(50),
  /** Empty array means every category. */
  categories: z.array(IncidentCategory),
  minSeverity: Severity,
  /** Ignore device fixes older than this (hours). */
  locationMaxAgeHours: z.number().int().min(1).max(168),
  /** Optional fixed "home"/station point that is always checked, even if the phone's fix is stale. */
  home: z
    .object({ lat: z.number(), lon: z.number(), radiusMiles: z.number().min(0.25).max(50), label: z.string().max(60).nullable() })
    .nullable(),
  /** Local quiet window in America/New_York; null = none. Critical severity still breaks through if quietAllowsCritical. */
  quietHours: z.object({ start: HHMM, end: HHMM, allowCritical: z.boolean() }).nullable(),
  /** Suppress everything until this instant (e.g. while on shift). */
  snoozeUntil: z.iso.datetime().nullable(),
  /** Also page on call-type upgrades (e.g. HOUSE -> UBOX) for incidents already alerted. */
  alertOnUpgrade: z.boolean(),
});
export type AlertPreferences = z.infer<typeof AlertPreferences>;

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  enabled: true,
  radiusMiles: 5,
  categories: [],
  minSeverity: 'high',
  locationMaxAgeHours: 12,
  home: null,
  quietHours: null,
  snoozeUntil: null,
  alertOnUpgrade: true,
};

export const AlertKind = z.enum(['dispatch', 'upgrade', 'test']);
export type AlertKind = z.infer<typeof AlertKind>;

export const Alert = z.object({
  id: z.uuid(),
  kind: AlertKind,
  incidentId: z.uuid().nullable(),
  deviceId: z.uuid(),
  distanceMiles: z.number().nullable(),
  sentAt: z.iso.datetime(),
  /** Expo push receipt status once known. */
  receiptStatus: z.enum(['pending', 'ok', 'error']),
  receiptError: z.string().nullable(),
});
export type Alert = z.infer<typeof Alert>;

export const MemberRole = z.enum(['admin', 'member']);
export const MemberStatus = z.enum(['pending', 'active', 'revoked']);

export const Me = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }),
  member: z.object({ role: MemberRole, status: MemberStatus }),
  preferences: AlertPreferences,
  devices: z.array(Device),
});
export type Me = z.infer<typeof Me>;

/** Payload carried inside every push notification's `data` field. */
export const PushData = z.object({
  type: z.literal('incident').or(z.literal('test')),
  incidentId: z.uuid().optional(),
  /** expo-router path to open when the notification is tapped. */
  url: z.string(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  severity: Severity.optional(),
});
export type PushData = z.infer<typeof PushData>;

export * from './call-types';
