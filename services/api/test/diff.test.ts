import { describe, expect, it } from 'vitest';
import { diffBoard } from '../src/engine/diff';
import { DEFAULT_RULES } from '../src/engine/classify';
import { parseFsasTable } from '../src/engine/parse-fsas';
import type { IncidentRecord } from '../src/engine/types';

const now = new Date('2026-09-05T18:30:00Z');
let n = 0;
const opts = () => ({ source: 'mcfrs-fsas', rules: DEFAULT_RULES, tz: 'America/New_York', now, clearGraceSeconds: 0, newId: () => `id-${++n}` });

const table = (rows: string[]) => `<table>${rows.map((r) => `<tr>${r}</tr>`).join('')}</table>`;
const row = (t: string, a: string, c: string, d: string, u: string, b: string) => `<td>${t}</td><td>${a}</td><td>${c}</td><td>${d}</td><td>${u}</td><td>${b}</td>`;

describe('diffBoard', () => {
  it('creates incidents, queues alerts and geocodes only for alertable calls', () => {
    const rows = parseFsasTable(table([
      row('09/05 14:22:10', '123 MAIN ST', 'HOUSE', 'HOUSE FIRE', 'E703', '0314'),
      row('09/05 14:20:00', '9 OAK LN', 'SICK1', 'SICK PERSON', 'A703', '0301'),
    ]));
    const r = diffBoard([], rows, opts());
    expect(r.inserts).toHaveLength(2);
    expect(r.inserts[0]).toMatchObject({ callCode: 'HOUSE', category: 'fire', severity: 'critical', alertable: true, city: 'ROCKVILLE', station: '03', battalion: '3', status: 'active' });
    expect(r.inserts[0]!.dispatchedAt).toBe('2026-09-05T18:22:10.000Z');
    expect(r.alerts.map((a) => a.incident.callCode)).toEqual(['HOUSE']);
    expect(r.geocode.map((g) => g.callCode)).toEqual(['HOUSE']);
    expect(r.events.filter((e) => e.kind === 'created')).toHaveLength(2);
  });

  it('touches unchanged incidents, records unit changes, and clears missing ones', () => {
    const first = diffBoard([], parseFsasTable(table([
      row('09/05 14:22:10', '123 MAIN ST', 'HOUSE', 'HOUSE FIRE', 'E703', '0314'),
      row('09/05 14:00:00', '5 ELM ST', 'SICK1', 'SICK PERSON', 'A703', '0301'),
    ])), opts());
    const prev: IncidentRecord[] = first.inserts.map((i) => ({ ...i, lastSeenAt: '2026-09-05T18:25:00.000Z' }));
    const second = diffBoard(prev, parseFsasTable(table([
      row('09/05 14:22:10', '123 MAIN ST', 'HOUSE', 'HOUSE FIRE', 'E703 T703 RS703', '0314'),
    ])), opts());
    expect(second.inserts).toHaveLength(0);
    expect(second.updates).toHaveLength(1);
    expect(second.updates[0]!.units).toEqual(['E703', 'T703', 'RS703']);
    expect(second.updates[0]!.version).toBe(1);
    expect(second.events.find((e) => e.kind === 'units_changed')?.data).toMatchObject({ added: ['RS703', 'T703'], removed: [] });
    expect(second.cleared.map((c) => c.callCode)).toEqual(['SICK1']);
    expect(second.alerts).toHaveLength(0);
  });

  it('honours the clear grace period', () => {
    const first = diffBoard([], parseFsasTable(table([row('09/05 14:00:00', '5 ELM ST', 'SICK1', 'SICK', 'A703', '0301')])), opts());
    const prev = first.inserts.map((i) => ({ ...i, lastSeenAt: now.toISOString() }));
    const r = diffBoard(prev, [], { ...opts(), clearGraceSeconds: 20 });
    expect(r.cleared).toHaveLength(0);
  });

  it('pages on upgrades and escalations, and reopens cleared incidents', () => {
    const first = diffBoard([], parseFsasTable(table([row('09/05 14:22:10', '123 MAIN ST', 'HOUSE', 'HOUSE FIRE', 'E703', '0314')])), opts());
    const prev = first.inserts.map((i) => ({ ...i, status: 'cleared' as const, clearedAt: now.toISOString() }));
    const r = diffBoard(prev, parseFsasTable(table([row('09/05 14:22:10', '123 MAIN ST', 'UBOX', 'WORKING FIRE', 'E703 E723', '0314')])), opts());
    expect(r.updates[0]!.status).toBe('active');
    expect(r.updates[0]!.isUpgrade).toBe(true);
    expect(r.alerts).toEqual([expect.objectContaining({ kind: 'upgrade' })]);
    expect(r.events.map((e) => e.kind).sort()).toEqual(['call_type_changed', 'reopened', 'units_changed']);

    const sick = diffBoard([], parseFsasTable(table([row('09/05 14:00:00', '5 ELM ST', 'SICK1', 'SICK', 'A703', '0301')])), opts()).inserts;
    const esc = diffBoard(sick, parseFsasTable(table([row('09/05 14:00:00', '5 ELM ST', 'CPR2', 'CARDIAC ARREST', 'A703 M703', '0301')])), opts());
    expect(esc.alerts).toEqual([expect.objectContaining({ kind: 'dispatch' })]);
  });

  it('retries pending geocodes for alertable incidents a few times', () => {
    const inc = diffBoard([], parseFsasTable(table([row('09/05 14:22:10', '123 MAIN ST', 'HOUSE', 'HOUSE FIRE', 'E703', '0314')])), opts()).inserts;
    const again = diffBoard(inc, parseFsasTable(table([row('09/05 14:22:10', '123 MAIN ST', 'HOUSE', 'HOUSE FIRE', 'E703', '0314')])), opts());
    expect(again.geocode).toHaveLength(1);
    const exhausted = diffBoard(inc.map((i) => ({ ...i, geocodeAttempts: 3 })), parseFsasTable(table([row('09/05 14:22:10', '123 MAIN ST', 'HOUSE', 'HOUSE FIRE', 'E703', '0314')])), opts());
    expect(exhausted.geocode).toHaveLength(0);
  });
});
