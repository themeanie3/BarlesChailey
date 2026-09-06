import { Redirect, router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FeedBanner } from '../../src/components/FeedBanner';
import { IncidentCard } from '../../src/components/IncidentCard';
import { Caption, Empty, Pill } from '../../src/components/ui';
import { useActiveIncidents, useFeedStatus } from '../../src/hooks/useIncidents';
import { useMe } from '../../src/hooks/useMe';
import { ApiError } from '../../src/lib/api';
import { currentFix } from '../../src/tasks/location-task';
import { colors, spacing } from '../../src/theme';
import { useDeviceState } from './_layout';

type Filter = 'alertable' | 'all';

export default function Board() {
  const me = useMe();
  const status = me.data?.member.status;
  const isAdmin = me.data?.member.role === 'admin';
  const [filter, setFilter] = useState<Filter>('alertable');
  const incidents = useActiveIncidents(isAdmin);
  const feed = useFeedStatus();
  const device = useDeviceState();
  const [myPos, setMyPos] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    currentFix().then((f) => f && setMyPos({ lat: f.coords.latitude, lon: f.coords.longitude })).catch(() => {});
  }, []);

  const data = useMemo(() => {
    const list = incidents.data?.incidents ?? [];
    return filter === 'all' ? list : list.filter((i) => i.call.alertable);
  }, [incidents.data, filter]);

  if (status && status !== 'active') return <Redirect href="/(app)/pending" />;

  const apiError = incidents.error instanceof ApiError ? incidents.error.message : incidents.error ? 'network' : null;
  const permissionsProblem = device.push?.granted === false || device.locationMode === 'denied' || device.locationMode === 'when-in-use';

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Board',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              <Pressable onPress={() => router.push('/(app)/alerts')} hitSlop={10}><Text style={styles.headerLink}>Alerts</Text></Pressable>
              <Pressable onPress={() => router.push('/(app)/settings')} hitSlop={10}><Text style={styles.headerLink}>Settings</Text></Pressable>
            </View>
          ),
        }}
      />
      <FeedBanner stale={feed.data?.stale ?? false} lastPushAt={feed.data?.lastPushAt ?? null} error={apiError} />
      {permissionsProblem ? (
        <Pressable onPress={() => router.push('/(app)/settings')} style={styles.warn}>
          <Text style={styles.warnText}>
            {device.push?.granted === false ? 'Notifications are off. ' : ''}
            {device.locationMode === 'denied' ? 'Location is off. ' : device.locationMode === 'when-in-use' ? 'Location is not set to "Always". ' : ''}
            You won't be paged. Tap to fix.
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.filters}>
        <Pill label="Serious calls" active={filter === 'alertable'} color={colors.primary} onPress={() => setFilter('alertable')} />
        <Pill label="Everything" active={filter === 'all'} onPress={() => setFilter('all')} />
        <View style={{ flex: 1 }} />
        <Caption>{feed.data ? `${feed.data.activeIncidents} active` : ''}</Caption>
      </View>
      <FlatList
        data={data}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <IncidentCard incident={item} me={myPos} onPress={() => router.push(`/(app)/incident/${item.id}`)} />}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={<RefreshControl refreshing={incidents.isRefetching} onRefresh={() => { incidents.refetch(); feed.refetch(); }} tintColor={colors.text} />}
        ListEmptyComponent={
          incidents.isPending ? null : (
            <Empty title={filter === 'alertable' ? 'No serious calls right now' : 'Board is clear'} body={filter === 'alertable' ? 'Switch to "Everything" to see routine calls.' : 'Pull down to refresh.'} />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerLink: { color: colors.text, fontSize: 16, fontWeight: '600' },
  filters: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  list: { padding: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  warn: { backgroundColor: '#3f1d1d', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  warnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
