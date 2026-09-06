import { describe, expect, it } from 'vitest';
import { unitsDelta } from '../src/engine/diff';
import { geocodeQueryKey, normalizeAddress, withinServiceArea } from '../src/lib/geocode';

describe('unitsDelta', () => {
  it('reports additions and removals independent of order', () => {
    expect(unitsDelta(['E703', 'T703'], ['T703', 'E703'])).toEqual({ added: [], removed: [], changed: false });
    expect(unitsDelta(['E703'], ['E703', 'RS703', 'A703'])).toEqual({ added: ['A703', 'RS703'], removed: [], changed: true });
    expect(unitsDelta(['E703', 'T703'], ['T703'])).toEqual({ added: [], removed: ['E703'], changed: true });
  });
});

describe('address normalization', () => {
  it('turns CAD intersections and unit suffixes into geocoder-friendly text', () => {
    expect(normalizeAddress('I-270 / SHADY GROVE RD')).toBe('I-270 & SHADY GROVE RD');
    expect(normalizeAddress('100 Elm St Apt 4B')).toBe('100 ELM ST');
    expect(normalizeAddress('100 ELM ST #12')).toBe('100 ELM ST');
    expect(geocodeQueryKey('100 elm st', 'Rockville')).toBe('100 ELM ST|ROCKVILLE');
  });
  it('bounds results to the service area', () => {
    expect(withinServiceArea(39.08, -77.15)).toBe(true);
    expect(withinServiceArea(34.05, -118.24)).toBe(false);
  });
});
