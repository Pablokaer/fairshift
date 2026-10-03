import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Banner, Body, Button, Card, Field, Gap, Screen, Segmented, Small, Toggle } from '@/components/ui';
import { rpc, useQueueOverview, type Profession } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { font, radius, space, useTheme } from '@/lib/theme';
import { addDays, isHm, isYmd, todayIn } from '@/lib/time';

export default function NewShift() {
  const { t } = useTranslation();
  const c = useTheme();
  const { current } = useOrg();
  const qc = useQueryClient();
  const overview = useQueueOverview(current?.org_id);
  const tz = current?.org.timezone ?? 'UTC';
  const [profession, setProfession] = useState<Profession>('doctor');
  const [date, setDate] = useState(addDays(todayIn(tz), 1));
  const [start, setStart] = useState('07:00');
  const [end, setEnd] = useState('19:00');
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [slots, setSlots] = useState(1);
  const [publishNow, setPublishNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waiting = overview.data?.find((q) => q.profession === profession)?.waiting ?? 0;
  const dateOk = isYmd(date);
  const startOk = isHm(start);
  const endOk = isHm(end);
  const overnight = startOk && endOk && end <= start;

  const submit = async () => {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const endDate = overnight ? addDays(date, 1) : date;
      const ids = await rpc('create_shifts', {
        p_org: current.org_id,
        p_profession: profession,
        p_publish: publishNow,
        p_shifts: [{ start_local: `${date}T${start}`, end_local: `${endDate}T${end}`, unit: unit.trim(), notes: notes.trim(), slots }],
      });
      qc.invalidateQueries();
      const id = (ids as unknown as string[])[0];
      router.replace(`/admin/shifts/${id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Small style={{ marginBottom: space.md }}>{t('admin.new_shift_help', { tz })}</Small>
      {error ? <Banner kind="error">{error}</Banner> : null}

      <Body style={{ fontFamily: font.semibold, marginBottom: space.xs }}>{t('admin.profession')}</Body>
      <Segmented
        label={t('admin.profession')}
        value={profession}
        onChange={setProfession}
        options={[
          { value: 'doctor', label: t('professions_plural.doctor'), testID: 'profession-doctor' },
          { value: 'nurse', label: t('professions_plural.nurse'), testID: 'profession-nurse' },
        ]}
      />

      <Field
        testID="shift-date"
        label={t('admin.date')}
        value={date}
        onChangeText={setDate}
        hint={t('admin.date_hint')}
        error={dateOk ? null : t('admin.invalid_date')}
        autoCapitalize="none"
        inputMode="numeric"
      />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field testID="shift-start" label={t('admin.start')} value={start} onChangeText={setStart} error={startOk ? null : t('admin.invalid_time')} inputMode="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <Field testID="shift-end" label={t('admin.end')} value={end} onChangeText={setEnd} error={endOk ? null : t('admin.invalid_time')} inputMode="numeric" />
        </View>
      </View>
      {overnight ? <Banner kind="info">{t('admin.overnight')}</Banner> : null}
      <Field testID="shift-unit" label={t('admin.unit')} value={unit} onChangeText={setUnit} placeholder={t('admin.unit_placeholder')} />
      <Field testID="shift-notes" label={t('admin.notes')} value={notes} onChangeText={setNotes} multiline />

      <Body style={{ fontFamily: font.semibold, marginBottom: space.xs }}>{t('admin.slots')}</Body>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm }}>
        <Stepper icon="remove" label={t('admin.slots_less')} onPress={() => setSlots((s) => Math.max(1, s - 1))} disabled={slots <= 1} />
        <Text
          testID="shift-slots"
          accessibilityLabel={t('admin.slots_value', { count: slots })}
          style={{ fontFamily: font.extrabold, fontSize: 32, minWidth: 48, textAlign: 'center', color: c.text }}
        >
          {slots}
        </Text>
        <Stepper testID="slots-more" icon="add" label={t('admin.slots_more')} onPress={() => setSlots((s) => Math.min(50, s + 1))} disabled={slots >= 50} />
      </View>
      <Small style={{ marginBottom: space.lg }}>{t('admin.slots_help')}</Small>

      <Card tone="tint">
        <Toggle testID="publish-now" label={t('admin.publish_now')} hint={t('admin.publish_now_hint')} value={publishNow} onValueChange={setPublishNow} />
        {publishNow ? (
          <Body style={{ marginTop: space.sm }}>
            {waiting >= slots
              ? t('admin.preview_assign', { count: slots, queue: t(`queue_in_sentence.${profession}`) })
              : t('admin.preview_short', { waiting, slots, queue: t(`queue_in_sentence.${profession}`) })}
          </Body>
        ) : null}
      </Card>
      <Gap />
      <Button
        testID="create-shift"
        size="lg"
        title={publishNow ? t('admin.create_publish') : t('admin.save_draft')}
        icon={publishNow ? 'paper-plane-outline' : 'save-outline'}
        onPress={submit}
        loading={busy}
        disabled={!dateOk || !startOk || !endOk}
      />
    </Screen>
  );
}

function Stepper({ icon, label, onPress, disabled, testID }: { icon: 'add' | 'remove'; label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={24} color={c.primaryStrong} />
    </Pressable>
  );
}
