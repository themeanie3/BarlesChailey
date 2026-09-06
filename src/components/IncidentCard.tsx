import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Incident } from '@barleschailey/feed';
import { formatMiles, haversineMeters } from '../lib/geo';
import { CATEGORY_LABEL, clockTime, timeAgo, titleCase } from '../lib/format';
import { categoryColor, colors, radius, severityColor, spacing } from '../theme';

interface Props {
  incident: Incident;
  me: { lat: number; lon: number } | null;
  onPress: () => void;
}

export const IncidentCard = memo(function IncidentCard({ incident, me, onPress }: Props) {
  const c = incident.call;
  const stripe = categoryColor[c.category];
  const dist = me && incident.location ? formatMiles(haversineMeters(me.lat, me.lon, incident.location.lat, incident.location.lon)) : null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}>
      <View style={[styles.stripe, { backgroundColor: stripe }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={[styles.code, { color: stripe }]}>{c.code}</Text>
          {c.alertable ? <View style={[styles.sev, { backgroundColor: severityColor[c.severity] }]}><Text style={styles.sevText}>{c.severity.toUpperCase()}</Text></View> : null}
          <View style={{ flex: 1 }} />
          <Text style={styles.time}>{clockTime(incident.dispatchedAt)} · {timeAgo(incident.dispatchedAt)}</Text>
        </View>
        <Text style={styles.desc} numberOfLines={1}>{c.description || CATEGORY_LABEL[c.category]}</Text>
        <Text style={styles.addr} numberOfLines={2}>{titleCase(incident.address)}{incident.city ? `, ${titleCase(incident.city)}` : ''}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>Box {incident.box ?? '—'}</Text>
          {dist ? <Text style={[styles.meta, { color: colors.text, fontWeight: '700' }]}>{dist}</Text> : null}
          <Text style={[styles.meta, { flex: 1 }]} numberOfLines={1}>{incident.units.length ? incident.units.join(' ') : 'units pending'}</Text>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  stripe: { width: 6 },
  body: { flex: 1, padding: spacing.md, gap: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  code: { fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  sev: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  sevText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  time: { color: colors.textMuted, fontSize: 12 },
  desc: { color: colors.text, fontSize: 17, fontWeight: '700' },
  addr: { color: colors.text, fontSize: 15 },
  metaRow: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  meta: { color: colors.textMuted, fontSize: 13, fontFamily: 'Menlo' },
});
