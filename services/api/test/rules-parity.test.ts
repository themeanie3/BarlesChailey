import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CALL_TYPE_RULES } from '@barleschailey/feed';

/** The TS rules and the SQL seed must describe the same table, or the classifier drifts from production. */
describe('call-type rule parity', () => {
  const sql = readFileSync(join(__dirname, '..', 'migrations', '0001_init.sql'), 'utf8');
  const seeded = new Map<string, { category: string; severity: string; alertable: boolean; upgrade: boolean }>();
  for (const m of sql.matchAll(/\('([A-Z0-9]+)','[^']*','(\w+)','(\w+)',(true|false),(true|false)\)/g)) {
    seeded.set(m[1]!, { category: m[2]!, severity: m[3]!, alertable: m[4] === 'true', upgrade: m[5] === 'true' });
  }
  it('seeds every default rule with the same grading', () => {
    expect(seeded.size).toBe(DEFAULT_CALL_TYPE_RULES.length);
    for (const r of DEFAULT_CALL_TYPE_RULES) {
      expect(seeded.get(r.code), r.code).toEqual({ category: r.category, severity: r.severity, alertable: r.alertable, upgrade: r.upgrade ?? false });
    }
  });
  it('has no duplicate codes', () => {
    const codes = DEFAULT_CALL_TYPE_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
