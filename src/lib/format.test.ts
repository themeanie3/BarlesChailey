import { timeAgo, titleCase } from './format';
import { formatMiles, haversineMeters } from './geo';

describe('timeAgo', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  it('buckets sensibly', () => {
    expect(timeAgo('2026-09-06T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-09-06T11:50:00Z', now)).toBe('10m ago');
    expect(timeAgo('2026-09-06T09:30:00Z', now)).toBe('2h 30m ago');
    expect(timeAgo('2026-09-03T12:00:00Z', now)).toBe('3d ago');
    expect(timeAgo(null)).toBe('');
  });
});

describe('geo', () => {
  it('measures Rockville station 3 to Shady Grove roughly right', () => {
    const m = haversineMeters(39.0837, -77.1528, 39.1208, -77.1856);
    expect(m).toBeGreaterThan(4500);
    expect(m).toBeLessThan(5500);
  });
  it('formats miles', () => {
    expect(formatMiles(50)).toBe('< 0.1 mi');
    expect(formatMiles(1609.344)).toBe('1.0 mi');
    expect(formatMiles(32000)).toBe('20 mi');
    expect(formatMiles(null)).toBeNull();
  });
});

describe('titleCase', () => {
  it('lowercases CAD shouting', () => {
    expect(titleCase('123 MAIN ST, ROCKVILLE')).toBe('123 Main St, Rockville');
  });
});
