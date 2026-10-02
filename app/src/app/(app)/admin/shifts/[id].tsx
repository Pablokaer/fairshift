import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { ShiftStatusBadge } from '@/components/ShiftStatusBadge';
import { Banner, Body, Button, Card, Empty, Field, Gap, H1, H2, ListRow, Loading, Screen, Small } from '@/components/ui';
import { rpc, useAdminShifts, useShiftHistory } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/time';

export default function AdminShiftDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current } = useOrg();
  const shifts = useAdminShifts(current?.org_id);
  const history = useShiftHistory(id);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  if (shifts.isLoading || !current) return <Loading label={t('common.loading')} />;
  const s = shifts.data?.find((x) => x.shift_id === id);
  if (!s) return <Empty title={t('admin.shift_not_found')} />;
  const tz = current.org.timezone;
  const loc = i18n.language;
  const started = new Date(s.starts_at).getTime() <= Date.now();

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      qc.invalidateQueries();
    }
  };

  const cancel = async () => {
    const reason = await confirm({
      title: t('admin.cancel_shift_title'),
      message: s.status === 'assigned' ? t('admin.cancel_assigned_message', { name: s.assignee_name }) : t('admin.cancel_message'),
      confirmLabel: t('admin.cancel_shift'),
      destructive: true,
      input: { label: t('admin.reason_optional'), minLength: 0, multiline: true },
    });
    if (reason !== false) await run('cancel', () => rpc('cancel_shift', { p_shift: s.shift_id, p_reason: String(reason) || undefined }));
  };

  const complete = async () => {
    const ok = await confirm({
      title: t('admin.complete_title'),
      message: t('admin.complete_message', { name: s.assignee_name }),
      confirmLabel: t('admin.mark_completed'),
    });
    if (ok) await run('complete', () => rpc('complete_shift', { p_shift: s.shift_id }));
  };

  const noShow = async () => {
    const reason = await confirm({
      title: t('admin.no_show_title'),
      message: t('admin.no_show_message', { name: s.assignee_name }),
      confirmLabel: t('admin.mark_no_show'),
      destructive: true,
      input: { label: t('admin.reason_optional'), minLength: 0, multiline: true },
    });
    if (reason !== false) await run('noshow', () => rpc('mark_no_show', { p_shift: s.shift_id, p_reason: String(reason) || undefined }));
  };

  const del = async () => {
    const ok = await confirm({ title: t('admin.delete_draft'), message: t('admin.delete_draft_message'), confirmLabel: t('admin.delete'), destructive: true });
    if (ok)
      await run('delete', async () => {
        await rpc('delete_draft_shift', { p_shift: s.shift_id });
        router.back();
      });
  };

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={shifts.isRefetching} onRefresh={() => Promise.all([shifts.refetch(), history.refetch()])} />
      }
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.sm }}>
        <H1 style={{ marginBottom: 0, flexShrink: 1 }}>{fmtDate(s.starts_at, tz, loc, { year: 'numeric' })}</H1>
        <ShiftStatusBadge status={s.status} />
      </View>
      <Body style={{ fontSize: 18 }}>
        {fmtTime(s.starts_at, tz, loc)} – {fmtTime(s.ends_at, tz, loc)} · {s.queue_name}
      </Body>
      {s.unit ? <Body muted>{s.unit}</Body> : null}
      <Gap />
      {error ? <Banner kind="error">{error}</Banner> : null}

      {s.status === 'offered' ? (
        <Banner kind="info">
          {t('admin.offered_to', { name: s.current_offer_name, position: s.current_offer_position, time: fmtTime(s.current_offer_expires_at, tz, loc) })}
        </Banner>
      ) : null}
      {['assigned', 'completed', 'no_show'].includes(s.status) ? (
        <Banner kind="success">{t('admin.assigned_to', { name: s.assignee_name || t('common.deleted_user') })}</Banner>
      ) : null}
      {s.status === 'unfilled' ? <Banner kind="warning">{t('admin.unfilled_hint')}</Banner> : null}

      <View style={{ gap: space.sm }}>
        {s.status === 'draft' ? (
          <>
            <Button testID="publish-shift" title={t('admin.publish')} icon="send" onPress={() => run('publish', () => rpc('publish_shifts', { p_shift_ids: [s.shift_id] }))} loading={busy === 'publish'} />
            <Button title={t('admin.delete_draft')} variant="danger" onPress={del} loading={busy === 'delete'} />
          </>
        ) : null}
        {s.status === 'unfilled' && !started ? (
          <Button title={t('admin.reoffer')} icon="refresh" onPress={() => run('reoffer', () => rpc('reoffer_shift', { p_shift: s.shift_id }))} loading={busy === 'reoffer'} />
        ) : null}
        {s.status === 'assigned' && started ? (
          <>
            <Button testID="complete-shift" title={t('admin.mark_completed')} icon="checkmark-done" onPress={complete} loading={busy === 'complete'} />
            <Button title={t('admin.mark_no_show')} variant="secondary" onPress={noShow} loading={busy === 'noshow'} />
          </>
        ) : null}
        {s.status === 'completed' ? (
          <Button title={t('admin.correct_no_show')} variant="secondary" onPress={noShow} loading={busy === 'noshow'} />
        ) : null}
        {['published', 'offered', 'assigned', 'unfilled'].includes(s.status) ? (
          <Button testID="cancel-shift" title={t('admin.cancel_shift')} variant="danger" onPress={cancel} loading={busy === 'cancel'} />
        ) : null}
      </View>

      {!['completed', 'no_show', 'cancelled'].includes(s.status) ? (
        <Card style={{ marginTop: space.lg }}>
          <Field label={t('admin.notes')} value={notes ?? s.notes} onChangeText={setNotes} multiline hint={t('admin.notes_hint')} />
          <Button
            variant="secondary"
            title={t('common.save')}
            disabled={notes === null || notes === s.notes}
            loading={busy === 'notes'}
            onPress={() => run('notes', () => rpc('update_shift', { p_shift: s.shift_id, p_patch: { notes } as never }))}
          />
        </Card>
      ) : null}

      <H2>{t('admin.offer_history')}</H2>
      {history.data?.length === 0 ? <Small>{t('admin.no_offers_yet')}</Small> : null}
      <Card>
        {history.data?.map((h) => (
          <ListRow
            key={h.offer_id}
            title={`#${h.queue_position ?? '?'} ${h.display_name || t('common.deleted_user')}`}
            subtitle={`${t(`offer_outcome.${h.outcome ?? 'open'}`)}${h.outcome_reason && h.outcome_reason !== h.outcome ? ` (${t(`reasons.${h.outcome_reason}`, { defaultValue: h.outcome_reason })})` : ''} · ${fmtDateTime(h.offered_at, tz, loc)}${h.round > 1 ? ` · ${t('admin.round', { n: h.round })}` : ''}`}
          />
        ))}
      </Card>
    </Screen>
  );
}
