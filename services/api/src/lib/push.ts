import { SEVERITY_RANK, type IncidentCategory, type PushData, type Severity } from '@barleschailey/feed';
import type { Env } from '../env';
import { boolVar } from '../env';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const CHUNK = 100;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: 'default' | { critical: boolean; name: string; volume: number };
  priority: 'high' | 'normal' | 'default';
  ttl: number;
  interruptionLevel: 'active' | 'time-sensitive' | 'critical';
  categoryId: string;
  collapseId?: string;
  channelId: string;
  mutableContent?: boolean;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string; [k: string]: unknown };
}

export interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string; [k: string]: unknown };
}

function headers(env: Env): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (env.EXPO_ACCESS_TOKEN) h.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;
  return h;
}

/** Send messages in chunks of 100; returns tickets in the same order as `messages`. */
export async function sendExpoPush(env: Env, messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers: headers(env), body: JSON.stringify(chunk), signal: AbortSignal.timeout(10_000) });
      const body = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[]; errors?: Array<{ code: string; message: string }> };
      if (!res.ok || !body.data) {
        const msg = body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
        tickets.push(...chunk.map(() => ({ status: 'error' as const, message: msg })));
        continue;
      }
      tickets.push(...body.data);
    } catch (err) {
      tickets.push(...chunk.map(() => ({ status: 'error' as const, message: (err as Error).message })));
    }
  }
  return tickets;
}

export async function getExpoReceipts(env: Env, ids: string[]): Promise<Record<string, ExpoReceipt>> {
  const out: Record<string, ExpoReceipt> = {};
  for (let i = 0; i < ids.length; i += 1000) {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST', headers: headers(env), body: JSON.stringify({ ids: ids.slice(i, i + 1000) }), signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`receipts HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, ExpoReceipt> };
    Object.assign(out, body.data ?? {});
  }
  return out;
}

export const CATEGORY_EMOJI: Record<IncidentCategory, string> = {
  fire: '🔥', rescue: '🚨', ems: '🚑', hazmat: '☣️', service: '🛠️', other: '📟',
};

export interface IncidentForPush {
  id: string;
  address: string;
  city: string | null;
  callCode: string;
  callDescription: string;
  category: IncidentCategory;
  severity: Severity;
  box: string | null;
  units: string[];
  lat: number | null;
  lon: number | null;
}

export interface MessageOptions {
  to: string;
  incident: IncidentForPush;
  kind: 'dispatch' | 'upgrade';
  distanceM: number | null;
  /** Device reported iOS critical-alert authorization and the deployment allows the critical sound. */
  deviceCriticalAuthorized: boolean;
}

export function metersToMilesLabel(m: number | null): string | null {
  if (m == null || !Number.isFinite(m)) return null;
  const mi = m / 1609.344;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

export function shouldUseCriticalSound(env: Env, deviceCriticalAuthorized: boolean, severity: Severity): boolean {
  return boolVar(env.ALERTS_CRITICAL_SOUND) && deviceCriticalAuthorized && SEVERITY_RANK[severity] >= SEVERITY_RANK.high;
}

export function buildIncidentMessage(env: Env, o: MessageOptions): ExpoMessage {
  const inc = o.incident;
  const critical = shouldUseCriticalSound(env, o.deviceCriticalAuthorized, inc.severity);
  const dist = metersToMilesLabel(o.distanceM);
  const prefix = o.kind === 'upgrade' ? 'UPGRADE · ' : '';
  const title = `${CATEGORY_EMOJI[inc.category]} ${prefix}${inc.callDescription || inc.callCode}${dist ? ` · ${dist}` : ''}`;
  const place = inc.city ? `${inc.address}, ${inc.city}` : inc.address;
  const units = inc.units.length ? inc.units.join(' ') : 'units pending';
  const body = `${place} · Box ${inc.box ?? '—'} · ${units}`;
  const data: PushData = {
    type: 'incident',
    incidentId: inc.id,
    url: `/incident/${inc.id}`,
    severity: inc.severity,
    ...(inc.lat != null && inc.lon != null ? { lat: inc.lat, lon: inc.lon } : {}),
  };
  return {
    to: o.to,
    title,
    body,
    data,
    sound: critical ? { critical: true, name: 'default', volume: 1.0 } : 'default',
    priority: 'high',
    ttl: 900,
    interruptionLevel: critical ? 'critical' : env.ALERT_INTERRUPTION_LEVEL === 'critical' ? 'time-sensitive' : env.ALERT_INTERRUPTION_LEVEL,
    categoryId: 'incident',
    collapseId: `${inc.id}:${o.kind}`,
    channelId: 'alerts',
  };
}

export function buildTestMessage(env: Env, to: string, deviceCriticalAuthorized: boolean): ExpoMessage {
  const critical = shouldUseCriticalSound(env, deviceCriticalAuthorized, 'critical');
  return {
    to,
    title: '🧪 Test alert',
    body: critical ? 'Critical alert path is working (this bypassed mute).' : 'Alerts are working. Critical sound not enabled on this build.',
    data: { type: 'test', url: '/settings' },
    sound: critical ? { critical: true, name: 'default', volume: 1.0 } : 'default',
    priority: 'high',
    ttl: 300,
    interruptionLevel: critical ? 'critical' : 'time-sensitive',
    categoryId: 'test',
    channelId: 'alerts',
  };
}
