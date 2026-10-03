import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, Text, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { ShiftDetails } from '@/components/ShiftDetails';
import { AssignmentBadge, ShiftStatusBadge } from '@/components/ShiftStatusBadge';
import { Banner, Body, Button, Card, Empty, Field, Gap, H2, Loading, ProfessionTag, Screen, Small } from '@/components/ui';
import { assigneesOf, rpc, useAdminShift, type Assignee } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { font, space, useTheme } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';

export default function ShiftDetail() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current } = useOrg();
  const shift = useAdminShift(current?.org_id, id);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (shift.data) setNotes(shift.data.notes);
  }, [shift.data]);

  if (shift.isLoading || !current) return <Loading label={t('common.loading')} cards={2} />;
  const s = shift.data;
  if (!s) return <Empty title={t('errors.shift.not_found')} />;
  const tz = current.org.timezone;
  const started = new Date(s.starts_at).getTime() <= Date.now();
  const all = assigneesOf(s);
  const people = all.filter((a) => a.status === 'active' || a.status === 'completed' || a.status === 'no_show');
  const others = all.filter((a) => a.status === 'withdrawn' || a.status === 'cancelled');
  const live = s.status === 'open' || s.status === 'filled';

  const run = async (key: string, fn: () => Promise<unknown>, done?: string, back?: boolean) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg({ kind: 'success', text: done });
      if (back) router.back();
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
      qc.invalidateQueries();
    }
  };

  const publish = async () => {
    const ok = await confirm({ title: t('admin.publish_title', { count: 1 }), message: t('admin.publish_message'), confirmLabel: t('admin.publish') });
    if (ok) run('publish', () => rpc('publish_shifts', { p_shift_ids: [s.shift_id] }));
  };
  const cancel = async () => {
    const reason = await confirm({
      title: t('admin.cancel_shift_title'),
      message: t('admin.cancel_shift_message'),
      confirmLabel: t('admin.cancel_shift'),
      destructive: true,
      input: { label: t('admin.reason_optional'), minLength: 0, multiline: true },
    });
    if (reason !== false) run('cancel', () => rpc('cancel_shift', { p_shift: s.shift_id, p_reason: String(reason) || undefined }), t('admin.shift_cancelled'));
  };
  const complete = async () => {
    const ok = await confirm({ title: t('admin.complete_title'), message: t('admin.complete_message'), confirmLabel: t('admin.complete') });
    if (ok) run('complete', () => rpc('complete_shift', { p_shift: s.shift_id }), t('admin.shift_completed'));
  };
  const remove = async () => {
    const ok = await confirm({ title: t('admin.delete_draft_title'), message: t('admin.delete_draft_message'), confirmLabel: t('admin.delete_draft'), destructive: true });
    if (ok) run('delete', () => rpc('delete_draft_shift', { p_shift: s.shift_id }), undefined, true);
  };
  const noShow = async (a: Assignee) => {
    const reason = await confirm({
      title: t('admin.no_show_title', { name: a.display_name || t('common.deleted_user') }),
      message: t('admin.no_show_message'),
      confirmLabel: t('admin.no_show'),
      destructive: true,
      input: { label: t('admin.reason_optional'), minLength: 0, multiline: true },
    });
    if (reason !== false) run(`noshow-${a.assignment_id}`, () => rpc('mark_no_show', { p_assignment: a.assignment_id, p_reason: String(reason) || undefined }));
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={shift.isRefetching} onRefresh={() => shift.refetch()} />}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap', marginBottom: space.md }}>
        <ProfessionTag profession={s.profession} plural />
        <ShiftStatusBadge status={s.status} />
      </View>
      {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : null}

      <Card>
        <ShiftDetails startsAt={s.starts_at} endsAt={s.ends_at} tz={tz} unit={s.unit} large />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginTop: space.lg }}>
          <Text testID="slots-filled" style={{ fontFamily: font.extrabold, fontSize: 32, color: c.text }}>
            {s.filled}/{s.slots}
          </Text>
          <Small>{t('admin.slots_label')}</Small>
        </View>
        {s.published_at ? <Small>{t('admin.published_at', { when: fmtDateTime(s.published_at, tz, i18n.language) })}</Small> : null}
        {s.cancelled_reason ? <Small>{t('admin.cancel_reason', { reason: s.cancelled_reason === 'unfilled' ? t('admin.unfilled') : s.cancelled_reason })}</Small> : null}
      </Card>

      {s.status === 'open' && !started ? <Banner kind="warning">{t('admin.short_banner', { filled: s.filled, slots: s.slots })}</Banner> : null}
      {s.status === 'open' && started ? <Banner kind="warning">{t('admin.started_short', { filled: s.filled, slots: s.slots })}</Banner> : null}

      {s.status !== 'draft' ? (
        <>
          <H2>{t('admin.assigned_people')}</H2>
          <Card testID="assignees">
            {people.length === 0 ? <Empty icon="person-outline" title={t('admin.nobody_assigned')} /> : null}
            {people.map((a, i) => (
              <View
                key={a.assignment_id}
                testID={`assignee-${a.display_name}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: i === people.length - 1 ? 0 : 0.5, borderColor: c.border }}
              >
                <Text style={{ fontFamily: font.extrabold, fontSize: 20, minWidth: 44, color: c.primaryStrong }}>
                  {a.position ? `#${a.position}` : '–'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: font.semibold }}>{a.display_name || t('common.deleted_user')}</Body>
                  <Small>{t('admin.assigned_at', { when: fmtDateTime(a.assigned_at, tz, i18n.language) })}</Small>
                </View>
                <AssignmentBadge status={a.status} />
                {started && (a.status === 'active' || a.status === 'completed') ? (
                  <Button title={t('admin.no_show')} variant="ghost" onPress={() => noShow(a)} loading={busy === `noshow-${a.assignment_id}`} />
                ) : null}
              </View>
            ))}
          </Card>
          <Small>{t('admin.assigned_explainer')}</Small>
          {others.length ? (
            <>
              <H2>{t('admin.previous_assignees')}</H2>
              <Card>
                {others.map((a) => (
                  <View key={a.assignment_id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.sm, gap: space.sm }}>
                    <Body style={{ flex: 1 }}>{a.display_name || t('common.deleted_user')}{a.reason ? ` · ${a.reason}` : ''}</Body>
                    <AssignmentBadge status={a.status} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}

      <H2>{t('admin.notes')}</H2>
      <Field label={t('admin.notes')} value={notes} onChangeText={setNotes} multiline editable={s.status !== 'completed' && s.status !== 'cancelled'} />
      {notes !== s.notes ? (
        <Button
          title={t('admin.save_notes')}
          variant="secondary"
          onPress={() => run('notes', () => rpc('update_shift', { p_shift: s.shift_id, p_patch: { notes } }), t('settings.saved'))}
          loading={busy === 'notes'}
        />
      ) : null}

      <Gap size={space.xl} />
      {s.status === 'draft' ? (
        <>
          <Button testID="publish-shift" title={t('admin.publish')} icon="paper-plane-outline" onPress={publish} loading={busy === 'publish'} disabled={started} />
          <Gap size={space.sm} />
          <Button title={t('admin.delete_draft')} variant="dangerOutline" icon="trash-outline" onPress={remove} loading={busy === 'delete'} />
        </>
      ) : null}
      {live && !started ? (
        <Button testID="cancel-shift" title={t('admin.cancel_shift')} variant="dangerOutline" icon="close-circle-outline" onPress={cancel} loading={busy === 'cancel'} />
      ) : null}
      {live && started ? (
        <Button testID="complete-shift" title={t('admin.complete')} icon="checkmark-done-outline" onPress={complete} loading={busy === 'complete'} />
      ) : null}
    </Screen>
  );
}
