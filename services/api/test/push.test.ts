import { describe, expect, it } from 'vitest';
import { PushData } from '@barleschailey/feed';
import type { Env } from '../src/env';
import { buildIncidentMessage, buildTestMessage, metersToMilesLabel, shouldUseCriticalSound } from '../src/lib/push';

const env = (over: Partial<Env> = {}): Env => ({
  DATABASE_URL: '', PUSH_SECRET: '', API_KEY_PEPPER: '', API_TOKEN_SECRET: '', FLUSH_INTERVAL_MINUTES: '30', BOARD: {} as unknown as Env['BOARD'], APP_ENV: 'development', FEED_SOURCE: 'mcfrs-fsas', FEED_TIMEZONE: 'America/New_York',
  STALE_AFTER_SECONDS: '20', CLEAR_GRACE_SECONDS: '20', NEON_AUTH_URL: '', NEON_AUTH_JWKS_URL: '', ADMIN_EMAILS: '',
  ALERT_INTERRUPTION_LEVEL: 'time-sensitive', ALERTS_CRITICAL_SOUND: 'false', CORS_ORIGINS: '', ...over,
});

const incident = {
  id: '11111111-1111-4111-8111-111111111111', address: '123 MAIN ST', city: 'ROCKVILLE', callCode: 'HOUSE', callDescription: 'HOUSE FIRE',
  category: 'fire' as const, severity: 'critical' as const, box: '0314', units: ['E703', 'T703'], lat: 39.08, lon: -77.15,
};

describe('buildIncidentMessage', () => {
  it('formats a readable, distance-tagged title and a board-style body', () => {
    const m = buildIncidentMessage(env(), { to: 'ExponentPushToken[abc]', incident, kind: 'dispatch', distanceM: 1287, deviceCriticalAuthorized: false });
    expect(m.title).toBe('🔥 HOUSE FIRE · 0.8 mi');
    expect(m.body).toBe('123 MAIN ST, ROCKVILLE · Box 0314 · E703 T703');
    expect(m.sound).toBe('default');
    expect(m.interruptionLevel).toBe('time-sensitive');
    expect(m.priority).toBe('high');
    expect(PushData.parse(m.data)).toMatchObject({ type: 'incident', incidentId: incident.id, url: `/incident/${incident.id}`, lat: 39.08 });
  });
  it('uses the critical sound only when the deployment and the device both allow it', () => {
    const on = env({ ALERTS_CRITICAL_SOUND: 'true' });
    expect(shouldUseCriticalSound(on, true, 'critical')).toBe(true);
    expect(shouldUseCriticalSound(on, false, 'critical')).toBe(false);
    expect(shouldUseCriticalSound(env(), true, 'critical')).toBe(false);
    expect(shouldUseCriticalSound(on, true, 'normal')).toBe(false);
    const m = buildIncidentMessage(on, { to: 'x', incident, kind: 'upgrade', distanceM: null, deviceCriticalAuthorized: true });
    expect(m.sound).toEqual({ critical: true, name: 'default', volume: 1 });
    expect(m.interruptionLevel).toBe('critical');
    expect(m.title.startsWith('🔥 UPGRADE · ')).toBe(true);
    expect(m.collapseId).toBe(`${incident.id}:upgrade`);
  });
  it('never asks iOS for a critical interruption level without the critical sound', () => {
    const m = buildIncidentMessage(env({ ALERT_INTERRUPTION_LEVEL: 'critical' }), { to: 'x', incident, kind: 'dispatch', distanceM: 100, deviceCriticalAuthorized: false });
    expect(m.interruptionLevel).toBe('time-sensitive');
  });
  it('formats distances', () => {
    expect(metersToMilesLabel(null)).toBeNull();
    expect(metersToMilesLabel(1609.344)).toBe('1.0 mi');
    expect(metersToMilesLabel(25000)).toBe('16 mi');
  });
  it('builds a test message', () => {
    expect(buildTestMessage(env(), 'x', false).data).toEqual({ type: 'test', url: '/settings' });
  });
});
