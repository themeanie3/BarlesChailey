import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppleMaps, GoogleMaps } from 'expo-maps';
import type { IncidentEvent } from '@barleschailey/feed';
import { Body, Button, Caption, Card, Divider, Heading, Pill, Row, Screen, Title } from '../../../src/components/ui';
import { useIncident } from '../../../src/hooks/useIncidents';
import { CATEGORY_LABEL, SEVERITY_LABEL, clockTime, timeAgo, titleCase } from '../../../src/lib/format';
import { formatMiles, haversineMeters } from '../../../src/lib/geo';
import { currentFix } from '../../../src/tasks/location-task';
import { categoryColor, colors, severityColor, spacing } from '../../../src/theme';

function describeEvent(e: IncidentEvent): string {
  const d = e.data as Record<string, any>;
  switch (e.kind) {
    case 'created': return `Dispatched as ${d.code ?? ''}${d.units?.length ? ` · ${d.units.join(' ')}` : ''}`;
    case 'call_type_changed': return `Call type ${d.from?.code} → ${d.to?.code} (${d.to?.description ?? ''})`;
    case 'units_changed': {
      const parts = [] as string[];
      if (d.added?.length) parts.push(`+${d.added.join(' +')}`);
      if (d.removed?.length) parts.push(`−${d.removed.join(' −')}`);
      return `Units ${parts.join(' ') || 'changed'}`;
    }
    case 'geocoded': return `Located: ${d.formattedAddress ?? ''}`;
    case 'cleared': return d.reason === 'stale' ? 'Closed (feed stale)' : 'Cleared';
    case 'reopened': return 'Back on the board';
    default: return e.kind;
  }
}

async function openNavigation(lat: number, lon: number, label: string) {
  const enc = encodeURIComponent(label);
  const candidates: Array<{ name: string; url: string; fallback?: string }> = [
    { name: 'Apple Maps', url: `maps://?daddr=${lat},${lon}&dirflg=d`, fallback: `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d` },
    { name: 'Google Maps', url: `comgooglemaps://?daddr=${lat},${lon}&directionsmode=driving`, fallback: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving` },
    { name: 'Waze', url: `waze://?ll=${lat},${lon}&navigate=yes`, fallback: `https://waze.com/ul?ll=${lat},${lon}&navigate=yes` },
  ];
  const available = [] as typeof candidates;
  for (const c of candidates) if (await Linking.canOpenURL(c.url).catch(() => false)) available.push(c);
  const open = (c: (typeof candidates)[number]) => Linking.openURL(c.url).catch(() => c.fallback && Linking.openURL(c.fallback));
  if (available.length === 1) return open(available[0]!);
  if (available.length === 0) return Linking.openURL(candidates[0]!.fallback!);
  Alert.alert(`Navigate to ${enc ? label : 'incident'}`, undefined, [
    ...available.map((c) => ({ text: c.name, onPress: () => open(c) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

export default function IncidentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useIncident(id);
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    currentFix().then((f) => f && setMe({ lat: f.coords.latitude, lon: f.coords.longitude })).catch(() => {});
  }, []);

  const inc = q.data?.incident;
  if (!inc) {
    return (
      <Screen style={{ padding: spacing.xl }}>
        <Stack.Screen options={{ title: 'Incident' }} />
        {q.error ? <Body>Could not load this incident.</Body> : <Caption>Loading…</Caption>}
      </Screen>
    );
  }
  const c = inc.call;
  const color = categoryColor[c.category];
  const loc = inc.location;
  const dist = me && loc ? formatMiles(haversineMeters(me.lat, me.lon, loc.lat, loc.lon)) : null;
  const place = `${titleCase(inc.address)}${inc.city ? `, ${titleCase(inc.city)}` : ''}`;

  return (
    <Screen>
      <Stack.Screen options={{ title: c.code }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, { borderLeftColor: color }]}>
          <Row style={{ flexWrap: 'wrap' }}>
            <Pill label={CATEGORY_LABEL[c.category]} color={color} />
            {c.alertable ? <Pill label={SEVERITY_LABEL[c.severity]} color={severityColor[c.severity]} /> : null}
            <Pill label={inc.status === 'active' ? 'ACTIVE' : 'CLEARED'} color={inc.status === 'active' ? colors.success : colors.textDim} />
          </Row>
          <Title style={{ marginTop: spacing.sm }}>{c.description || c.code}</Title>
          <Body style={{ fontSize: 17 }}>{place}</Body>
          <Caption>
            Dispatched {clockTime(inc.dispatchedAt)} · {timeAgo(inc.dispatchedAt)} · Box {inc.box ?? '—'}{inc.station ? ` · Station ${inc.station}` : ''}{inc.battalion ? ` · Batt ${inc.battalion}` : ''}
          </Caption>
          {dist ? <Text style={styles.dist}>{dist} from you</Text> : null}
        </View>

        {loc ? (
          <View style={styles.map}>
            {Platform.OS === 'ios' ? (
              <AppleMaps.View
                style={StyleSheet.absoluteFill}
                cameraPosition={{ coordinates: { latitude: loc.lat, longitude: loc.lon }, zoom: 14 }}
                markers={[{ coordinates: { latitude: loc.lat, longitude: loc.lon }, title: c.description || c.code, tintColor: color }]}
                uiSettings={{ myLocationButtonEnabled: false }}
                properties={{ isTrafficEnabled: true }}
              />
            ) : (
              <GoogleMaps.View
                style={StyleSheet.absoluteFill}
                cameraPosition={{ coordinates: { latitude: loc.lat, longitude: loc.lon }, zoom: 14 }}
                markers={[{ coordinates: { latitude: loc.lat, longitude: loc.lon }, title: c.description || c.code }]}
              />
            )}
          </View>
        ) : (
          <Card><Caption>No map position yet{inc.location === null && inc.status === 'active' ? ' — geocoding pending' : ''}.</Caption></Card>
        )}

        {loc ? <Button title="Navigate" onPress={() => openNavigation(loc.lat, loc.lon, place)} /> : null}

        <Card style={{ gap: spacing.sm }}>
          <Heading>Units</Heading>
          {inc.units.length ? (
            <Row style={{ flexWrap: 'wrap' }}>{inc.units.map((u) => <Pill key={u} label={u} color={colors.info} />)}</Row>
          ) : <Caption>No units assigned yet.</Caption>}
        </Card>

        <Card>
          <Heading>Timeline</Heading>
          <Divider />
          {(q.data?.events ?? []).map((e) => (
            <View key={e.id} style={styles.event}>
              <Text style={styles.eventTime}>{clockTime(e.at)}</Text>
              <Body style={{ flex: 1 }}>{describeEvent(e)}</Body>
            </View>
          ))}
        </Card>
        <Caption style={{ textAlign: 'center' }}>Source {inc.source} · v{inc.version} · updated {timeAgo(inc.updatedAt)}</Caption>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  hero: { borderLeftWidth: 6, paddingLeft: spacing.md, gap: 4 },
  dist: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: spacing.xs },
  map: { height: 240, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
  event: { flexDirection: 'row', gap: spacing.md, paddingVertical: 6 },
  eventTime: { color: colors.textMuted, fontFamily: 'Menlo', fontSize: 13, width: 48 },
});
