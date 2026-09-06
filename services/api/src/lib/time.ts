/**
 * CAD timestamps arrive as "MM/DD HH:MM:SS" in the station's local zone with no
 * year. We resolve them to real instants so the feed is unambiguous for every
 * consumer, and so "how old is this call" works across midnight and New Year.
 */

const FSAS_RE = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/;

/** Offset (ms) of `tz` from UTC at instant `t`. */
export function tzOffsetMs(t: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(t))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!);
  return asUtc - t;
}

/** Interpret wall-clock components in `tz` and return the UTC instant. */
export function zonedToUtc(
  y: number, m: number, d: number, hh: number, mm: number, ss: number, tz: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let t = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(t, tz);
  if (guess - off2 !== t) t = guess - off2;
  return new Date(t);
}

/**
 * Parse an FSAS "MM/DD HH:MM:SS" string. The year is inferred: the most recent
 * occurrence of that month/day that is not more than 36 hours in the future.
 */
export function parseFsasTimestamp(s: string, tz = 'America/New_York', now: Date = new Date()): Date | null {
  const m = FSAS_RE.exec(s.trim());
  if (!m) return null;
  const month = +m[1]!, day = +m[2]!, hh = +m[3]!, mm = +m[4]!, ss = +m[5]!;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const nowParts = localParts(now, tz);
  let candidate = zonedToUtc(nowParts.year, month, day, hh, mm, ss, tz);
  if (candidate.getTime() - now.getTime() > 36 * 3600 * 1000) {
    candidate = zonedToUtc(nowParts.year - 1, month, day, hh, mm, ss, tz);
  }
  if (Number.isNaN(candidate.getTime())) return null;
  return candidate;
}

export function localParts(t: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(t)) p[part.type] = part.value;
  return { year: +p.year!, month: +p.month!, day: +p.day!, hour: +p.hour! % 24, minute: +p.minute! };
}

/** True when local time-of-day in `tz` falls inside [start, end) (HH:MM); windows may wrap midnight. */
export function inQuietWindow(t: Date, tz: string, start: string, end: string): boolean {
  const { hour, minute } = localParts(t, tz);
  const cur = hour * 60 + minute;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = (sh ?? 0) * 60 + (sm ?? 0);
  const e = (eh ?? 0) * 60 + (em ?? 0);
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}
