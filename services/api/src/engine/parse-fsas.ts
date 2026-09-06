/**
 * Parser for the MCFRS FSAS "ScreenView" HTML table the station Pi scrapes.
 *
 * Columns (per sta03): Date | Address | Call code | Description | Units | Box.
 * We deliberately avoid a DOM library: Workers have none, the table is simple,
 * and a strict parser that rejects anything unexpected is safer than a lenient
 * one that silently produces garbage incidents.
 */

export interface FsasRow {
  /** "MM/DD HH:MM:SS" exactly as displayed. */
  time: string;
  address: string;
  code: string;
  description: string;
  units: string[];
  /** 4-digit box, or null when CAD shows none (e.g. MAFULL). */
  box: string | null;
  cells: string[];
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#160': ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    const key = ent.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key]!;
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return m;
  });
}

function cellText(inner: string): string {
  return decodeEntities(inner.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasTable(html: string): boolean {
  return /<table[\s>]/i.test(html);
}

export function parseFsasTable(html: string): FsasRow[] {
  const rows: FsasRow[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html))) {
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    tdRe.lastIndex = 0;
    while ((td = tdRe.exec(tr[1]!))) cells.push(cellText(td[1]!));
    if (cells.length < 6) continue;
    const [time, address, code, description, unitsRaw, boxRaw] = cells as [string, string, string, string, string, string];
    if (!code || /^date$/i.test(time)) continue;
    if (!/^\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}:\d{2}$/.test(time)) continue;
    const box = /^\d{4}$/.test(boxRaw) ? boxRaw : null;
    rows.push({
      time,
      address: address.toUpperCase(),
      code: code.toUpperCase(),
      description,
      units: unitsRaw.split(/\s+/).filter(Boolean),
      box,
      cells,
    });
  }
  return rows;
}

/** Stable identity of a CAD incident: dispatch time + address + box (mirrors sta03 changelog.py). */
export function sourceKey(row: Pick<FsasRow, 'time' | 'address' | 'box'>): string {
  return `${row.time}|${row.address}|${row.box ?? ''}`;
}
