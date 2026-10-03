import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { fmtDate, fmtTime } from '@/lib/time';
import { font, space, useTheme } from '@/lib/theme';
import { Body, Small, type IconName } from './ui';

/** Date, time, unit and notes of a shift, in the hospital's timezone. */
export function ShiftDetails({
  startsAt,
  endsAt,
  tz,
  unit,
  notes,
  large,
}: {
  startsAt: string;
  endsAt: string;
  tz: string;
  unit?: string | null;
  notes?: string | null;
  large?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const loc = i18n.language;
  return (
    <View style={{ gap: space.sm }}>
      <Line icon="calendar-outline" large={large} label={t('shift.date')} value={fmtDate(startsAt, tz, loc, { weekday: 'long' })} strong />
      <Line icon="time-outline" large={large} label={t('shift.time')} value={`${fmtTime(startsAt, tz, loc)} – ${fmtTime(endsAt, tz, loc)}`} strong />
      {unit ? <Line icon="business-outline" large={large} label={t('shift.unit')} value={unit} /> : null}
      {notes ? <Line icon="document-text-outline" large={large} label={t('shift.notes')} value={notes} /> : null}
    </View>
  );
}

function Line({ icon, label, value, strong, large }: { icon: IconName; label: string; value: string; strong?: boolean; large?: boolean }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
      <Ionicons name={icon} size={large ? 22 : 18} color={c.primaryStrong} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        {large ? <Small>{label}</Small> : null}
        <Body style={[strong && { fontFamily: font.semibold }, large && strong && { fontSize: 18, lineHeight: 25 }]}>{value}</Body>
      </View>
    </View>
  );
}
