import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';
import { config } from './config';
import { KEYS, storage } from './storage';

/** Foreground presentation: always show and sound the alert, even with the app open. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export interface PushStatus {
  granted: boolean;
  criticalAuthorized: boolean;
  token: string | null;
  deviceId: string | null;
  error?: string;
}

async function ensureCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync('incident', [
    { identifier: 'navigate', buttonTitle: 'Navigate', options: { opensAppToForeground: true } },
    { identifier: 'view', buttonTitle: 'Details', options: { opensAppToForeground: true } },
  ]);
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Dispatch alerts',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 400, 200, 400],
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
}

/**
 * Ask for notification permission (including iOS critical alerts when the build
 * carries the entitlement), fetch the Expo push token, and register the device
 * with the API. Safe to call on every app start; the server upserts.
 */
export async function registerForPush(): Promise<PushStatus> {
  if (!Device.isDevice) return { granted: false, criticalAuthorized: false, token: null, deviceId: null, error: 'simulator' };
  await ensureCategories();
  const existing = await Notifications.getPermissionsAsync();
  let perms = existing;
  if (existing.status !== 'granted' || (config.criticalAlerts && existing.ios?.allowsCriticalAlerts === false)) {
    perms = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true, allowCriticalAlerts: config.criticalAlerts },
    });
  }
  if (perms.status !== 'granted') return { granted: false, criticalAuthorized: false, token: null, deviceId: null };
  const criticalAuthorized = perms.ios?.allowsCriticalAlerts === true;
  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync(config.easProjectId ? { projectId: config.easProjectId } : undefined)).data;
  } catch (err) {
    return { granted: true, criticalAuthorized, token: null, deviceId: null, error: `push token: ${(err as Error).message}` };
  }
  try {
    const { device } = await api.registerDevice({
      expoPushToken: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      appVersion: `${config.appVersion}+${config.appEnv}`,
      deviceName: Device.deviceName ?? undefined,
      criticalAlertsAuthorized: criticalAuthorized,
    });
    await storage.set(KEYS.deviceId, device.id);
    return { granted: true, criticalAuthorized, token, deviceId: device.id };
  } catch (err) {
    return { granted: true, criticalAuthorized, token, deviceId: await storage.get(KEYS.deviceId), error: `register: ${(err as Error).message}` };
  }
}
