const R = 6371008.8;

/** Great-circle distance in meters. */
export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function metersToMiles(m: number): number {
  return m / 1609.344;
}

export function formatMiles(m: number | null | undefined): string | null {
  if (m == null || !Number.isFinite(m)) return null;
  const mi = metersToMiles(m);
  if (mi < 0.1) return '< 0.1 mi';
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}
