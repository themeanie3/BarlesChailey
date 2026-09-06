import type { Env } from '../env';
import type { Sql } from './db';

export interface GeocodeResult {
  status: 'ok' | 'failed' | 'error';
  lat: number | null;
  lon: number | null;
  formattedAddress: string | null;
}

/** Montgomery County + neighbours. Results outside are treated as geocoder misses. */
const BOUNDS = { minLat: 38.55, maxLat: 39.75, minLon: -77.95, maxLon: -76.55 };

const FAILED_RETRY_MS = 6 * 3600 * 1000;

/**
 * Light normalization mirroring sta03's clean_up(): CAD intersections use "/",
 * apartment/unit suffixes confuse the geocoder, and whitespace is noisy.
 */
export function normalizeAddress(address: string): string {
  return address
    .toUpperCase()
    .replace(/\s*\/\s*/g, ' & ')
    .replace(/\b(APT|UNIT|STE|SUITE|BLDG|FL|FLOOR|RM|ROOM|LOT)\.?\s*#?\s*[A-Z0-9-]+\b/g, '')
    .replace(/#\s*[A-Z0-9-]+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function geocodeQueryKey(address: string, city: string | null): string {
  return `${normalizeAddress(address)}|${(city ?? '').toUpperCase()}`;
}

export function withinServiceArea(lat: number, lon: number): boolean {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon;
}

interface CacheRow { lat: number | null; lon: number | null; formatted_address: string | null; status: 'ok' | 'failed' | 'pending'; created_at: string | Date }

export async function geocodeAddress(env: Env, sql: Sql, address: string, city: string | null): Promise<GeocodeResult> {
  const key = geocodeQueryKey(address, city);
  const cached = (await sql`SELECT lat, lon, formatted_address, status, created_at FROM geocode_cache WHERE query_key = ${key}`) as CacheRow[];
  const hit = cached[0];
  if (hit) {
    if (hit.status === 'ok' && hit.lat != null && hit.lon != null) {
      return { status: 'ok', lat: hit.lat, lon: hit.lon, formattedAddress: hit.formatted_address };
    }
    if (hit.status === 'failed' && Date.now() - new Date(hit.created_at).getTime() < FAILED_RETRY_MS) {
      return { status: 'failed', lat: null, lon: null, formattedAddress: null };
    }
  }
  if (!env.GOOGLE_MAPS_API_KEY) {
    console.warn('geocode: GOOGLE_MAPS_API_KEY not set');
    return { status: 'error', lat: null, lon: null, formattedAddress: null };
  }
  const query = `${normalizeAddress(address)}, ${city ?? 'MONTGOMERY COUNTY'}, MD`;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('components', 'administrative_area:MD|country:US');
  url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);
  let result: GeocodeResult;
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
    const body = (await res.json()) as {
      status: string;
      results?: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number }; location_type?: string } }>;
    };
    const first = body.results?.[0];
    if (body.status === 'OK' && first && withinServiceArea(first.geometry.location.lat, first.geometry.location.lng)) {
      result = { status: 'ok', lat: first.geometry.location.lat, lon: first.geometry.location.lng, formattedAddress: first.formatted_address };
    } else if (body.status === 'OK' || body.status === 'ZERO_RESULTS') {
      result = { status: 'failed', lat: null, lon: null, formattedAddress: null };
    } else {
      console.warn('geocode: provider status', body.status);
      return { status: 'error', lat: null, lon: null, formattedAddress: null };
    }
  } catch (err) {
    console.warn('geocode: request failed', (err as Error).message);
    return { status: 'error', lat: null, lon: null, formattedAddress: null };
  }
  await sql`
    INSERT INTO geocode_cache (query_key, lat, lon, formatted_address, provider, status, created_at)
    VALUES (${key}, ${result.lat}, ${result.lon}, ${result.formattedAddress}, 'google', ${result.status}::geocode_status, now())
    ON CONFLICT (query_key) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, formatted_address = EXCLUDED.formatted_address,
      status = EXCLUDED.status, created_at = now()`;
  return result;
}
