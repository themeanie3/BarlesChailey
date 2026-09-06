import type { AlertPreferences, DeviceRegistration, IncidentDetailResponse, IncidentListResponse, LocationUpdate, Me } from '@barleschailey/feed';
import { getApiToken } from './auth-client';
import { config } from './config';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public body?: unknown) {
    super(message ?? code);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; retry?: boolean } = {}): Promise<T> {
  if (!config.apiUrl) throw new ApiError(0, 'not_configured', 'EXPO_PUBLIC_API_URL is not set');
  const url = new URL(config.apiUrl + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const token = await getApiToken(opts.retry === true);
  if (!token) throw new ApiError(401, 'unauthorized', 'not signed in');
  const res = await fetch(url.toString(), {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 401 && !opts.retry) return request<T>(method, path, { ...opts, retry: true });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? res.status), String(json.detail ?? json.error ?? res.statusText), json);
  return json as T;
}

export interface MeResponse extends Me {
  server: { env: string; criticalSoundEnabled: boolean; interruptionLevel: string };
}

export interface FeedStatusResponse {
  lastPushAt: string | null;
  stale: boolean;
  staleAfterSeconds: number;
  activeIncidents: number;
  serverTime: string;
}

export interface AlertHistoryItem {
  id: string;
  kind: 'dispatch' | 'upgrade' | 'test';
  incidentId: string | null;
  distanceMiles: number | null;
  sentAt: string;
  receiptStatus: 'pending' | 'ok' | 'error';
  receiptError: string | null;
  incident: { id: string; callCode: string; callDescription: string; address: string; city: string | null; category: string; severity: string; status: string; dispatchedAt: string | null } | null;
}

export const api = {
  me: () => request<MeResponse>('GET', '/v1/me'),
  updatePreferences: (p: Partial<AlertPreferences>) => request<{ preferences: AlertPreferences }>('PUT', '/v1/me/preferences', { body: p }),
  myAlerts: (limit = 50) => request<{ alerts: AlertHistoryItem[] }>('GET', '/v1/me/alerts', { query: { limit } }),
  feedStatus: () => request<FeedStatusResponse>('GET', '/v1/feed/status'),
  incidents: (query: { status?: 'active' | 'cleared' | 'all'; since?: string; limit?: number; includeSimulated?: boolean } = {}) =>
    request<IncidentListResponse>('GET', '/v1/incidents', { query: { ...query, includeSimulated: query.includeSimulated ? '1' : undefined } }),
  incident: (id: string) => request<IncidentDetailResponse>('GET', `/v1/incidents/${id}`),
  registerDevice: (d: DeviceRegistration) => request<{ device: { id: string } }>('POST', '/v1/devices', { body: d }),
  reportLocation: (deviceId: string, l: LocationUpdate) => request<{ ok: true }>('PUT', `/v1/devices/${deviceId}/location`, { body: l }),
  testAlert: (deviceId: string) => request<{ ok: boolean; critical: boolean }>('POST', `/v1/devices/${deviceId}/test-alert`),
  deleteDevice: (deviceId: string) => request<{ ok: true }>('DELETE', `/v1/devices/${deviceId}`),
  admin: {
    members: () => request<{ members: Array<{ email: string; role: string; status: string; displayName: string | null; devices: number; createdAt: string }> }>('GET', '/v1/admin/members'),
    setMember: (email: string, patch: { role?: 'admin' | 'member'; status?: 'pending' | 'active' | 'revoked' }) =>
      request<{ member: unknown }>('PUT', `/v1/admin/members/${encodeURIComponent(email)}`, { body: patch }),
    simulate: (body: { lat: number; lon: number; code?: string; address?: string }) =>
      request<{ alerts: { candidates: number; sent: number; skipped: number; errors: number } }>('POST', '/v1/admin/simulate', { body }),
    stats: () => request<Record<string, unknown>>('GET', '/v1/admin/stats'),
  },
};
