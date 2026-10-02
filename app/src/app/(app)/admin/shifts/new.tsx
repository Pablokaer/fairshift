import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Banner, Body, Button, Card, Chip, Field, Gap, H2, Row, Screen, Segmented, Small, Toggle } from '@/components/ui';
import { rpc, useQueues } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';
import { expandShifts, type Draft } from '@/lib/shifts';
import { addDays, isHm, isYmd, todayIn } from '@/lib/time';

export default function NewShifts() {
  const { t } = useTranslation();
  const { current } = useOrg();
  const queues = useQueues(current?.org_id);
  const tz = current?.org.timezone ?? 'UTC';
  const [queueId, setQueueId] = useState<string | null>(null);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [draft, setDraft] = useState<Draft>({ date: addDays(todayIn(tz), 1), start: '07:00', end: '19:00', unit: '', notes: '' });
  const [repeat, setRepeat] = useState('5');
  const [every, setEvery] = useState('1');
  const [weekdaysOnly, setWeekdaysOnly] = useState(false);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!queueId && queues.data?.length) setQueueId(queues.data[0].id);
  }, [queues.data, queueId]);

  const items = useMemo(
    () => expandShifts(draft, mode, Math.min(60, Number(repeat) || 0), Math.max(1, Number(every) || 1), weekdaysOnly),
    [draft, mode, repeat, every, weekdaysOnly],
  );
  const valid = !!queueId && isYmd(draft.date) && isHm(draft.start) && isHm(draft.end) && items.length > 0;
  const overnight = isHm(draft.start) && isHm(draft.end) && draft.end <= draft.start;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpc('create_shifts', {
        p_queue: queueId!,
        p_publish: publish,
        p_shifts: items.map((i) => ({
          start_local: `${i.date}T${i.start}`,
          end_local: `${i.date}T${i.end}`,
          unit: i.unit.trim(),
          notes: i.notes.trim(),
        })) as never,
      });
      router.replace('/admin/shifts');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof Draft) => (v: string) => setDraft({ ...draft, [k]: v });

  return (
    <Screen>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Body style={{ fontWeight: '600', marginBottom: space.xs }}>{t('admin.queue')}</Body>
      <Row>
        {queues.data?.map((q) => (
          <Chip key={q.id} label={q.name} selected={queueId === q.id} onPress={() => setQueueId(q.id)} />
        ))}
      </Row>
      <Gap />
      <Segmented
        label={t('admin.shift_mode')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'single', label: t('admin.single') },
          { value: 'bulk', label: t('admin.bulk') },
        ]}
      />
      <Small>{t('admin.times_in_tz', { tz })}</Small>
      <Gap size={space.sm} />
      <Field testID="shift-date" label={t('admin.date')} value={draft.date} onChangeText={set('date')} placeholder="YYYY-MM-DD" hint="YYYY-MM-DD" error={draft.date && !isYmd(draft.date) ? t('admin.invalid_date') : null} />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field testID="shift-start" label={t('admin.start')} value={draft.start} onChangeText={set('start')} placeholder="07:00" hint="HH:MM" error={draft.start && !isHm(draft.start) ? t('admin.invalid_time') : null} />
        </View>
        <View style={{ flex: 1 }}>
          <Field testID="shift-end" label={t('admin.end')} value={draft.end} onChangeText={set('end')} placeholder="19:00" hint="HH:MM" error={draft.end && !isHm(draft.end) ? t('admin.invalid_time') : null} />
        </View>
      </View>
      {overnight ? <Banner kind="info">{t('admin.overnight')}</Banner> : null}
      <Field testID="shift-unit" label={t('admin.unit')} value={draft.unit} onChangeText={set('unit')} />
      <Field label={t('admin.notes')} value={draft.notes} onChangeText={set('notes')} multiline />

      {mode === 'bulk' ? (
        <Card>
          <H2 style={{ marginTop: 0 }}>{t('admin.repeat')}</H2>
          <Field label={t('admin.repeat_count')} value={repeat} onChangeText={(v) => setRepeat(v.replace(/\D/g, ''))} keyboardType="number-pad" hint={t('admin.repeat_max')} />
          <Field label={t('admin.repeat_every')} value={every} onChangeText={(v) => setEvery(v.replace(/\D/g, ''))} keyboardType="number-pad" />
          <Toggle label={t('admin.weekdays_only')} value={weekdaysOnly} onValueChange={setWeekdaysOnly} />
          <Small>{t('admin.will_create', { count: items.length, first: items[0]?.date ?? '', last: items[items.length - 1]?.date ?? '' })}</Small>
        </Card>
      ) : null}

      <Toggle label={t('admin.publish_now')} hint={t('admin.publish_now_hint')} value={publish} onValueChange={setPublish} />
      <Gap />
      <Button
        testID="create-shifts"
        title={publish ? t('admin.create_and_publish', { count: items.length }) : t('admin.save_drafts', { count: items.length })}
        onPress={submit}
        loading={busy}
        disabled={!valid}
      />
    </Screen>
  );
}
