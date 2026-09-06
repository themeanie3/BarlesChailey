import { StyleSheet, Text, View } from 'react-native';
import { timeAgo } from '../lib/format';
import { colors, spacing } from '../theme';

export function FeedBanner({ stale, lastPushAt, error }: { stale: boolean; lastPushAt: string | null; error?: string | null }) {
  if (error) return <View style={[styles.banner, { backgroundColor: '#7f1d1d' }]}><Text style={styles.text}>Can't reach the alert server · {error}</Text></View>;
  if (!stale) return null;
  return (
    <View style={[styles.banner, { backgroundColor: '#78350f' }]}>
      <Text style={styles.text}>Station feed is stale{lastPushAt ? ` · last update ${timeAgo(lastPushAt)}` : ''}. The board may be out of date.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  text: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
