import { describe, expect, it } from 'vitest';
import { hashApiKey, randomToken, secretsEqual, sha256Hex } from '../src/lib/crypto';

describe('crypto helpers', () => {
  it('hashes deterministically', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashApiKey('pepper', 'key')).toBe(await hashApiKey('pepper', 'key'));
    expect(await hashApiKey('pepper', 'key')).not.toBe(await hashApiKey('other', 'key'));
  });
  it('compares secrets without throwing on length mismatch', async () => {
    expect(await secretsEqual('a', 'a')).toBe(true);
    expect(await secretsEqual('a', 'ab')).toBe(false);
    expect(await secretsEqual(null, 'a')).toBe(false);
    expect(await secretsEqual('', '')).toBe(false);
  });
  it('generates hex tokens of the requested size', () => {
    expect(randomToken(8)).toMatch(/^[0-9a-f]{16}$/);
  });
});
