import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { serverNow } from '@/lib/serverClock';
import { useTheme } from '@/lib/theme';
import { fmtCountdown } from '@/lib/time';

/** Countdown to an instant, driven by the SERVER clock. */
export function Countdown({
  expiresAt,
  offeredAt,
  onExpire,
}: {
  expiresAt: string;
  offeredAt: string;
  onExpire?: () => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const end = new Date(expiresAt).getTime();
  const start = new Date(offeredAt).getTime();
  const [now, setNow] = useState(serverNow());
  const fired = useRef(false);
  const announced = useRef<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(id);
  }, []);

  const left = end - now;
  const fraction = Math.max(0, Math.min(1, left / Math.max(1, end - start)));
  const urgent = fraction <= 0.25;

  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
    // Announce to screen readers once per minute (not every second).
    const minutes = Math.ceil(left / 60_000);
    if (left > 0 && announced.current !== minutes && (minutes <= 5 || minutes % 5 === 0)) {
      announced.current = minutes;
      AccessibilityInfo.announceForAccessibility?.(t('offer.minutes_left', { count: minutes }));
    }
  }, [left, onExpire, t]);

  const color = left <= 0 ? c.textMuted : urgent ? c.danger : c.primary;
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={left > 0 ? t('offer.minutes_left', { count: Math.ceil(left / 60_000) }) : t('offer.expired')}
    >
      <Text style={[styles.time, { color }]}>{left > 0 ? fmtCountdown(left) : t('offer.expired')}</Text>
      <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
        <View style={[styles.bar, { width: `${fraction * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  time: { fontSize: 44, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  track: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 8 },
  bar: { height: 10, borderRadius: 5 },
});
