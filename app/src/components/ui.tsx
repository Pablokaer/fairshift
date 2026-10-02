// Small, accessible UI kit: 48pt touch targets, screen-reader roles/labels,
// text that scales with the system font size, AA-contrast colors.
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, space, useTheme } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['bottom'],
  refreshControl,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  refreshControl?: ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  const c = useTheme();
  const inner = <View style={[padded && styles.padded, styles.maxWidth]}>{children}</View>;
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.h1, { color: c.text }, style]}>
      {children}
    </Text>
  );
}

export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" aria-level={2} style={[styles.h2, { color: c.text }, style]}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted,
  style,
  ...rest
}: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle> } & ComponentProps<typeof Text>) {
  const c = useTheme();
  return (
    <Text {...rest} style={[styles.body, { color: muted ? c.textMuted : c.text }, style]}>
      {children}
    </Text>
  );
}

export function Small({ children, muted = true, style }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle> }) {
  const c = useTheme();
  return <Text style={[styles.small, { color: muted ? c.textMuted : c.text }, style]}>{children}</Text>;
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  accessibilityHint,
  accessibilityLabel,
  style,
  testID,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const c = useTheme();
  const palette: Record<Variant, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.surface, fg: c.primary, border: c.primary },
    danger: { bg: c.danger, fg: c.onDanger, border: c.danger },
    ghost: { bg: 'transparent', fg: c.primary, border: 'transparent' },
  };
  const p = palette[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: p.bg, borderColor: p.border, opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={20} color={p.fg} style={{ marginRight: space.sm }} /> : null}
          <Text style={[styles.buttonText, { color: p.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useTheme();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>
      {children}
    </View>
  );
}

export function Field({
  label,
  error,
  hint,
  ...input
}: { label: string; error?: string | null; hint?: string } & TextInputProps) {
  const c = useTheme();
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[styles.label, { color: c.text }]} nativeID={`label-${label}`}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        aria-labelledby={`label-${label}`}
        placeholderTextColor={c.textMuted}
        {...input}
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.surface, borderColor: error ? c.danger : c.border },
          input.multiline && { minHeight: 96, textAlignVertical: 'top' },
          input.style,
        ]}
      />
      {hint && !error ? <Small>{hint}</Small> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.small, { color: c.danger }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Banner({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  const c = useTheme();
  const color = { info: c.info, error: c.danger, success: c.success, warning: c.warning }[kind];
  const icon: IconName = { info: 'information-circle', error: 'alert-circle', success: 'checkmark-circle', warning: 'warning' }[
    kind
  ] as IconName;
  return (
    <View
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.banner, { borderColor: color, backgroundColor: c.surface }]}
    >
      <Ionicons name={icon} size={20} color={color} style={{ marginRight: space.sm, marginTop: 2 }} />
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <Body>{children}</Body> : children}</View>
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'waiting' | 'paused' | 'offered' | 'assigned' | 'neutral' }) {
  const c = useTheme();
  const map = {
    waiting: [c.badgeWaitingBg, c.badgeWaitingText],
    paused: [c.badgePausedBg, c.badgePausedText],
    offered: [c.badgeOfferedBg, c.badgeOfferedText],
    assigned: [c.badgeAssignedBg, c.badgeAssignedText],
    neutral: [c.badgeNeutralBg, c.badgeNeutralText],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
  icon,
  accessibilityLabel,
  testID,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  icon?: IconName;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const c = useTheme();
  const content = (
    <View style={[styles.listRow, { borderColor: c.border }]}>
      {icon ? <Ionicons name={icon} size={22} color={c.primary} style={{ marginRight: space.md }} /> : null}
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: '600' }}>{title}</Body>
        {subtitle ? <Small>{subtitle}</Small> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={20} color={c.textMuted} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

export function Toggle({
  label,
  value,
  onValueChange,
  hint,
  disabled,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={[styles.toggle, { borderColor: c.border }]}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Body>{label}</Body>
        {hint ? <Small>{hint}</Small> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: c.primary, false: c.border }}
      />
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const c = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.segmented, { borderColor: c.primary }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segment, { backgroundColor: selected ? c.primary : 'transparent' }]}
          >
            <Text style={[styles.segmentText, { color: selected ? c.onPrimary : c.primary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, { borderColor: c.primary, backgroundColor: selected ? c.primary : c.surface }]}
    >
      <Text style={{ color: selected ? c.onPrimary : c.primary, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Empty({ title, message, icon = 'file-tray-outline' }: { title: string; message?: string; icon?: IconName }) {
  const c = useTheme();
  return (
    <View style={styles.empty} accessible accessibilityLabel={[title, message].filter(Boolean).join('. ')}>
      <Ionicons name={icon} size={40} color={c.textMuted} />
      <Body style={{ fontWeight: '600', marginTop: space.sm, textAlign: 'center' }}>{title}</Body>
      {message ? <Body muted style={{ textAlign: 'center', marginTop: space.xs }}>{message}</Body> : null}
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  const c = useTheme();
  return (
    <View style={styles.empty} accessible accessibilityLabel={label}>
      <ActivityIndicator color={c.primary} size="large" />
    </View>
  );
}

export const Gap = ({ size = space.md }: { size?: number }) => <View style={{ height: size }} />;

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.rowWrap, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  padded: { padding: space.lg },
  maxWidth: { width: '100%', maxWidth: 820, alignSelf: 'center' },
  h1: { fontSize: 26, fontWeight: '700', marginBottom: space.md },
  h2: { fontSize: 19, fontWeight: '700', marginTop: space.lg, marginBottom: space.sm },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 14, lineHeight: 19 },
  label: { fontSize: 15, fontWeight: '600', marginBottom: space.xs },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16, minHeight: 48 },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md },
  banner: { flexDirection: 'row', borderWidth: 1.5, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  badge: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 13, fontWeight: '700' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  segmented: { flexDirection: 'row', borderWidth: 1.5, borderRadius: radius.md, overflow: 'hidden', marginBottom: space.md },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  segmentText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: space.md, minHeight: 40, justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space.xxl },
});
