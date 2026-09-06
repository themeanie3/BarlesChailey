import { describe, expect, it } from 'vitest';
import { inQuietWindow, parseFsasTimestamp, zonedToUtc } from '../src/lib/time';

const TZ = 'America/New_York';

describe('parseFsasTimestamp', () => {
  it('resolves the current year and the EDT offset', () => {
    const now = new Date('2026-09-06T03:00:00Z'); // Sep 5 23:00 EDT
    const t = parseFsasTimestamp('09/05 22:30:00', TZ, now)!;
    expect(t.toISOString()).toBe('2026-09-06T02:30:00.000Z');
  });
  it('rolls back a year for December calls seen on January 1', () => {
    const now = new Date('2027-01-01T05:10:00Z'); // Jan 1 00:10 EST
    const t = parseFsasTimestamp('12/31 23:55:00', TZ, now)!;
    expect(t.toISOString()).toBe('2027-01-01T04:55:00.000Z');
  });
  it('uses EST in winter', () => {
    const now = new Date('2026-02-10T12:00:00Z');
    expect(parseFsasTimestamp('02/10 06:00:00', TZ, now)!.toISOString()).toBe('2026-02-10T11:00:00.000Z');
  });
  it('rejects garbage', () => {
    expect(parseFsasTimestamp('Date', TZ)).toBeNull();
    expect(parseFsasTimestamp('13/45 99:99:99', TZ)).toBeNull();
  });
});

describe('zonedToUtc', () => {
  it('handles the spring-forward gap sanely', () => {
    // 2026-03-08 02:30 does not exist in New York; expect a valid nearby instant, not NaN.
    const t = zonedToUtc(2026, 3, 8, 2, 30, 0, TZ);
    expect(Number.isNaN(t.getTime())).toBe(false);
  });
});

describe('inQuietWindow', () => {
  it('supports windows that wrap midnight', () => {
    const at = (iso: string) => new Date(iso);
    expect(inQuietWindow(at('2026-09-06T04:00:00Z'), TZ, '23:00', '06:30')).toBe(true); // 00:00 EDT
    expect(inQuietWindow(at('2026-09-06T16:00:00Z'), TZ, '23:00', '06:30')).toBe(false); // 12:00 EDT
    expect(inQuietWindow(at('2026-09-06T16:00:00Z'), TZ, '09:00', '17:00')).toBe(true);
    expect(inQuietWindow(at('2026-09-06T16:00:00Z'), TZ, '12:00', '12:00')).toBe(false);
  });
});
