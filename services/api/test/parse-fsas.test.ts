import { describe, expect, it } from 'vitest';
import { decodeEntities, hasTable, parseFsasTable, sourceKey } from '../src/engine/parse-fsas';

const SAMPLE = `
<table id="grid" class="x">
  <tr><th>Date</th><th>Address</th><th>Call</th><th>Desc</th><th>Units</th><th>Box</th></tr>
  <tr><td>09/05 23:41:12</td><td>123 MAIN ST</td><td>HOUSE</td><td>HOUSE FIRE</td><td>E703 T703 RS703 A703</td><td>0314</td></tr>
  <tr><td>09/05 23:39:02</td><td>I-270 / SHADY GROVE RD</td><td><b>PICTRAP1</b></td><td>COLLISION W/ ENTRAP</td><td>E708&nbsp;RS703</td><td>0801</td></tr>
  <tr><td>09/05 23:30:00</td><td>4 SOME PL</td><td>MAFULL</td><td>MUTUAL AID FULL ASSIGN</td><td></td><td></td></tr>
  <tr><td>09/05 23:20:00</td><td>ROW WITH NO CODE</td><td></td><td></td><td></td><td>0101</td></tr>
  <tr><td>junk</td></tr>
</table>`;

describe('parseFsasTable', () => {
  it('parses incident rows and skips headers, empty codes, and malformed rows', () => {
    const rows = parseFsasTable(SAMPLE);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ time: '09/05 23:41:12', address: '123 MAIN ST', code: 'HOUSE', description: 'HOUSE FIRE', units: ['E703', 'T703', 'RS703', 'A703'], box: '0314' });
  });
  it('strips nested tags and decodes entities', () => {
    const [, pic] = parseFsasTable(SAMPLE);
    expect(pic!.code).toBe('PICTRAP1');
    expect(pic!.units).toEqual(['E708', 'RS703']);
    expect(pic!.address).toBe('I-270 / SHADY GROVE RD');
  });
  it('treats a non-numeric box as null (MAFULL)', () => {
    const [, , mafull] = parseFsasTable(SAMPLE);
    expect(mafull!.box).toBeNull();
    expect(mafull!.units).toEqual([]);
  });
  it('builds a stable source key', () => {
    const [house] = parseFsasTable(SAMPLE);
    expect(sourceKey(house!)).toBe('09/05 23:41:12|123 MAIN ST|0314');
  });
  it('detects missing tables', () => {
    expect(hasTable('<html><body>Offline</body></html>')).toBe(false);
    expect(hasTable(SAMPLE)).toBe(true);
  });
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('A &amp; B &#39;C&#x27; &nbsp;D')).toBe("A & B 'C'  D");
  });
});
