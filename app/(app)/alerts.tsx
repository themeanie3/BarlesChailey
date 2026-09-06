import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Caption, Empty, Screen } from '../../src/components/ui';
import { useMyAlerts } from '../../src/hooks/useIncidents';
import { clockTime, timeAgo, titleCase } from '../../src/lib/format';
import { colors, spacing } from '../../src/theme';

export default function Alerts() {
  const q = useMyAlerts();
  return (
    <Screen>
      <FlatList
        data={q.data?.alerts ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.text} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={q.isPending ? null : <Empty title="No alerts yet" body="Alerts you've been paged for will show up here." />}
        renderItem={({ item }) => (
          <Pressable
            disabled={!item.incidentId}
            onPress={() => item.incidentId && router.push(`/(app)/incident/${item.incidentId}`)}
            style={({ pressed }) => [styles.item, { opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={styles.top}>
              <Text style={styles.kind}>{item.kind === 'test' ? 'TEST' : item.kind === 'upgrade' ? 'UPGRADE' : 'DISPATCH'}</Text>
              <Text style={styles.time}>{clockTime(item.sentAt)} · {timeAgo(item.sentAt)}</Text>
            </View>
            <Text style={styles.title}>{item.incident ? item.incident.callDescription || item.incident.callCode : 'Test alert'}</Text>
            {item.incident ? <Caption>{titleCase(item.incident.address)}{item.incident.city ? `, ${titleCase(item.incident.city)}` : ''}</Caption> : null}
            <Caption>
              {item.distanceMiles != null ? `${item.distanceMiles.toFixed(1)} mi · ` : ''}
              delivery {item.receiptStatus}{item.receiptError ? ` (${item.receiptError})` : ''}
            </Caption>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg },
  item: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  kind: { color: colors.primary, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 },
  time: { color: colors.textMuted, fontSize: 12 },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
});
