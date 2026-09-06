import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing } from '../theme';

export function Screen({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children, style }: PropsWithChildren<{ style?: StyleProp<TextStyle> }>) {
  return <Text style={[font.title, style]}>{children}</Text>;
}
export function Heading({ children, style }: PropsWithChildren<{ style?: StyleProp<TextStyle> }>) {
  return <Text style={[font.heading, style]}>{children}</Text>;
}
export function Body({ children, style, numberOfLines }: PropsWithChildren<{ style?: StyleProp<TextStyle>; numberOfLines?: number }>) {
  return <Text style={[font.body, style]} numberOfLines={numberOfLines}>{children}</Text>;
}
export function Caption({ children, style }: PropsWithChildren<{ style?: StyleProp<TextStyle> }>) {
  return <Text style={[font.caption, style]}>{children}</Text>;
}

export function Button({
  title, onPress, variant = 'primary', disabled, loading, style, icon,
}: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; icon?: ReactNode;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? '#7f1d1d' : variant === 'secondary' ? colors.surfaceRaised : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, variant === 'ghost' && styles.ghost, style]}
    >
      {loading ? <ActivityIndicator color={colors.text} /> : (
        <View style={styles.buttonInner}>
          {icon}
          <Text style={[styles.buttonText, variant === 'ghost' && { color: colors.textMuted }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Pill({ label, color, active = true, onPress }: { label: string; color?: string; active?: boolean; onPress?: () => void }) {
  const c = color ?? colors.textMuted;
  const inner = (
    <View style={[styles.pill, { borderColor: c, backgroundColor: active ? `${c}33` : 'transparent', opacity: active ? 1 : 0.55 }]}>
      <Text style={[styles.pillText, { color: active ? colors.text : colors.textMuted }]}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{inner}</Pressable> : inner;
}

export function Row({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Heading style={{ textAlign: 'center' }}>{title}</Heading>
      {body ? <Caption style={{ textAlign: 'center', marginTop: spacing.sm }}>{body}</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  button: { minHeight: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonText: { color: colors.primaryText, fontSize: 17, fontWeight: '700' },
  ghost: { minHeight: 40 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  empty: { padding: spacing.xxl, alignItems: 'center' },
});
