// Small, accessible UI kit: 48pt touch targets, screen-reader roles/labels,
// text that scales with the system font size, AA-contrast colours, Inter.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
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
import { font, maxContentWidth, radius, shadow, space, useTheme } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type Profession = 'doctor' | 'nurse';

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
          contentContainerStyle={{ paddingBottom: space.xxxl }}
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

/** Small uppercase label above a group of content. */
export function Overline({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useTheme();
  return <Text style={[styles.overline, { color: c.textMuted }, style]}>{children}</Text>;
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

export function Small({
  children,
  muted = true,
  style,
  ...rest
}: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle> } & ComponentProps<typeof Text>) {
  const c = useTheme();
  return (
    <Text {...rest} style={[styles.small, { color: muted ? c.textMuted : c.text }, style]}>
      {children}
    </Text>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
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
  size?: 'md' | 'lg';
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
    secondary: { bg: c.surface, fg: c.primaryStrong, border: c.border },
    danger: { bg: c.danger, fg: c.onDanger, border: c.danger },
    dangerOutline: { bg: c.surface, fg: c.danger, border: c.border },
    ghost: { bg: 'transparent', fg: c.primaryStrong, border: 'transparent' },
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
        size === 'lg' && styles.buttonLg,
        variant === 'primary' && !isDisabled && shadow.card,
        { backgroundColor: p.bg, borderColor: p.border, opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <View style={styles.buttonRow}>
        {loading ? (
          <Spinner color={p.fg} />
        ) : icon ? (
          <Ionicons name={icon} size={size === 'lg' ? 24 : 20} color={p.fg} style={{ marginRight: space.sm }} />
        ) : null}
        <Text style={[styles.buttonText, size === 'lg' && styles.buttonTextLg, { color: p.fg, flexShrink: 1 }]}>{title}</Text>
      </View>
    </Pressable>
  );
}

/** Three pulsing dots: a calm, small busy indicator for buttons. */
function Spinner({ color }: { color: string }) {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 450, useNativeDriver: false }),
        Animated.timing(v, { toValue: 0.3, duration: 450, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View style={{ flexDirection: 'row', gap: 4, marginRight: space.sm, opacity: v }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      ))}
    </Animated.View>
  );
}

export function Card({
  children,
  style,
  testID,
  tone = 'default',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  tone?: 'default' | 'tint' | 'warning';
}) {
  const c = useTheme();
  const bg = tone === 'tint' ? c.primaryTint : tone === 'warning' ? c.warningTint : c.surface;
  return (
    <View testID={testID} style={[styles.card, tone === 'default' && shadow.card, { backgroundColor: bg }, style]}>
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
    <View style={{ marginBottom: space.lg }}>
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
      {hint && !error ? <Small style={{ marginTop: space.xs }}>{hint}</Small> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.small, { color: c.danger, marginTop: space.xs }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Banner({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  const c = useTheme();
  const map = {
    info: { fg: c.info, bg: c.surfaceAlt, icon: 'information-circle-outline' },
    error: { fg: c.danger, bg: c.dangerTint, icon: 'alert-circle-outline' },
    success: { fg: c.success, bg: c.badgeAssignedBg, icon: 'checkmark-circle-outline' },
    warning: { fg: c.warning, bg: c.warningTint, icon: 'warning-outline' },
  }[kind];
  return (
    <View
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: map.bg }]}
    >
      <Ionicons name={map.icon as IconName} size={22} color={map.fg} style={{ marginRight: space.sm, marginTop: 1 }} />
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <Body>{children}</Body> : children}</View>
    </View>
  );
}

export type BadgeTone = 'waiting' | 'paused' | 'assigned' | 'neutral' | 'danger';

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: BadgeTone; icon?: IconName }) {
  const c = useTheme();
  const map = {
    waiting: [c.badgeWaitingBg, c.badgeWaitingText],
    paused: [c.badgePausedBg, c.badgePausedText],
    assigned: [c.badgeAssignedBg, c.badgeAssignedText],
    neutral: [c.badgeNeutralBg, c.badgeNeutralText],
    danger: [c.dangerTint, c.dangerText],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={14} color={fg} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export const PROFESSION_ICON: Record<Profession, IconName> = { doctor: 'medkit-outline', nurse: 'bandage-outline' };

/** Doctor / Nurse tag: colour + icon + label (never colour alone). */
export function ProfessionTag({ profession, plural, size = 'md' }: { profession: Profession; plural?: boolean; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const c = useTheme();
  const [bg, fg] = profession === 'doctor' ? [c.doctorBg, c.doctorText] : [c.nurseBg, c.nurseText];
  const label = t(plural ? `professions_plural.${profession}` : `professions.${profession}`);
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.badge, size === 'md' && { paddingHorizontal: 12, paddingVertical: 6 }, { backgroundColor: bg }]}
    >
      <Ionicons name={PROFESSION_ICON[profession]} size={size === 'md' ? 16 : 14} color={fg} style={{ marginRight: 6 }} />
      <Text style={[styles.badgeText, size === 'md' && { fontSize: 14 }, { color: fg }]}>{label}</Text>
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
  last,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  icon?: IconName;
  accessibilityLabel?: string;
  testID?: string;
  last?: boolean;
}) {
  const c = useTheme();
  const content = (
    <View style={[styles.listRow, { borderColor: c.border }, last && { borderBottomWidth: 0 }]}>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: c.primaryTint }]}>
          <Ionicons name={icon} size={20} color={c.primaryStrong} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: font.semibold }}>{title}</Body>
        {subtitle ? <Small>{subtitle}</Small> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={20} color={c.textMuted} style={{ marginLeft: space.sm }} /> : null}
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
  testID,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Body style={{ fontFamily: font.medium }}>{label}</Body>
        {hint ? <Small>{hint}</Small> : null}
      </View>
      <Switch
        testID={testID}
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
  options: { value: T; label: string; testID?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const c = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.segmented, { backgroundColor: c.surfaceAlt }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={o.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segment, selected && [{ backgroundColor: c.surface }, shadow.card]]}
          >
            <Text style={[styles.segmentText, { color: selected ? c.primaryStrong : c.textMuted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress: () => void; testID?: string }) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.primaryTint : c.surface }]}
    >
      <Text style={{ color: selected ? c.primaryStrong : c.text, fontFamily: font.semibold, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Empty({ title, message, icon = 'file-tray-outline' }: { title: string; message?: string; icon?: IconName }) {
  const c = useTheme();
  return (
    <View style={styles.empty} accessible accessibilityLabel={[title, message].filter(Boolean).join('. ')}>
      <View style={[styles.emptyIcon, { backgroundColor: c.primaryTint }]}>
        <Ionicons name={icon} size={32} color={c.primaryStrong} />
      </View>
      <Body style={{ fontFamily: font.semibold, fontSize: 17, marginTop: space.md, textAlign: 'center' }}>{title}</Body>
      {message ? <Body muted style={{ textAlign: 'center', marginTop: space.xs, maxWidth: 420 }}>{message}</Body> : null}
    </View>
  );
}

/** A pulsing placeholder block. */
export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const v = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(v, { toValue: 0.6, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ height, width, borderRadius: radius.sm, backgroundColor: c.skeleton, opacity: v }, style]} />;
}

/** Loading state: skeleton cards instead of a spinner. */
export function Loading({ label, cards = 2 }: { label: string; cards?: number }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[styles.padded, styles.maxWidth, { flex: 1, backgroundColor: c.bg }]}
    >
      <Skeleton height={14} width="35%" style={{ marginBottom: space.sm }} />
      <Skeleton height={30} width="60%" style={{ marginBottom: space.xl }} />
      {Array.from({ length: cards }, (_, i) => (
        <Card key={i}>
          <Skeleton height={18} width="45%" style={{ marginBottom: space.md }} />
          <Skeleton height={44} width="70%" style={{ marginBottom: space.md }} />
          <Skeleton height={14} width="55%" />
        </Card>
      ))}
    </View>
  );
}

/** A big number with a label underneath (dashboards). */
export function Stat({ value, label, testID }: { value: string | number; label: string; testID?: string }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={`${value} ${label}`} style={{ minWidth: 72 }}>
      <Text testID={testID} style={{ fontFamily: font.extrabold, fontSize: 28, lineHeight: 34, color: c.text }}>
        {value}
      </Text>
      <Small>{label}</Small>
    </View>
  );
}

export const Gap = ({ size = space.md }: { size?: number }) => <View style={{ height: size }} />;

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.rowWrap, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  padded: { padding: space.lg, paddingTop: space.xl },
  maxWidth: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  h1: { fontFamily: font.bold, fontSize: 28, lineHeight: 34, marginBottom: space.lg, letterSpacing: -0.3 },
  h2: { fontFamily: font.semibold, fontSize: 19, lineHeight: 25, marginTop: space.xl, marginBottom: space.md },
  overline: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18, letterSpacing: 0.6, textTransform: 'uppercase' },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: font.semibold, fontSize: 15, marginBottom: space.xs },
  input: {
    fontFamily: font.regular,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLg: { minHeight: 60, borderRadius: radius.lg, paddingHorizontal: space.xl },
  buttonText: { fontFamily: font.semibold, fontSize: 16, textAlign: 'center' },
  buttonTextLg: { fontFamily: font.bold, fontSize: 18 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  card: { borderRadius: radius.lg, padding: space.lg, marginBottom: space.md },
  banner: { flexDirection: 'row', borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: font.semibold, fontSize: 13 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginRight: space.md },
  toggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, minHeight: 56 },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 4, marginBottom: space.lg, gap: 4 },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.sm },
  segmentText: { fontFamily: font.semibold, fontSize: 15, textAlign: 'center' },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 44, justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space.xl, paddingVertical: space.xxl },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
