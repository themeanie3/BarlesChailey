import type { IncidentCategory, Severity } from '@barleschailey/feed';

export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function clockTime(iso: string | null | undefined, timeZone = 'America/New_York'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  fire: 'Fire', rescue: 'Rescue', ems: 'EMS', hazmat: 'Hazmat', service: 'Service', other: 'Other',
};

export const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low', normal: 'Routine', high: 'Serious', critical: 'Critical' };

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
