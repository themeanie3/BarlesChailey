/**
 * Pure responder matching: which devices should be paged for an incident.
 * Haversine over a few dozen devices is cheaper and simpler than a database
 * round trip, and it keeps the alert path independent of Postgres.
 */
import { SEVERITY_RANK } from '@barleschailey/feed';
import { inQuietWindow } from '../lib/time';
import type { DeviceRecord, IncidentRecord, MemberRecord, PrefsRecord } from './types';

const EARTH_M = 6371008.8;
export const MILE_M = 1609.344;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Candidate {
  device: DeviceRecord;
  prefs: PrefsRecord;
  member: MemberRecord | null;
}

export interface Match {
  device: DeviceRecord;
  prefs: PrefsRecord;
  distanceM: number;
  matchedBy: 'device' | 'home';
}

export interface MatchOptions {
  now: Date;
  tz: string;
  kind: 'dispatch' | 'upgrade';
}

/** Returns why a candidate was skipped, or null when it should be paged. */
export function evaluateCandidate(incident: IncidentRecord, c: Candidate, o: MatchOptions): { match: Match | null; reason: string | null } {
  const { device, prefs, member } = c;
  if (incident.lat == null || incident.lon == null) return { match: null, reason: 'incident_not_geocoded' };
  if (!member || member.status !== 'active') return { match: null, reason: 'member_inactive' };
  if (!device.pushEnabled) return { match: null, reason: 'push_disabled' };
  if (!prefs.enabled) return { match: null, reason: 'alerts_disabled' };
  if (o.kind === 'upgrade' && !prefs.alertOnUpgrade) return { match: null, reason: 'upgrades_off' };
  if (prefs.snoozeUntil && new Date(prefs.snoozeUntil).getTime() > o.now.getTime()) return { match: null, reason: 'snoozed' };
  if (prefs.categories.length && !prefs.categories.includes(incident.category)) return { match: null, reason: 'category' };
  if (SEVERITY_RANK[incident.severity] < SEVERITY_RANK[prefs.minSeverity]) return { match: null, reason: 'severity' };
  if (prefs.quietHours && inQuietWindow(o.now, o.tz, prefs.quietHours.start, prefs.quietHours.end)) {
    if (!(prefs.quietHours.allowCritical && incident.severity === 'critical')) return { match: null, reason: 'quiet_hours' };
  }

  let best: Match | null = null;
  if (device.lat != null && device.lon != null && device.recordedAt) {
    const ageMs = o.now.getTime() - new Date(device.recordedAt).getTime();
    if (ageMs <= prefs.locationMaxAgeHours * 3600 * 1000) {
      const d = haversineM(device.lat, device.lon, incident.lat, incident.lon);
      if (d <= prefs.radiusMiles * MILE_M) best = { device, prefs, distanceM: d, matchedBy: 'device' };
    }
  }
  if (prefs.home) {
    const d = haversineM(prefs.home.lat, prefs.home.lon, incident.lat, incident.lon);
    if (d <= prefs.home.radiusMiles * MILE_M && (!best || d < best.distanceM)) best = { device, prefs, distanceM: d, matchedBy: 'home' };
  }
  return best ? { match: best, reason: null } : { match: null, reason: 'out_of_range' };
}

export function matchDevices(incident: IncidentRecord, candidates: Candidate[], o: MatchOptions): Match[] {
  const out: Match[] = [];
  for (const c of candidates) {
    const { match } = evaluateCandidate(incident, c, o);
    if (match) out.push(match);
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}
