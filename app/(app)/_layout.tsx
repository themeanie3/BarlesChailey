import { Redirect, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { authClient } from '../../src/lib/auth-client';
import { registerForPush, type PushStatus } from '../../src/lib/push';
import { currentFix, reportLocation, startLocationTracking, type LocationMode } from '../../src/tasks/location-task';
import { useMe } from '../../src/hooks/useMe';
import { ApiError } from '../../src/lib/api';
import { colors } from '../../src/theme';
import { createContext, useContext } from 'react';

export interface DeviceState {
  push: PushStatus | null;
  locationMode: LocationMode | null;
  refresh: () => Promise<void>;
}
const DeviceContext = createContext<DeviceState>({ push: null, locationMode: null, refresh: async () => {} });
export const useDeviceState = () => useContext(DeviceContext);

/**
 * Everything behind sign-in. Registers the device for push and background
 * location once the membership is active, and re-syncs when the app returns
 * to the foreground.
 */
export default function AppLayout() {
  const { data: session, isPending } = authClient.useSession();
  const me = useMe(Boolean(session));
  const [push, setPush] = useState<PushStatus | null>(null);
  const [locationMode, setLocationMode] = useState<LocationMode | null>(null);
  const bootstrapped = useRef(false);

  const active = me.data?.member.status === 'active';

  const refresh = async () => {
    const p = await registerForPush();
    setPush(p);
    const mode = await startLocationTracking();
    setLocationMode(mode);
    if (mode !== 'denied') {
      const fix = await currentFix();
      if (fix) await reportLocation(fix, true);
    }
  };

  useEffect(() => {
    if (!active || bootstrapped.current) return;
    bootstrapped.current = true;
    refresh().catch((err) => console.warn('bootstrap failed', err));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        me.refetch();
        currentFix().then((fix) => fix && reportLocation(fix)).catch(() => {});
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (isPending || (session && me.isPending)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (me.error instanceof ApiError && me.error.status === 401) return <Redirect href="/(auth)/sign-in" />;

  return (
    <DeviceContext.Provider value={{ push, locationMode, refresh }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Board' }} />
        <Stack.Screen name="incident/[id]" options={{ title: 'Incident', headerBackTitle: 'Board' }} />
        <Stack.Screen name="alerts" options={{ title: 'My alerts' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="pending" options={{ title: 'Awaiting approval' }} />
      </Stack>
    </DeviceContext.Provider>
  );
}
