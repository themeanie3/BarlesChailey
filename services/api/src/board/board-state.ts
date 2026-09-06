/**
 * BoardState — one Durable Object per feed source. It is the hot path:
 *
 *   station push → parse → diff → classify → geocode → match devices → Expo push
 *
 * all against its own SQLite storage, so Postgres is never touched while a
 * call is being paged. A periodic alarm flushes changed rows to Neon in one
 * batched transaction and lets the database go back to sleep in between,
 * which is what keeps the whole system inside the free tiers.
 */
import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_ALERT_PREFERENCES, type IncidentCategory, type Severity } from '@barleschailey/feed';
import type { Env } from '../env';
import { intVar } from '../env';
import { DEFAULT_RULES, classify, type Rule, type RuleMap } from '../engine/classify';
import { diffBoard, type AlertIntent } from '../engine/diff';
import { matchDevices, type Candidate } from '../engine/match';
import { parseFsasTable } from '../engine/parse-fsas';
import type { AlertRecord, DeviceRecord, IncidentEventRecord, IncidentRecord, JsonObject, JsonValue, MemberRecord, PrefsRecord } from '../engine/types';
import { geocodeAddress, type GeocodeCache, type GeocodeCacheEntry } from '../lib/geocode';
import { buildIncidentMessage, buildTestMessage, getExpoReceipts, sendExpoPush, type ExpoMessage, type IncidentForPush } from '../lib/push';
import { flushToNeon, isEmptyBatch, type FlushBatch } from './flush';
import { BOARD_SCHEMA } from './schema';

// ---------------------------------------------------------------------------
// Row shapes (SQLite) and mappers
// ---------------------------------------------------------------------------

type IncidentRow = {
  id: string; source: string; source_key: string; status: string; dispatched_at: string; address: string; city: string | null;
  lat: number | null; lon: number | null; formatted_address: string | null; geocode_status: string; geocode_attempts: number;
  call_code: string; call_description: string; category: string; severity: string; alertable: number; is_upgrade: number;
  box: string | null; station: string | null; battalion: string | null; units: string;
  first_seen_at: string; last_seen_at: string; cleared_at: string | null; updated_at: string; version: number; dirty: number;
}

type DeviceRow = {
  id: string; user_id: string; expo_push_token: string; platform: string; app_version: string; device_name: string | null;
  push_enabled: number; critical_alerts_authorized: number; disabled_reason: string | null; created_at: string; last_seen_at: string;
  lat: number | null; lon: number | null; accuracy_m: number | null; speed_mps: number | null; recorded_at: string | null; dirty: number;
}

type AlertRow = {
  id: string; kind: string; incident_id: string | null; device_id: string; user_id: string; distance_m: number | null; matched_by: string | null;
  sent_at: string; expo_ticket_id: string | null; receipt_status: string; receipt_error: string | null; payload: string | null; dirty: number;
}

type EventRow = { id: string; incident_id: string; kind: string; at: string; data: string; flushed: number }
type MemberRow = { user_id: string; email: string; role: string; status: string; synced_at: string }
type PrefsRow = { user_id: string; json: string; updated_at: string }
type ApiKeyRow = { key_hash: string; id: string; name: string; scopes: string; revoked: number; checked_at: string }
type RuleRow = { code: string; description: string; category: string; severity: string; alertable: number; is_upgrade: number }

const bool = (v: number | null | undefined): boolean => v === 1;
const int = (v: boolean): number => (v ? 1 : 0);

function rowToIncident(r: IncidentRow): IncidentRecord {
  return {
    id: r.id, source: r.source, sourceKey: r.source_key, status: r.status as IncidentRecord['status'], dispatchedAt: r.dispatched_at,
    address: r.address, city: r.city, lat: r.lat, lon: r.lon, formattedAddress: r.formatted_address,
    geocodeStatus: r.geocode_status as IncidentRecord['geocodeStatus'], geocodeAttempts: r.geocode_attempts,
    callCode: r.call_code, callDescription: r.call_description, category: r.category as IncidentCategory, severity: r.severity as Severity,
    alertable: bool(r.alertable), isUpgrade: bool(r.is_upgrade), box: r.box, station: r.station, battalion: r.battalion,
    units: JSON.parse(r.units) as string[], firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, clearedAt: r.cleared_at,
    updatedAt: r.updated_at, version: r.version,
  };
}

function rowToDevice(r: DeviceRow): DeviceRecord {
  return {
    id: r.id, userId: r.user_id, expoPushToken: r.expo_push_token, platform: r.platform as DeviceRecord['platform'], appVersion: r.app_version,
    deviceName: r.device_name, pushEnabled: bool(r.push_enabled), criticalAlertsAuthorized: bool(r.critical_alerts_authorized),
    disabledReason: r.disabled_reason, createdAt: r.created_at, lastSeenAt: r.last_seen_at, lat: r.lat, lon: r.lon,
    accuracyM: r.accuracy_m, speedMps: r.speed_mps, recordedAt: r.recorded_at,
  };
}

function rowToAlert(r: AlertRow): AlertRecord {
  return {
    id: r.id, kind: r.kind as AlertRecord['kind'], incidentId: r.incident_id, deviceId: r.device_id, userId: r.user_id, distanceM: r.distance_m,
    matchedBy: r.matched_by as AlertRecord['matchedBy'], sentAt: r.sent_at, expoTicketId: r.expo_ticket_id,
    receiptStatus: r.receipt_status as AlertRecord['receiptStatus'], receiptError: r.receipt_error,
    payload: r.payload ? (JSON.parse(r.payload) as JsonValue) : null,
  };
}

function rowToEvent(r: EventRow): IncidentEventRecord {
  return { id: r.id, incidentId: r.incident_id, kind: r.kind as IncidentEventRecord['kind'], at: r.at, data: JSON.parse(r.data) as JsonObject };
}

function rowToMember(r: MemberRow): MemberRecord {
  return { userId: r.user_id, email: r.email, role: r.role as MemberRecord['role'], status: r.status as MemberRecord['status'], syncedAt: r.synced_at };
}

function rowToPrefs(r: PrefsRow): PrefsRecord {
  return { ...(JSON.parse(r.json) as Omit<PrefsRecord, 'userId' | 'updatedAt'>), userId: r.user_id, updatedAt: r.updated_at };
}

function toPush(i: IncidentRecord): IncidentForPush {
  return {
    id: i.id, address: i.address, city: i.city, callCode: i.callCode, callDescription: i.callDescription, category: i.category,
    severity: i.severity, box: i.box, units: i.units, lat: i.lat, lon: i.lon,
  };
}

// ---------------------------------------------------------------------------
// Public result shapes (structured-cloneable)
// ---------------------------------------------------------------------------

export interface IngestResult { rows: number; created: number; updated: number; reopened: number; cleared: number; alertsQueued: number }
export interface DispatchResult { candidates: number; sent: number; skipped: number; errors: number }
export interface BoardStatus {
  lastPushAt: string | null; lastPushTs: number | null; lastRowCount: number | null; lastFlushAt: string | null; lastFlushError: string | null;
  activeIncidents: number; pending: { incidents: number; events: number; devices: number; alerts: number }; alarmAt: string | null;
}
export interface DeviceInput {
  userId: string; expoPushToken: string; platform: 'ios' | 'android'; appVersion: string; deviceName?: string | null; criticalAlertsAuthorized?: boolean;
}
export interface LocationInput { lat: number; lon: number; accuracyM?: number | null; speedMps?: number | null; recordedAt: string }
export interface ApiKeyCache { id: string; name: string; scopes: string[]; revoked: boolean; checkedAt: string }
export interface AlertWithIncident extends AlertRecord {
  incident: { id: string; callCode: string; callDescription: string; address: string; city: string | null; category: string; severity: string; status: string; dispatchedAt: string } | null;
}
export interface TestAlertResult { ok: boolean; ticketId?: string; error?: string; details?: string | null; critical: boolean }
export interface SimulationInput { lat: number; lon: number; address: string; city: string; code: string; description: string; box: string; units: string[]; by: string }

const MAX_GEOCODES_PER_PUSH = 6;
const MEMBER_TTL_MS = 24 * 3600 * 1000;
const API_KEY_TTL_MS = 10 * 60 * 1000;
const STALE_INCIDENT_MS = 6 * 3600 * 1000;
const SIMULATION_TTL_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export class BoardState extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      for (const stmt of BOARD_SCHEMA.split(';')) if (stmt.trim()) this.sql.exec(stmt);
      await this.armAlarm(false);
    });
  }

  // -------------------------------------------------------------------------
  // Ingest
  // -------------------------------------------------------------------------

  async ingest(html: string, feedTs: number | null): Promise<IngestResult> {
    const rows = parseFsasTable(html);
    const rules = await this.rules();
    const now = new Date();
    const nowIso = now.toISOString();
    const source = this.env.FEED_SOURCE;
    const recent = new Date(now.getTime() - DAY_MS).toISOString();
    const previous = this.sql
      .exec<IncidentRow>(`SELECT * FROM incidents WHERE source = ? AND (status = 'active' OR updated_at > ?)`, source, recent)
      .toArray()
      .map(rowToIncident);
    const diff = diffBoard(previous, rows, {
      source, rules, tz: this.env.FEED_TIMEZONE, now, clearGraceSeconds: intVar(this.env.CLEAR_GRACE_SECONDS, 20), newId: () => crypto.randomUUID(),
    });

    this.ctx.storage.transactionSync(() => {
      for (const rec of [...diff.inserts, ...diff.updates, ...diff.cleared]) this.writeIncident(rec, true);
      for (const id of diff.touched) this.sql.exec(`UPDATE incidents SET last_seen_at = ? WHERE id = ?`, nowIso, id);
      for (const e of diff.events) this.writeEvent(e.incidentId, e.kind, e.data, nowIso);
      this.setMeta('last_push_at', nowIso);
      this.setMeta('last_push_ts', feedTs == null ? null : String(feedTs));
      this.setMeta('last_row_count', String(rows.length));
    });

    const reopened = diff.events.filter((e) => e.kind === 'reopened').length;
    const result: IngestResult = {
      rows: rows.length, created: diff.inserts.length, updated: diff.updates.length, reopened, cleared: diff.cleared.length, alertsQueued: diff.alerts.length,
    };
    this.ctx.waitUntil(this.postProcess(diff.geocode, diff.alerts));
    return result;
  }

  /** Geocode what needs it (alertable calls only), then page. Runs after the station's request has been answered. */
  private async postProcess(toGeocode: IncidentRecord[], intents: AlertIntent[]): Promise<void> {
    const seen = new Set<string>();
    for (const rec of toGeocode) {
      if (seen.size >= MAX_GEOCODES_PER_PUSH || seen.has(rec.id)) continue;
      seen.add(rec.id);
      try {
        await this.geocodeIncident(rec.id);
      } catch (err) {
        console.error('geocode failed', rec.id, (err as Error).message);
      }
    }
    const done = new Set<string>();
    for (const intent of intents) {
      const key = `${intent.incident.id}:${intent.kind}`;
      if (done.has(key)) continue;
      done.add(key);
      const current = this.readIncident(intent.incident.id);
      if (!current || current.lat == null || current.lon == null || !current.alertable) continue;
      try {
        const r = await this.dispatch(current, intent.kind);
        if (r.candidates) console.log(`alerts ${intent.kind} ${current.callCode} @ ${current.address}: ${r.sent} sent, ${r.skipped} skipped, ${r.errors} errors`);
      } catch (err) {
        console.error('dispatch failed', current.id, (err as Error).message);
      }
    }
  }

  /** Cache-first Google geocode; persists the outcome and a `geocoded` event. Returns the refreshed record. */
  async geocodeIncident(id: string): Promise<IncidentRecord | null> {
    const rec = this.readIncident(id);
    if (!rec) return null;
    if (rec.lat != null && rec.lon != null) return rec;
    const g = await geocodeAddress(this.env, this.geocodeCache(), rec.address, rec.city);
    const nowIso = new Date().toISOString();
    if (g.status === 'ok') {
      const next: IncidentRecord = { ...rec, lat: g.lat, lon: g.lon, formattedAddress: g.formattedAddress, geocodeStatus: 'ok', geocodeAttempts: rec.geocodeAttempts + 1, updatedAt: nowIso, version: rec.version + 1 };
      this.ctx.storage.transactionSync(() => {
        this.writeIncident(next, true);
        this.writeEvent(id, 'geocoded', { lat: g.lat, lon: g.lon, formattedAddress: g.formattedAddress }, nowIso);
      });
      return next;
    }
    const status = g.status === 'failed' ? 'failed' : rec.geocodeStatus;
    const next: IncidentRecord = { ...rec, geocodeStatus: status, geocodeAttempts: rec.geocodeAttempts + 1 };
    this.sql.exec(`UPDATE incidents SET geocode_status = ?, geocode_attempts = ?, dirty = CASE WHEN ? THEN 1 ELSE dirty END WHERE id = ?`, status, next.geocodeAttempts, int(status !== rec.geocodeStatus), id);
    return next;
  }

  // -------------------------------------------------------------------------
  // Alerts
  // -------------------------------------------------------------------------

  private candidates(): Candidate[] {
    const rows = this.sql
      .exec<DeviceRow & { prefs_json: string | null; prefs_updated: string | null; m_email: string | null; m_role: string | null; m_status: string | null; m_synced: string | null }>(
        `SELECT d.*, p.json AS prefs_json, p.updated_at AS prefs_updated, m.email AS m_email, m.role AS m_role, m.status AS m_status, m.synced_at AS m_synced
         FROM devices d LEFT JOIN prefs p ON p.user_id = d.user_id LEFT JOIN members m ON m.user_id = d.user_id
         WHERE d.push_enabled = 1`,
      )
      .toArray();
    return rows.map((r) => ({
      device: rowToDevice(r),
      prefs: r.prefs_json
        ? rowToPrefs({ user_id: r.user_id, json: r.prefs_json, updated_at: r.prefs_updated ?? r.last_seen_at })
        : { ...DEFAULT_ALERT_PREFERENCES, userId: r.user_id, updatedAt: r.last_seen_at },
      member: r.m_status ? { userId: r.user_id, email: r.m_email ?? '', role: r.m_role as MemberRecord['role'], status: r.m_status as MemberRecord['status'], syncedAt: r.m_synced ?? '' } : null,
    }));
  }

  /** Page every matching device exactly once for (incident, kind). */
  private async dispatch(incident: IncidentRecord, kind: 'dispatch' | 'upgrade'): Promise<DispatchResult> {
    const result: DispatchResult = { candidates: 0, sent: 0, skipped: 0, errors: 0 };
    const candidates = this.candidates();
    result.candidates = candidates.length;
    if (!candidates.length) return result;
    const now = new Date();
    const matches = matchDevices(incident, candidates, { now, tz: this.env.FEED_TIMEZONE, kind });
    result.skipped = candidates.length - matches.length;
    const pushIncident = toPush(incident);
    const queued: Array<{ alertId: string; deviceId: string; message: ExpoMessage }> = [];
    for (const m of matches) {
      const message = buildIncidentMessage(this.env, {
        to: m.device.expoPushToken, incident: pushIncident, kind, distanceM: m.distanceM, deviceCriticalAuthorized: m.device.criticalAlertsAuthorized,
      });
      const alertId = crypto.randomUUID();
      const cur = this.sql.exec(
        `INSERT OR IGNORE INTO alerts (id, kind, incident_id, device_id, user_id, distance_m, matched_by, sent_at, receipt_status, payload, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1)`,
        alertId, kind, incident.id, m.device.id, m.device.userId, m.distanceM, m.matchedBy, now.toISOString(),
        JSON.stringify({ title: message.title, body: message.body, data: message.data }),
      );
      if (cur.rowsWritten === 0) {
        result.skipped++;
        continue;
      }
      queued.push({ alertId, deviceId: m.device.id, message });
    }
    if (!queued.length) return result;
    const tickets = await sendExpoPush(this.env, queued.map((q) => q.message));
    this.ctx.storage.transactionSync(() => {
      queued.forEach((q, i) => {
        const t = tickets[i];
        if (t?.status === 'ok' && t.id) {
          this.sql.exec(`UPDATE alerts SET expo_ticket_id = ?, dirty = 1 WHERE id = ?`, t.id, q.alertId);
          result.sent++;
        } else {
          const code = t?.details?.error ?? 'ticket';
          this.sql.exec(`UPDATE alerts SET receipt_status = 'error', receipt_error = ?, dirty = 1 WHERE id = ?`, `${code}: ${t?.message ?? 'unknown'}`, q.alertId);
          if (code === 'DeviceNotRegistered') this.disableDevice(q.deviceId, code);
          result.errors++;
        }
      });
    });
    return result;
  }

  private disableDevice(id: string, reason: string): void {
    this.sql.exec(`UPDATE devices SET push_enabled = 0, disabled_reason = ?, dirty = 1 WHERE id = ?`, reason, id);
  }

  async sendTestAlert(deviceId: string, userId: string): Promise<TestAlertResult> {
    const row = this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE id = ? AND user_id = ?`, deviceId, userId).toArray()[0];
    if (!row) return { ok: false, error: 'device not found', critical: false };
    const device = rowToDevice(row);
    const message = buildTestMessage(this.env, device.expoPushToken, device.criticalAlertsAuthorized);
    const [ticket] = await sendExpoPush(this.env, [message]);
    const ok = ticket?.status === 'ok' && Boolean(ticket.id);
    this.sql.exec(
      `INSERT INTO alerts (id, kind, incident_id, device_id, user_id, distance_m, matched_by, sent_at, expo_ticket_id, receipt_status, receipt_error, payload, dirty)
       VALUES (?, 'test', NULL, ?, ?, NULL, 'test', ?, ?, ?, ?, ?, 1)`,
      crypto.randomUUID(), device.id, userId, new Date().toISOString(), ticket?.id ?? null, ok ? 'pending' : 'error',
      ok ? null : `${ticket?.details?.error ?? 'ticket'}: ${ticket?.message ?? 'unknown'}`, JSON.stringify({ title: message.title, body: message.body }),
    );
    const critical = typeof message.sound === 'object';
    return ok ? { ok: true, ticketId: ticket!.id, critical } : { ok: false, error: ticket?.message ?? 'push rejected', details: ticket?.details ? JSON.stringify(ticket.details) : null, critical };
  }

  /** Admin drill: a synthetic incident at a point, run through the real matcher. */
  async simulate(input: SimulationInput): Promise<{ incident: IncidentRecord; alerts: DispatchResult }> {
    const rules = await this.rules();
    const cls = classify(input.code, rules);
    const nowIso = new Date().toISOString();
    const rec: IncidentRecord = {
      id: crypto.randomUUID(), source: 'simulation', sourceKey: `sim-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, status: 'active', dispatchedAt: nowIso,
      address: input.address.toUpperCase(), city: input.city, lat: input.lat, lon: input.lon, formattedAddress: input.address, geocodeStatus: 'ok', geocodeAttempts: 1,
      callCode: input.code.toUpperCase(), callDescription: input.description, category: cls.category, severity: cls.severity, alertable: true, isUpgrade: cls.isUpgrade,
      box: input.box, station: input.box.slice(0, 2), battalion: null, units: input.units, firstSeenAt: nowIso, lastSeenAt: nowIso, clearedAt: null, updatedAt: nowIso, version: 0,
    };
    this.ctx.storage.transactionSync(() => {
      this.writeIncident(rec, true);
      this.writeEvent(rec.id, 'created', { simulatedBy: input.by }, nowIso);
    });
    const alerts = await this.dispatch(rec, 'dispatch');
    return { incident: rec, alerts };
  }

  // -------------------------------------------------------------------------
  // Feed reads
  // -------------------------------------------------------------------------

  status(): BoardStatus {
    const active = this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM incidents WHERE status = 'active' AND source = ?`, this.env.FEED_SOURCE).one().n;
    const pending = {
      incidents: this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM incidents WHERE dirty = 1`).one().n,
      events: this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM incident_events WHERE flushed = 0`).one().n,
      devices: this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM devices WHERE dirty = 1`).one().n,
      alerts: this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM alerts WHERE dirty = 1`).one().n,
    };
    const ts = this.getMeta('last_push_ts');
    return {
      lastPushAt: this.getMeta('last_push_at'), lastPushTs: ts == null ? null : Number(ts), lastRowCount: Number(this.getMeta('last_row_count') ?? 'NaN') || null,
      lastFlushAt: this.getMeta('last_flush_at'), lastFlushError: this.getMeta('last_flush_error'), activeIncidents: active, pending, alarmAt: this.getMeta('alarm_at'),
    };
  }

  listIncidents(o: { status: 'active' | 'cleared' | 'all'; since: string | null; limit: number; includeSimulated: boolean }): IncidentRecord[] {
    return this.sql
      .exec<IncidentRow>(
        `SELECT * FROM incidents
         WHERE (? = 1 OR source <> 'simulation')
           AND (? IS NULL OR updated_at > ?)
           AND (? IS NOT NULL OR ? = 'all' OR status = ?)
         ORDER BY dispatched_at DESC LIMIT ?`,
        int(o.includeSimulated), o.since, o.since, o.since, o.status, o.status, o.limit,
      )
      .toArray()
      .map(rowToIncident);
  }

  getIncident(id: string): { incident: IncidentRecord; events: IncidentEventRecord[] } | null {
    const incident = this.readIncident(id);
    if (!incident) return null;
    const events = this.sql.exec<EventRow>(`SELECT * FROM incident_events WHERE incident_id = ? ORDER BY at`, id).toArray().map(rowToEvent);
    return { incident, events };
  }

  private readIncident(id: string): IncidentRecord | null {
    const row = this.sql.exec<IncidentRow>(`SELECT * FROM incidents WHERE id = ?`, id).toArray()[0];
    return row ? rowToIncident(row) : null;
  }

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  upsertDevice(d: DeviceInput): DeviceRecord {
    const nowIso = new Date().toISOString();
    const existing = this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE expo_push_token = ?`, d.expoPushToken).toArray()[0];
    if (existing) {
      this.sql.exec(
        `UPDATE devices SET user_id = ?, platform = ?, app_version = ?, device_name = COALESCE(?, device_name), critical_alerts_authorized = ?,
           push_enabled = 1, disabled_reason = NULL, last_seen_at = ?, dirty = 1 WHERE id = ?`,
        d.userId, d.platform, d.appVersion, d.deviceName ?? null, int(d.criticalAlertsAuthorized ?? false), nowIso, existing.id,
      );
      return rowToDevice(this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE id = ?`, existing.id).one());
    }
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO devices (id, user_id, expo_push_token, platform, app_version, device_name, push_enabled, critical_alerts_authorized, disabled_reason, created_at, last_seen_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, 1)`,
      id, d.userId, d.expoPushToken, d.platform, d.appVersion, d.deviceName ?? null, int(d.criticalAlertsAuthorized ?? false), nowIso, nowIso,
    );
    return rowToDevice(this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE id = ?`, id).one());
  }

  listDevices(userId: string): DeviceRecord[] {
    return this.sql
      .exec<DeviceRow>(`SELECT * FROM devices WHERE user_id = ? AND (disabled_reason IS NULL OR disabled_reason <> 'deleted') ORDER BY last_seen_at DESC`, userId)
      .toArray()
      .map(rowToDevice);
  }

  updateLocation(deviceId: string, userId: string, l: LocationInput): boolean {
    const nowIso = new Date().toISOString();
    const cur = this.sql.exec(
      `UPDATE devices SET lat = ?, lon = ?, accuracy_m = ?, speed_mps = ?, recorded_at = ?, last_seen_at = ?, dirty = 1
       WHERE id = ? AND user_id = ? AND (recorded_at IS NULL OR recorded_at <= ?)`,
      l.lat, l.lon, l.accuracyM ?? null, l.speedMps ?? null, l.recordedAt, nowIso, deviceId, userId, l.recordedAt,
    );
    if (cur.rowsWritten > 0) return true;
    return this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM devices WHERE id = ? AND user_id = ?`, deviceId, userId).one().n > 0;
  }

  deleteDevice(deviceId: string, userId: string): boolean {
    const cur = this.sql.exec(`UPDATE devices SET push_enabled = 0, disabled_reason = 'deleted', dirty = 1 WHERE id = ? AND user_id = ?`, deviceId, userId);
    return cur.rowsWritten > 0;
  }

  listAlerts(userId: string, limit: number): AlertWithIncident[] {
    return this.sql
      .exec<AlertRow & { i_id: string | null; i_code: string | null; i_desc: string | null; i_address: string | null; i_city: string | null; i_category: string | null; i_severity: string | null; i_status: string | null; i_dispatched: string | null }>(
        `SELECT a.*, i.id AS i_id, i.call_code AS i_code, i.call_description AS i_desc, i.address AS i_address, i.city AS i_city, i.category AS i_category,
                i.severity AS i_severity, i.status AS i_status, i.dispatched_at AS i_dispatched
         FROM alerts a LEFT JOIN incidents i ON i.id = a.incident_id WHERE a.user_id = ? ORDER BY a.sent_at DESC LIMIT ?`,
        userId, limit,
      )
      .toArray()
      .map((r) => ({
        ...rowToAlert(r),
        incident: r.i_id
          ? { id: r.i_id, callCode: r.i_code!, callDescription: r.i_desc!, address: r.i_address!, city: r.i_city, category: r.i_category!, severity: r.i_severity!, status: r.i_status!, dispatchedAt: r.i_dispatched! }
          : null,
      }));
  }

  // -------------------------------------------------------------------------
  // Mirrors of Postgres state used on the hot path
  // -------------------------------------------------------------------------

  getPrefs(userId: string): PrefsRecord | null {
    const row = this.sql.exec<PrefsRow>(`SELECT * FROM prefs WHERE user_id = ?`, userId).toArray()[0];
    return row ? rowToPrefs(row) : null;
  }

  setPrefs(p: PrefsRecord): void {
    const { userId, updatedAt, ...rest } = p;
    this.sql.exec(`INSERT INTO prefs (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`, userId, JSON.stringify(rest), updatedAt);
  }

  getMember(userId: string): MemberRecord | null {
    const row = this.sql.exec<MemberRow>(`SELECT * FROM members WHERE user_id = ?`, userId).toArray()[0];
    if (!row) return null;
    if (Date.now() - new Date(row.synced_at).getTime() > MEMBER_TTL_MS) return null;
    return rowToMember(row);
  }

  setMember(m: MemberRecord): void {
    this.sql.exec(
      `INSERT INTO members (user_id, email, role, status, synced_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, role = excluded.role, status = excluded.status, synced_at = excluded.synced_at`,
      m.userId, m.email, m.role, m.status, m.syncedAt,
    );
  }

  /** Drop the cached membership for an email so the next request re-reads Postgres (admin edits). */
  invalidateMemberByEmail(email: string): void {
    this.sql.exec(`DELETE FROM members WHERE email = ?`, email.toLowerCase());
  }

  getApiKey(hash: string): ApiKeyCache | null {
    const row = this.sql.exec<ApiKeyRow>(`SELECT * FROM api_keys WHERE key_hash = ?`, hash).toArray()[0];
    if (!row) return null;
    if (Date.now() - new Date(row.checked_at).getTime() > API_KEY_TTL_MS) return null;
    return { id: row.id, name: row.name, scopes: JSON.parse(row.scopes) as string[], revoked: bool(row.revoked), checkedAt: row.checked_at };
  }

  setApiKey(hash: string, k: Omit<ApiKeyCache, 'checkedAt'>): void {
    this.sql.exec(
      `INSERT INTO api_keys (key_hash, id, name, scopes, revoked, checked_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (key_hash) DO UPDATE SET id = excluded.id, name = excluded.name, scopes = excluded.scopes, revoked = excluded.revoked, checked_at = excluded.checked_at`,
      hash, k.id, k.name, JSON.stringify(k.scopes), int(k.revoked), new Date().toISOString(),
    );
  }

  revokeApiKey(id: string): void {
    this.sql.exec(`UPDATE api_keys SET revoked = 1 WHERE id = ?`, id);
  }

  setRules(rules: Rule[]): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM rules`);
      for (const r of rules) {
        this.sql.exec(`INSERT INTO rules (code, description, category, severity, alertable, is_upgrade) VALUES (?, ?, ?, ?, ?, ?)`, r.code, r.description, r.category, r.severity, int(r.alertable), int(r.isUpgrade));
      }
    });
  }

  getRules(): Rule[] {
    const rows = this.sql.exec<RuleRow>(`SELECT * FROM rules ORDER BY category, severity DESC, code`).toArray();
    if (!rows.length) return [...DEFAULT_RULES.values()];
    return rows.map((r) => ({ code: r.code, description: r.description, category: r.category as IncidentCategory, severity: r.severity as Severity, alertable: bool(r.alertable), isUpgrade: bool(r.is_upgrade) }));
  }

  private async rules(): Promise<RuleMap> {
    const rows = this.getRules();
    return new Map(rows.map((r) => [r.code, r]));
  }

  // -------------------------------------------------------------------------
  // Alarm: flush to Neon, receipts, housekeeping
  // -------------------------------------------------------------------------

  async alarm(): Promise<void> {
    try {
      await this.flush();
    } catch (err) {
      console.error('flush failed', (err as Error).message);
      this.setMeta('last_flush_error', `${new Date().toISOString()} ${(err as Error).message}`);
    }
    try {
      await this.checkReceipts();
    } catch (err) {
      console.error('receipts failed', (err as Error).message);
    }
    try {
      this.housekeeping();
    } catch (err) {
      console.error('housekeeping failed', (err as Error).message);
    }
    await this.armAlarm(true);
  }

  /** Arms the alarm if none is pending (or unconditionally when `force`). Returns the status for logs. */
  async ensureAlarm(): Promise<BoardStatus> {
    await this.armAlarm(false);
    return this.status();
  }

  private async armAlarm(force: boolean): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing != null && !force) return;
    const at = Date.now() + intVar(this.env.FLUSH_INTERVAL_MINUTES, 30) * 60_000;
    await this.ctx.storage.setAlarm(at);
    this.setMeta('alarm_at', new Date(at).toISOString());
  }

  async flush(): Promise<{ incidents: number; events: number; devices: number; alerts: number }> {
    const incidentRows = this.sql.exec<IncidentRow>(`SELECT * FROM incidents WHERE dirty = 1 ORDER BY updated_at LIMIT 500`).toArray();
    const eventRows = this.sql.exec<EventRow>(`SELECT * FROM incident_events WHERE flushed = 0 ORDER BY at LIMIT 1000`).toArray();
    const deviceRows = this.sql.exec<DeviceRow>(`SELECT * FROM devices WHERE dirty = 1`).toArray();
    const alertRows = this.sql.exec<AlertRow>(`SELECT * FROM alerts WHERE dirty = 1 ORDER BY sent_at LIMIT 500`).toArray();
    const batch: FlushBatch = {
      incidents: incidentRows.map(rowToIncident), events: eventRows.map(rowToEvent), devices: deviceRows.map(rowToDevice), alerts: alertRows.map(rowToAlert),
    };
    const counts = { incidents: batch.incidents.length, events: batch.events.length, devices: batch.devices.length, alerts: batch.alerts.length };
    if (isEmptyBatch(batch)) return counts;
    if (!this.env.DATABASE_URL) {
      console.warn('flush skipped: DATABASE_URL not configured');
      return counts;
    }
    await flushToNeon(this.env, batch);
    this.ctx.storage.transactionSync(() => {
      for (const r of incidentRows) this.sql.exec(`UPDATE incidents SET dirty = 0 WHERE id = ? AND version = ?`, r.id, r.version);
      for (const r of eventRows) this.sql.exec(`UPDATE incident_events SET flushed = 1 WHERE id = ?`, r.id);
      for (const r of deviceRows) this.sql.exec(`UPDATE devices SET dirty = 0 WHERE id = ? AND last_seen_at = ?`, r.id, r.last_seen_at);
      for (const r of alertRows) this.sql.exec(`UPDATE alerts SET dirty = 0 WHERE id = ? AND receipt_status = ? AND expo_ticket_id IS ?`, r.id, r.receipt_status, r.expo_ticket_id);
      this.setMeta('last_flush_at', new Date().toISOString());
      this.setMeta('last_flush_error', null);
    });
    return counts;
  }

  private async checkReceipts(): Promise<void> {
    const now = Date.now();
    const pending = this.sql
      .exec<{ id: string; expo_ticket_id: string; device_id: string }>(
        `SELECT id, expo_ticket_id, device_id FROM alerts WHERE receipt_status = 'pending' AND expo_ticket_id IS NOT NULL AND sent_at BETWEEN ? AND ? LIMIT 1000`,
        new Date(now - DAY_MS).toISOString(), new Date(now - 15 * 60_000).toISOString(),
      )
      .toArray();
    if (!pending.length) return;
    const receipts = await getExpoReceipts(this.env, pending.map((p) => p.expo_ticket_id));
    this.ctx.storage.transactionSync(() => {
      for (const p of pending) {
        const r = receipts[p.expo_ticket_id];
        if (!r) continue;
        if (r.status === 'ok') {
          this.sql.exec(`UPDATE alerts SET receipt_status = 'ok', dirty = 1 WHERE id = ?`, p.id);
        } else {
          const code = r.details?.error ?? 'error';
          this.sql.exec(`UPDATE alerts SET receipt_status = 'error', receipt_error = ?, dirty = 1 WHERE id = ?`, `${code}: ${r.message ?? ''}`, p.id);
          if (code === 'DeviceNotRegistered') this.disableDevice(p.device_id, code);
        }
      }
    });
  }

  private housekeeping(): void {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    this.ctx.storage.transactionSync(() => {
      // Safety net: an incident unseen for 6 h is closed even if the feed died mid-incident.
      const stale = this.sql.exec<IncidentRow>(`SELECT * FROM incidents WHERE status = 'active' AND source = ? AND last_seen_at < ?`, this.env.FEED_SOURCE, new Date(now - STALE_INCIDENT_MS).toISOString()).toArray();
      for (const r of stale) {
        const rec = rowToIncident(r);
        this.writeIncident({ ...rec, status: 'cleared', clearedAt: nowIso, updatedAt: nowIso, version: rec.version + 1 }, true);
        this.writeEvent(rec.id, 'cleared', { reason: 'stale' }, nowIso);
      }
      const sims = this.sql.exec<IncidentRow>(`SELECT * FROM incidents WHERE status = 'active' AND source = 'simulation' AND first_seen_at < ?`, new Date(now - SIMULATION_TTL_MS).toISOString()).toArray();
      for (const r of sims) {
        const rec = rowToIncident(r);
        this.writeIncident({ ...rec, status: 'cleared', clearedAt: nowIso, updatedAt: nowIso, version: rec.version + 1 }, true);
        this.writeEvent(rec.id, 'cleared', { reason: 'simulation' }, nowIso);
      }
      // Prune flushed history; Postgres keeps the long-term record.
      const weekAgo = new Date(now - 7 * DAY_MS).toISOString();
      this.sql.exec(`DELETE FROM incident_events WHERE flushed = 1 AND at < ?`, weekAgo);
      this.sql.exec(`DELETE FROM incidents WHERE status = 'cleared' AND dirty = 0 AND updated_at < ? AND id NOT IN (SELECT incident_id FROM incident_events WHERE flushed = 0)`, weekAgo);
      this.sql.exec(`DELETE FROM alerts WHERE dirty = 0 AND sent_at < ?`, new Date(now - 30 * DAY_MS).toISOString());
      this.sql.exec(`DELETE FROM devices WHERE disabled_reason = 'deleted' AND dirty = 0`);
      this.sql.exec(`DELETE FROM geocode_cache WHERE created_at < ?`, new Date(now - 90 * DAY_MS).toISOString());
      this.sql.exec(`DELETE FROM api_keys WHERE checked_at < ?`, new Date(now - DAY_MS).toISOString());
    });
  }

  // -------------------------------------------------------------------------
  // Storage helpers
  // -------------------------------------------------------------------------

  private writeIncident(i: IncidentRecord, dirty: boolean): void {
    this.sql.exec(
      `INSERT INTO incidents (id, source, source_key, status, dispatched_at, address, city, lat, lon, formatted_address, geocode_status, geocode_attempts,
         call_code, call_description, category, severity, alertable, is_upgrade, box, station, battalion, units,
         first_seen_at, last_seen_at, cleared_at, updated_at, version, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         status = excluded.status, lat = excluded.lat, lon = excluded.lon, formatted_address = excluded.formatted_address,
         geocode_status = excluded.geocode_status, geocode_attempts = excluded.geocode_attempts, call_code = excluded.call_code,
         call_description = excluded.call_description, category = excluded.category, severity = excluded.severity, alertable = excluded.alertable,
         is_upgrade = excluded.is_upgrade, units = excluded.units, last_seen_at = excluded.last_seen_at, cleared_at = excluded.cleared_at,
         updated_at = excluded.updated_at, version = excluded.version, dirty = excluded.dirty`,
      i.id, i.source, i.sourceKey, i.status, i.dispatchedAt, i.address, i.city, i.lat, i.lon, i.formattedAddress, i.geocodeStatus, i.geocodeAttempts,
      i.callCode, i.callDescription, i.category, i.severity, int(i.alertable), int(i.isUpgrade), i.box, i.station, i.battalion, JSON.stringify(i.units),
      i.firstSeenAt, i.lastSeenAt, i.clearedAt, i.updatedAt, i.version, int(dirty),
    );
  }

  private writeEvent(incidentId: string, kind: string, data: Record<string, unknown>, at: string): void {
    this.sql.exec(`INSERT INTO incident_events (id, incident_id, kind, at, data, flushed) VALUES (?, ?, ?, ?, ?, 0)`, crypto.randomUUID(), incidentId, kind, at, JSON.stringify(data));
  }

  private getMeta(key: string): string | null {
    const row = this.sql.exec<{ value: string | null }>(`SELECT value FROM meta WHERE key = ?`, key).toArray()[0];
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string | null): void {
    this.sql.exec(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value);
  }

  private geocodeCache(): GeocodeCache {
    return {
      get: (key): GeocodeCacheEntry | null => {
        const r = this.sql.exec<{ lat: number | null; lon: number | null; formatted_address: string | null; status: string; created_at: string }>(`SELECT * FROM geocode_cache WHERE query_key = ?`, key).toArray()[0];
        return r ? { lat: r.lat, lon: r.lon, formattedAddress: r.formatted_address, status: r.status as GeocodeCacheEntry['status'], createdAt: r.created_at } : null;
      },
      set: (key, e): void => {
        this.sql.exec(
          `INSERT INTO geocode_cache (query_key, lat, lon, formatted_address, status, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (query_key) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, formatted_address = excluded.formatted_address, status = excluded.status, created_at = excluded.created_at`,
          key, e.lat, e.lon, e.formattedAddress, e.status, e.createdAt,
        );
      },
    };
  }
}

