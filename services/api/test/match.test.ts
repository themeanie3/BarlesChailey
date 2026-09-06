import { describe, expect, it } from 'vitest';
import { evaluateCandidate, haversineM, matchDevices, type Candidate } from '../src/engine/match';
import type { DeviceRecord, IncidentRecord, MemberRecord, PrefsRecord } from '../src/engine/types';

const now = new Date('2026-09-06T02:00:00Z'); // 22:00 EDT
const tz = 'America/New_York';

const incident: IncidentRecord = {
  id: 'inc', source: 'mcfrs-fsas', sourceKey: 'k', status: 'active', dispatchedAt: now.toISOString(), address: '123 MAIN ST', city: 'ROCKVILLE',
  lat: 39.0840, lon: -77.1528, formattedAddress: null, geocodeStatus: 'ok', geocodeAttempts: 1, callCode: 'HOUSE', callDescription: 'House fire',
  category: 'fire', severity: 'critical', alertable: true, isUpgrade: false, box: '0314', station: '03', battalion: '3', units: ['E703'],
  firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), clearedAt: null, updatedAt: now.toISOString(), version: 0,
};

const device = (over: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id: 'dev', userId: 'u1', expoPushToken: 'ExponentPushToken[a]', platform: 'ios', appVersion: '1.0.0', deviceName: null, pushEnabled: true,
  criticalAlertsAuthorized: true, disabledReason: null, createdAt: now.toISOString(), lastSeenAt: now.toISOString(),
  lat: 39.09, lon: -77.16, accuracyM: 20, speedMps: null, recordedAt: new Date(now.getTime() - 5 * 60_000).toISOString(), ...over,
});
const prefs = (over: Partial<PrefsRecord> = {}): PrefsRecord => ({
  userId: 'u1', enabled: true, radiusMiles: 5, categories: [], minSeverity: 'high', locationMaxAgeHours: 12, home: null, quietHours: null,
  snoozeUntil: null, alertOnUpgrade: true, updatedAt: now.toISOString(), ...over,
});
const member: MemberRecord = { userId: 'u1', email: 'a@b.c', role: 'member', status: 'active', syncedAt: now.toISOString() };
const cand = (d: Partial<DeviceRecord> = {}, p: Partial<PrefsRecord> = {}, m: MemberRecord | null = member): Candidate => ({ device: device(d), prefs: prefs(p), member: m });

describe('haversine', () => {
  it('measures a known distance', () => {
    // Rockville station 3 to Gaithersburg is roughly 9 km.
    const d = haversineM(39.0840, -77.1528, 39.1434, -77.2014);
    expect(d).toBeGreaterThan(7500);
    expect(d).toBeLessThan(8500);
  });
});

describe('evaluateCandidate', () => {
  it('matches a nearby fresh fix', () => {
    const r = evaluateCandidate(incident, cand(), { now, tz, kind: 'dispatch' });
    expect(r.match?.matchedBy).toBe('device');
    expect(r.match!.distanceM).toBeLessThan(1500);
  });

  it('rejects for each preference gate', () => {
    const k = { now, tz, kind: 'dispatch' as const };
    expect(evaluateCandidate({ ...incident, lat: null }, cand(), k).reason).toBe('incident_not_geocoded');
    expect(evaluateCandidate(incident, cand({}, {}, null), k).reason).toBe('member_inactive');
    expect(evaluateCandidate(incident, cand({}, {}, { ...member, status: 'pending' }), k).reason).toBe('member_inactive');
    expect(evaluateCandidate(incident, cand({ pushEnabled: false }), k).reason).toBe('push_disabled');
    expect(evaluateCandidate(incident, cand({}, { enabled: false }), k).reason).toBe('alerts_disabled');
    expect(evaluateCandidate(incident, cand({}, { alertOnUpgrade: false }), { ...k, kind: 'upgrade' }).reason).toBe('upgrades_off');
    expect(evaluateCandidate(incident, cand({}, { snoozeUntil: new Date(now.getTime() + 60_000).toISOString() }), k).reason).toBe('snoozed');
    expect(evaluateCandidate(incident, cand({}, { categories: ['ems'] }), k).reason).toBe('category');
    expect(evaluateCandidate({ ...incident, severity: 'high' }, cand({}, { minSeverity: 'critical' }), k).reason).toBe('severity');
    expect(evaluateCandidate(incident, cand({ lat: 39.5, lon: -77.5 }), k).reason).toBe('out_of_range');
    expect(evaluateCandidate(incident, cand({ recordedAt: new Date(now.getTime() - 13 * 3600_000).toISOString() }), k).reason).toBe('out_of_range');
  });

  it('applies quiet hours but lets critical calls through when allowed', () => {
    const k = { now, tz, kind: 'dispatch' as const };
    expect(evaluateCandidate(incident, cand({}, { quietHours: { start: '21:00', end: '06:00', allowCritical: false } }), k).reason).toBe('quiet_hours');
    expect(evaluateCandidate(incident, cand({}, { quietHours: { start: '21:00', end: '06:00', allowCritical: true } }), k).match).not.toBeNull();
    expect(evaluateCandidate({ ...incident, severity: 'high' }, cand({}, { quietHours: { start: '21:00', end: '06:00', allowCritical: true } }), k).reason).toBe('quiet_hours');
  });

  it('falls back to the home point when the phone fix is stale', () => {
    const stale = { recordedAt: new Date(now.getTime() - 20 * 3600_000).toISOString() };
    const r = evaluateCandidate(incident, cand(stale, { home: { lat: 39.085, lon: -77.15, radiusMiles: 2, label: 'Station 3' } }), { now, tz, kind: 'dispatch' });
    expect(r.match?.matchedBy).toBe('home');
  });

  it('sorts matches by distance', () => {
    const far = cand({ id: 'far', lat: 39.12, lon: -77.19 });
    const near = cand({ id: 'near' });
    expect(matchDevices(incident, [far, near], { now, tz, kind: 'dispatch' }).map((m) => m.device.id)).toEqual(['near', 'far']);
  });
});
