/**
 * Pure board diff: previous incident records vs. freshly parsed FSAS rows.
 * No I/O here so it is trivially testable; the Durable Object applies the result.
 */
import { SEVERITY_RANK } from '@barleschailey/feed';
import { parseFsasTimestamp } from '../lib/time';
import { battalionForStation, cityForBox, classify, stationForBox, type RuleMap } from './classify';
import { sourceKey, type FsasRow } from './parse-fsas';
import type { IncidentEventKind, IncidentRecord } from './types';

export interface PendingEvent {
  incidentId: string;
  kind: IncidentEventKind;
  data: Record<string, unknown>;
}

export interface AlertIntent {
  incident: IncidentRecord;
  kind: 'dispatch' | 'upgrade';
}

export interface DiffResult {
  inserts: IncidentRecord[];
  updates: IncidentRecord[];
  /** Unchanged incidents that were seen again (bump lastSeenAt only). */
  touched: string[];
  cleared: IncidentRecord[];
  events: PendingEvent[];
  alerts: AlertIntent[];
  /** Incidents that still need a geocode (alertable ones only; the rest are geocoded lazily). */
  geocode: IncidentRecord[];
}

export interface DiffOptions {
  source: string;
  rules: RuleMap;
  tz: string;
  now: Date;
  /** Seconds an incident may be absent from a push before it is considered cleared. */
  clearGraceSeconds: number;
  newId: () => string;
}

export function unitsDelta(prev: string[], next: string[]): { added: string[]; removed: string[]; changed: boolean } {
  const a = new Set(prev), b = new Set(next);
  const added = [...b].filter((u) => !a.has(u)).sort();
  const removed = [...a].filter((u) => !b.has(u)).sort();
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

/** Alertable incidents whose geocode is still pending are retried on a few subsequent pushes. */
export const MAX_GEOCODE_ATTEMPTS = 3;

export function diffBoard(previous: IncidentRecord[], rows: FsasRow[], o: DiffOptions): DiffResult {
  const nowIso = o.now.toISOString();
  const prevByKey = new Map(previous.map((r) => [r.sourceKey, r]));
  const keyed = new Map<string, FsasRow>();
  for (const r of rows) {
    const k = sourceKey(r);
    if (!keyed.has(k)) keyed.set(k, r);
  }
  const out: DiffResult = { inserts: [], updates: [], touched: [], cleared: [], events: [], alerts: [], geocode: [] };

  for (const [key, row] of keyed) {
    const prev = prevByKey.get(key);
    const cls = classify(row.code, o.rules);
    if (!prev) {
      const station = stationForBox(row.box);
      const rec: IncidentRecord = {
        id: o.newId(),
        source: o.source,
        sourceKey: key,
        status: 'active',
        dispatchedAt: (parseFsasTimestamp(row.time, o.tz, o.now) ?? o.now).toISOString(),
        address: row.address,
        city: cityForBox(row.box),
        lat: null,
        lon: null,
        formattedAddress: null,
        geocodeStatus: 'pending',
        geocodeAttempts: 0,
        callCode: row.code,
        callDescription: row.description,
        category: cls.category,
        severity: cls.severity,
        alertable: cls.alertable,
        isUpgrade: cls.isUpgrade,
        box: row.box,
        station,
        battalion: battalionForStation(station),
        units: row.units,
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        clearedAt: null,
        updatedAt: nowIso,
        version: 0,
      };
      out.inserts.push(rec);
      out.events.push({ incidentId: rec.id, kind: 'created', data: { code: rec.callCode, description: rec.callDescription, units: rec.units, box: rec.box } });
      if (rec.alertable) {
        out.alerts.push({ incident: rec, kind: 'dispatch' });
        out.geocode.push(rec);
      }
      continue;
    }

    const codeChanged = prev.callCode !== row.code || prev.callDescription !== row.description;
    const delta = unitsDelta(prev.units, row.units);
    const reopened = prev.status === 'cleared';
    if (!codeChanged && !delta.changed && !reopened) {
      out.touched.push(prev.id);
      if (prev.alertable && prev.geocodeStatus === 'pending' && prev.geocodeAttempts < MAX_GEOCODE_ATTEMPTS) {
        out.geocode.push(prev);
        out.alerts.push({ incident: prev, kind: 'dispatch' });
      }
      continue;
    }

    const next: IncidentRecord = {
      ...prev,
      status: 'active',
      clearedAt: null,
      lastSeenAt: nowIso,
      updatedAt: nowIso,
      version: prev.version + 1,
      units: row.units,
    };
    if (codeChanged) {
      next.callCode = row.code;
      next.callDescription = row.description;
      next.category = cls.category;
      next.severity = cls.severity;
      next.alertable = cls.alertable;
      next.isUpgrade = cls.isUpgrade;
      out.events.push({
        incidentId: prev.id,
        kind: 'call_type_changed',
        data: { from: { code: prev.callCode, description: prev.callDescription, severity: prev.severity }, to: { code: row.code, description: row.description, severity: cls.severity } },
      });
      const escalated = SEVERITY_RANK[cls.severity] > SEVERITY_RANK[prev.severity];
      if (cls.alertable && (escalated || cls.isUpgrade)) {
        out.alerts.push({ incident: next, kind: prev.alertable ? 'upgrade' : 'dispatch' });
        if (next.geocodeStatus === 'pending') out.geocode.push(next);
      }
    }
    if (delta.changed) {
      out.events.push({ incidentId: prev.id, kind: 'units_changed', data: { added: delta.added, removed: delta.removed, units: row.units } });
    }
    if (reopened) out.events.push({ incidentId: prev.id, kind: 'reopened', data: { clearedAt: prev.clearedAt } });
    out.updates.push(next);
  }

  const graceMs = o.clearGraceSeconds * 1000;
  for (const prev of previous) {
    if (prev.status !== 'active' || keyed.has(prev.sourceKey)) continue;
    if (o.now.getTime() - new Date(prev.lastSeenAt).getTime() < graceMs) continue;
    out.cleared.push({ ...prev, status: 'cleared', clearedAt: nowIso, updatedAt: nowIso, version: prev.version + 1 });
    out.events.push({ incidentId: prev.id, kind: 'cleared', data: { units: prev.units } });
  }
  return out;
}
