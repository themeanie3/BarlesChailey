import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { AlertPreferences, IncidentCategory, Severity } from '@barleschailey/feed';
import { Body, Button, Caption, Card, Divider, Heading, Pill, Row, Screen } from '../../src/components/ui';
import { useMe, useUpdatePreferences } from '../../src/hooks/useMe';
import { api } from '../../src/lib/api';
import { signOutEverywhere } from '../../src/lib/auth-client';
import { config } from '../../src/lib/config';
import { CATEGORY_LABEL, SEVERITY_LABEL } from '../../src/lib/format';
import { KEYS, storage } from '../../src/lib/storage';
import { currentFix, stopLocationTracking } from '../../src/tasks/location-task';
import { categoryColor, colors, severityColor, spacing } from '../../src/theme';
import { useDeviceState } from './_layout';

const CATEGORIES: IncidentCategory[] = ['fire', 'rescue', 'ems', 'hazmat'];
const SEVERITIES: Severity[] = ['normal', 'high', 'critical'];
const RADII = [1, 2, 3, 5, 8, 10, 15, 25];

function Stepper({ value, options, onChange, unit }: { value: number; options: number[]; onChange: (v: number) => void; unit: string }) {
  return (
    <Row style={{ flexWrap: 'wrap' }}>
      {options.map((o) => <Pill key={o} label={`${o} ${unit}`} active={o === value} color={colors.info} onPress={() => onChange(o)} />)}
    </Row>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        {hint ? <Caption>{hint}</Caption> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

export default function Settings() {
  const me = useMe();
  const update = useUpdatePreferences();
  const device = useDeviceState();
  const prefs = me.data?.preferences;
  const isAdmin = me.data?.member.role === 'admin';
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setQuietStart(prefs?.quietHours?.start ?? '');
    setQuietEnd(prefs?.quietHours?.end ?? '');
  }, [prefs?.quietHours?.start, prefs?.quietHours?.end]);

  if (!prefs) return <Screen style={{ padding: spacing.xl }}><Caption>Loading…</Caption></Screen>;

  const save = (patch: Partial<AlertPreferences>) => update.mutate(patch, { onError: (e) => Alert.alert('Could not save', (e as Error).message) });

  const toggleCategory = (cat: IncidentCategory) => {
    const current = prefs.categories.length ? prefs.categories : CATEGORIES;
    const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat];
    if (!next.length) return Alert.alert('Pick at least one category');
    save({ categories: next.length === CATEGORIES.length ? [] : next });
  };

  const saveQuiet = () => {
    if (!quietStart && !quietEnd) return save({ quietHours: null });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(quietStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quietEnd)) return Alert.alert('Use HH:MM, e.g. 23:00');
    save({ quietHours: { start: quietStart, end: quietEnd, allowCritical: prefs.quietHours?.allowCritical ?? true } });
  };

  const snooze = (hours: number | null) => save({ snoozeUntil: hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null });

  const setHome = async () => {
    setBusy('home');
    const fix = await currentFix();
    setBusy(null);
    if (!fix) return Alert.alert('Could not get your location');
    save({ home: { lat: fix.coords.latitude, lon: fix.coords.longitude, radiusMiles: prefs.home?.radiusMiles ?? prefs.radiusMiles, label: 'Home' } });
  };

  const testAlert = async () => {
    const deviceId = device.push?.deviceId ?? (await storage.get(KEYS.deviceId));
    if (!deviceId) return Alert.alert('Device not registered yet', device.push?.error ?? 'Grant notification permission first.');
    setBusy('test');
    try {
      const r = await api.testAlert(deviceId);
      Alert.alert('Sent', r.critical ? 'A critical test alert is on its way.' : 'A test alert is on its way (standard sound).');
    } catch (e) {
      Alert.alert('Test failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const simulate = async () => {
    setBusy('sim');
    try {
      const fix = await currentFix();
      if (!fix) throw new Error('no location fix');
      const r = await api.admin.simulate({ lat: fix.coords.latitude + 0.004, lon: fix.coords.longitude, code: 'HOUSE', address: 'SIMULATED HOUSE FIRE' });
      Alert.alert('Simulation ran', `${r.alerts.candidates} in range · ${r.alerts.sent} paged · ${r.alerts.skipped} skipped · ${r.alerts.errors} errors`);
    } catch (e) {
      Alert.alert('Simulation failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    await stopLocationTracking().catch(() => {});
    await signOutEverywhere();
    router.replace('/(auth)/sign-in');
  };

  const snoozed = prefs.snoozeUntil && new Date(prefs.snoozeUntil).getTime() > Date.now();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ gap: spacing.sm }}>
          <Heading>Permissions</Heading>
          <StatusLine ok={device.push?.granted === true} label="Notifications" detail={device.push?.granted ? (device.push.criticalAuthorized ? 'critical alerts on' : config.criticalAlerts ? 'critical alerts not granted' : 'standard') : 'off'} />
          <StatusLine ok={device.locationMode === 'always'} label="Location" detail={device.locationMode === 'always' ? 'Always' : device.locationMode === 'when-in-use' ? 'While using only — set to Always' : device.locationMode === 'denied' ? 'denied' : 'checking'} />
          {device.push?.error ? <Caption style={{ color: colors.warning }}>{device.push.error}</Caption> : null}
          <Row>
            <Button title="Re-check" variant="secondary" onPress={() => device.refresh()} style={{ flex: 1 }} />
            <Button title="Open iOS Settings" variant="secondary" onPress={() => Linking.openSettings()} style={{ flex: 1 }} />
          </Row>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <Heading>Alerts</Heading>
          <Toggle label="Page me for nearby serious calls" value={prefs.enabled} onChange={(v) => save({ enabled: v })} />
          <Divider />
          <Body>Radius from my phone</Body>
          <Stepper value={Number(prefs.radiusMiles)} options={RADII} unit="mi" onChange={(v) => save({ radiusMiles: v })} />
          <Divider />
          <Body>Call types</Body>
          <Row style={{ flexWrap: 'wrap' }}>
            {CATEGORIES.map((c) => (
              <Pill key={c} label={CATEGORY_LABEL[c]} color={categoryColor[c]} active={!prefs.categories.length || prefs.categories.includes(c)} onPress={() => toggleCategory(c)} />
            ))}
          </Row>
          <Divider />
          <Body>Minimum seriousness</Body>
          <Row style={{ flexWrap: 'wrap' }}>
            {SEVERITIES.map((s) => <Pill key={s} label={SEVERITY_LABEL[s]} color={severityColor[s]} active={prefs.minSeverity === s} onPress={() => save({ minSeverity: s })} />)}
          </Row>
          <Caption>"Serious" = ALS-2 medicals, entrapments, chimney and vehicle fires. "Critical" = structure fires, cardiac arrests, shootings, technical rescues.</Caption>
          <Divider />
          <Toggle label="Also page me on upgrades" hint="e.g. a box alarm going to a working fire" value={prefs.alertOnUpgrade} onChange={(v) => save({ alertOnUpgrade: v })} />
        </Card>

        <Card style={{ gap: spacing.md }}>
          <Heading>Home / station</Heading>
          <Caption>Always checked, even if your phone's location is stale. Useful when you're at home with the phone on the charger.</Caption>
          {prefs.home ? (
            <>
              <Body>{prefs.home.label ?? 'Home'} · {prefs.home.lat.toFixed(4)}, {prefs.home.lon.toFixed(4)}</Body>
              <Stepper value={Number(prefs.home.radiusMiles)} options={RADII} unit="mi" onChange={(v) => save({ home: { ...prefs.home!, radiusMiles: v } })} />
              <Row>
                <Button title="Use current location" variant="secondary" onPress={setHome} loading={busy === 'home'} style={{ flex: 1 }} />
                <Button title="Remove" variant="ghost" onPress={() => save({ home: null })} />
              </Row>
            </>
          ) : (
            <Button title="Set home to my current location" variant="secondary" onPress={setHome} loading={busy === 'home'} />
          )}
        </Card>

        <Card style={{ gap: spacing.md }}>
          <Heading>Quiet hours and snooze</Heading>
          <Row>
            <TextInput style={styles.input} placeholder="23:00" placeholderTextColor={colors.textDim} value={quietStart} onChangeText={setQuietStart} keyboardType="numbers-and-punctuation" />
            <Text style={{ color: colors.textMuted }}>to</Text>
            <TextInput style={styles.input} placeholder="06:30" placeholderTextColor={colors.textDim} value={quietEnd} onChangeText={setQuietEnd} keyboardType="numbers-and-punctuation" />
            <Button title="Save" variant="secondary" onPress={saveQuiet} />
          </Row>
          {prefs.quietHours ? (
            <Toggle label="Critical calls still break through quiet hours" value={prefs.quietHours.allowCritical} onChange={(v) => save({ quietHours: { ...prefs.quietHours!, allowCritical: v } })} />
          ) : <Caption>Leave blank for no quiet hours.</Caption>}
          <Divider />
          <Body>{snoozed ? `Snoozed until ${new Date(prefs.snoozeUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Snooze (e.g. while on shift)'}</Body>
          <Row style={{ flexWrap: 'wrap' }}>
            {[1, 4, 12, 24].map((h) => <Pill key={h} label={`${h} h`} color={colors.warning} active={false} onPress={() => snooze(h)} />)}
            {snoozed ? <Pill label="Clear" color={colors.success} onPress={() => snooze(null)} /> : null}
          </Row>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <Heading>Test</Heading>
          <Button title="Send me a test alert" variant="secondary" onPress={testAlert} loading={busy === 'test'} />
          {isAdmin ? <Button title="Simulate a house fire near me" variant="secondary" onPress={simulate} loading={busy === 'sim'} /> : null}
          <Caption>Server: {me.data?.server.env} · {me.data?.server.criticalSoundEnabled ? 'critical sound on' : `interruption level ${me.data?.server.interruptionLevel}`} · app {config.appVersion} ({config.appEnv})</Caption>
        </Card>

        {isAdmin ? <AdminMembers /> : null}

        <Card style={{ gap: spacing.sm }}>
          <Body>{me.data?.user.name ?? me.data?.user.email}</Body>
          <Caption>{me.data?.user.email} · {me.data?.member.role}</Caption>
          <Button title="Sign out" variant="danger" onPress={signOut} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function StatusLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <Row>
      <View style={[styles.dot, { backgroundColor: ok ? colors.success : colors.danger }]} />
      <Body style={{ fontWeight: '600' }}>{label}</Body>
      <Caption>{detail}</Caption>
    </Row>
  );
}

function AdminMembers() {
  const [members, setMembers] = useState<Awaited<ReturnType<typeof api.admin.members>>['members']>([]);
  const [email, setEmail] = useState('');
  const load = () => api.admin.members().then((r) => setMembers(r.members)).catch(() => {});
  useEffect(() => { load(); }, []);
  const set = (e: string, patch: Parameters<typeof api.admin.setMember>[1]) => api.admin.setMember(e, patch).then(load).catch((err) => Alert.alert('Failed', (err as Error).message));
  return (
    <Card style={{ gap: spacing.sm }}>
      <Heading>Members</Heading>
      <Row>
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="invite@email.com" placeholderTextColor={colors.textDim} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <Button title="Invite" variant="secondary" onPress={() => email.trim() && set(email.trim(), { status: 'active' }).then(() => setEmail(''))} />
      </Row>
      {members.map((m) => (
        <View key={m.email} style={styles.memberRow}>
          <View style={{ flex: 1 }}>
            <Body>{m.displayName ?? m.email}</Body>
            <Caption>{m.email} · {m.role} · {m.status} · {m.devices} device{m.devices === 1 ? '' : 's'}</Caption>
          </View>
          {m.status === 'pending' ? <Pill label="Approve" color={colors.success} onPress={() => set(m.email, { status: 'active' })} /> : null}
          {m.status === 'active' ? <Pill label="Revoke" color={colors.danger} active={false} onPress={() => Alert.alert('Revoke access?', m.email, [{ text: 'Cancel', style: 'cancel' }, { text: 'Revoke', style: 'destructive', onPress: () => set(m.email, { status: 'revoked' }) }])} /> : null}
          {m.status === 'revoked' ? <Pill label="Restore" color={colors.info} onPress={() => set(m.email, { status: 'active' })} /> : null}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  input: { backgroundColor: colors.surfaceRaised, color: colors.text, borderRadius: 10, paddingHorizontal: spacing.md, minHeight: 44, minWidth: 84, fontSize: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
