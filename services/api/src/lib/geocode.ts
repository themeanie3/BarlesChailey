import type { Env } from '../env';

export interface GeocodeResult {
  status: 'ok' | 'failed' | 'error';
  lat: number | null;
  lon: number | null;
  formattedAddress: string | null;
}

export interface GeocodeCacheEntry {
  lat: number | null;
  lon: number | null;
  formattedAddress: string | null;
  status: 'ok' | 'failed';
  createdAt: string;
}

/** Storage abstraction so the geocoder can be backed by the Durable Object (hot) or Postgres (cold). */
export interface GeocodeCache {
  get(key: string): Promise<GeocodeCacheEntry | null> | GeocodeCacheEntry | null;
  set(key: string, entry: GeocodeCacheEntry): Promise<void> | void;
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

interface GoogleGeocodeResponse {
  status: string;
  results?: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number }; location_type?: string } }>;
}

export async function geocodeAddress(env: Env, cache: GeocodeCache, address: string, city: string | null, fetchImpl: typeof fetch = fetch): Promise<GeocodeResult> {
  const key = geocodeQueryKey(address, city);
  const hit = await cache.get(key);
  if (hit) {
    if (hit.status === 'ok' && hit.lat != null && hit.lon != null) {
      return { status: 'ok', lat: hit.lat, lon: hit.lon, formattedAddress: hit.formattedAddress };
    }
    if (hit.status === 'failed' && Date.now() - new Date(hit.createdAt).getTime() < FAILED_RETRY_MS) {
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
    const res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
    const body = (await res.json()) as GoogleGeocodeResponse;
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
  await cache.set(key, { lat: result.lat, lon: result.lon, formattedAddress: result.formattedAddress, status: result.status as 'ok' | 'failed', createdAt: new Date().toISOString() });
  return result;
}

/** Postgres-backed cache for the cold path (archived incidents served straight from Neon). */
export function neonGeocodeCache(sql: import('./db').Sql): GeocodeCache {
  interface Row { lat: number | null; lon: number | null; formatted_address: string | null; status: 'ok' | 'failed' | 'pending'; created_at: string | Date }
  return {
    async get(key) {
      const rows = (await sql`SELECT lat, lon, formatted_address, status, created_at FROM geocode_cache WHERE query_key = ${key}`) as Row[];
      const r = rows[0];
      if (!r || r.status === 'pending') return null;
      return { lat: r.lat, lon: r.lon, formattedAddress: r.formatted_address, status: r.status, createdAt: new Date(r.created_at).toISOString() };
    },
    async set(key, e) {
      await sql`
        INSERT INTO geocode_cache (query_key, lat, lon, formatted_address, provider, status, created_at)
        VALUES (${key}, ${e.lat}, ${e.lon}, ${e.formattedAddress}, 'google', ${e.status}::geocode_status, ${e.createdAt}::timestamptz)
        ON CONFLICT (query_key) DO UPDATE SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, formatted_address = EXCLUDED.formatted_address,
          status = EXCLUDED.status, created_at = EXCLUDED.created_at`;
    },
  };
}
