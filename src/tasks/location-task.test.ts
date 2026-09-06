jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('../lib/api', () => ({ api: {} }));
jest.mock('../lib/storage', () => ({ storage: {}, KEYS: {} }));

import { shouldSend } from './location-task';

describe('shouldSend', () => {
  const now = 1_000_000_000;
  it('always sends the first fix', () => {
    expect(shouldSend(null, 39.08, -77.15, now)).toBe(true);
  });
  it('suppresses tiny moves within ten minutes', () => {
    expect(shouldSend({ lat: 39.08, lon: -77.15, at: now - 60_000 }, 39.0805, -77.15, now)).toBe(false);
  });
  it('sends when the phone moved a few blocks', () => {
    expect(shouldSend({ lat: 39.08, lon: -77.15, at: now - 60_000 }, 39.09, -77.15, now)).toBe(true);
  });
  it('sends a heartbeat after fifteen minutes regardless', () => {
    expect(shouldSend({ lat: 39.08, lon: -77.15, at: now - 16 * 60_000 }, 39.08, -77.15, now)).toBe(true);
  });
});
