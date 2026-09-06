import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CALL_TYPE_RULES } from '@barleschailey/feed';

/** The newest SQL seed and the TypeScript defaults must describe exactly the same rules. */
describe('call_type_rules seed parity', () => {
  it('matches packages/feed defaults', () => {
    const dir = resolve(__dirname, '../migrations');
    const seedFile = readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && readFileSync(resolve(dir, f), 'utf8').includes('INSERT INTO call_type_rules'))
      .sort()
      .at(-1)!;
    const sql = readFileSync(resolve(dir, seedFile), 'utf8');
    const block = sql.slice(sql.indexOf('INSERT INTO call_type_rules'));
    const re = /\('([A-Z0-9]+)','((?:[^']|'')*)','(\w+)','(\w+)',(true|false),(true|false)\)/g;
    const seeded = new Map<string, { description: string; category: string; severity: string; alertable: boolean; upgrade: boolean }>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      seeded.set(m[1]!, { description: m[2]!.replace(/''/g, "'"), category: m[3]!, severity: m[4]!, alertable: m[5] === 'true', upgrade: m[6] === 'true' });
    }
    expect(seeded.size).toBe(DEFAULT_CALL_TYPE_RULES.length);
    for (const rule of DEFAULT_CALL_TYPE_RULES) {
      expect(seeded.get(rule.code), rule.code).toEqual({
        description: rule.description,
        category: rule.category,
        severity: rule.severity,
        alertable: rule.alertable,
        upgrade: rule.upgrade ?? false,
      });
    }
  });

  it('keeps the life-safety codes alertable', () => {
    const by = new Map(DEFAULT_CALL_TYPE_RULES.map((r) => [r.code, r]));
    for (const code of ['HOUSE', 'BLDGFIRE', 'CPR2', 'UNCON2', 'PICTRAP1', 'ENTRAP2', 'TRTCOLAPS', 'GASMAJOR', 'TRAINPED', 'AIRCRSHP', 'VEHFRTRAP', 'PICTRFHM2']) {
      expect(by.get(code)?.alertable, code).toBe(true);
      expect(by.get(code)?.severity, code).toBe('critical');
    }
    for (const code of ['SICK1', 'FALLB', 'SVCLIFT', 'INTRF2', 'ALRMAFA', 'GASLEAK']) {
      expect(by.get(code)?.alertable, code).toBe(false);
    }
  });
});
