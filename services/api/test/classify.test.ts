import { describe, expect, it } from 'vitest';
import { battalionForStation, classify, stationForBox, cityForBox } from '../src/engine/classify';

describe('classify', () => {
  it('grades known codes from the default rules', () => {
    expect(classify('HOUSE')).toMatchObject({ category: 'fire', severity: 'critical', alertable: true, isUpgrade: false });
    expect(classify('ubox')).toMatchObject({ category: 'fire', severity: 'critical', isUpgrade: true });
    expect(classify('CPR2')).toMatchObject({ category: 'ems', severity: 'critical', alertable: true });
    expect(classify('FALL2')).toMatchObject({ category: 'ems', severity: 'high' });
    expect(classify('PICTRAP1')).toMatchObject({ category: 'rescue', severity: 'critical' });
  });
  it('never pages for unknown codes but still categorizes them for the board', () => {
    expect(classify('SICK1')).toMatchObject({ category: 'ems', severity: 'normal', alertable: false });
    expect(classify('GASLEAK')).toMatchObject({ category: 'hazmat', alertable: false });
    expect(classify('BRUSH')).toMatchObject({ category: 'fire', alertable: false });
    expect(classify('LOCKOUT')).toMatchObject({ category: 'service', alertable: false });
    expect(classify('XYZ')).toMatchObject({ category: 'other', alertable: false });
  });
  it('derives station, battalion and city from the box', () => {
    expect(stationForBox('0314')).toBe('03');
    expect(stationForBox(null)).toBeNull();
    expect(battalionForStation('03')).toBe('3');
    expect(battalionForStation('99')).toBeNull();
    expect(cityForBox('0314')).toBe('ROCKVILLE');
    expect(cityForBox('2514')).toBe('ROCKVILLE');
    expect(cityForBox('2520')).toBe('ASPEN HILL');
    expect(cityForBox('9999')).toBeNull();
  });
});
