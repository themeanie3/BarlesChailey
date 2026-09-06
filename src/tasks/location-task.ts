import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { api } from '../lib/api';
import { haversineMeters } from '../lib/geo';
import { KEYS, storage } from '../lib/storage';

export const LOCATION_TASK = 'bc-background-location';

interface LastSent { lat: number; lon: number; at: number }

/** Skip uploads that would not change any alert decision: < 200 m moved and < 10 min old. Always send after 15 min. */
export function shouldSend(last: LastSent | null, lat: number, lon: number, now: number): boolean {
  if (!last) return true;
  const age = now - last.at;
  if (age > 15 * 60_000) return true;
  if (age < 10 * 60_000 && haversineMeters(last.lat, last.lon, lat, lon) < 200) return false;
  return true;
}

export async function reportLocation(loc: Location.LocationObject, force = false): Promise<boolean> {
  const deviceId = await storage.get(KEYS.deviceId);
  if (!deviceId) return false;
  const { latitude: lat, longitude: lon, accuracy, speed } = loc.coords;
  const now = Date.now();
  const last = await storage.getJSON<LastSent>(KEYS.lastLocationSent);
  if (!force && !shouldSend(last, lat, lon, now)) return false;
  try {
    await api.reportLocation(deviceId, {
      lat, lon, accuracyM: accuracy ?? null, speedMps: speed ?? null, recordedAt: new Date(loc.timestamp).toISOString(),
    });
    await storage.setJSON(KEYS.lastLocationSent, { lat, lon, at: now } satisfies LastSent);
    return true;
  } catch (err) {
    console.warn('reportLocation failed', (err as Error).message);
    return false;
  }
}

// Must be defined at module scope so iOS can wake the app into it.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('location task error', error.message);
    return;
  }
  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  const latest = locations?.[locations.length - 1];
  if (latest) await reportLocation(latest);
});

export type LocationMode = 'always' | 'when-in-use' | 'denied';

/** Request permissions and start background updates. Returns the mode we ended up with. */
export async function startLocationTracking(): Promise<LocationMode> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return 'when-in-use';
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (!running) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 250,
      timeInterval: 120_000,
      deferredUpdatesDistance: 500,
      deferredUpdatesInterval: 180_000,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'BarlesChailey',
        notificationBody: 'Watching for serious calls near you',
        killServiceOnDestroy: false,
      },
    });
  }
  return 'always';
}

export async function stopLocationTracking(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

/** One immediate fix (used on app open and for "use current location"). */
export async function currentFix(): Promise<Location.LocationObject | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
    if (last) return last;
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    return null;
  }
}
