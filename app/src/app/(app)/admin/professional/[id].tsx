import { useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { QueueStateBadge } from '@/components/QueueStateBadge';
import { Badge, Banner, Body, Button, Card, Empty, Gap, H1, H2, Loading, ProfessionTag, Screen, Segmented, Small } from '@/components/ui';
import { rpc, useProfessionals, type Profession } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';

export default function ProfessionalDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current, isOwner } = useOrg();
  const me = useUserId();
  const list = useProfessionals(current?.org_id);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  if (list.isLoading || !current) return <Loading label={t('common.loading')} />;
  const p = list.data?.find((x) => x.user_id === id);
  if (!p) return <Empty title={t('errors.member.not_found')} />;
  const name = p.display_name || t('common.deleted_user');
  const isSelf = p.user_id === me;

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg({ kind: 'success', text: done });
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
      qc.invalidateQueries();
    }
  };

  const changeProfession = async (to: Profession) => {
    if (to === p.profession) return;
    const reason = await confirm({
      title: t('admin.change_profession_title', { name, profession: t(`professions.${to}`) }),
      message: t('admin.change_profession_message'),
      confirmLabel: t('admin.change_profession'),
      input: { label: t('admin.reason_optional'), minLength: 0, multiline: true },
    });
    if (reason === false) return;
    run('profession', () =>
      rpc('set_member_profession', { p_org: current.org_id, p_user: p.user_id, p_profession: to, p_reason: String(reason) || undefined }),
      t('admin.profession_changed'),
    );
  };

  const withReason = async (key: 'deactivate' | 'remove' | 'remove_entry') => {
    const reason = await confirm({
      title: t(`admin.${key}_title`, { name }),
      message: t(`admin.${key}_message`),
      confirmLabel: t(`admin.${key}`),
      destructive: true,
      input: { label: t('admin.reason'), minLength: 3, multiline: true },
    });
    if (reason === false) return;
    if (key === 'deactivate') {
      run(key, () => rpc('deactivate_member', { p_org: current.org_id, p_user: p.user_id, p_reason: String(reason) }), t('admin.deactivated'));
    } else if (key === 'remove') {
      await run(key, () => rpc('remove_member', { p_org: current.org_id, p_user: p.user_id, p_reason: String(reason) }));
      router.back();
    } else if (p.queue_id) {
      run(key, () => rpc('admin_remove_entry', { p_queue: p.queue_id!, p_user: p.user_id, p_reason: String(reason) }), t('admin.entry_removed'));
    }
  };

  const setRole = (role: 'admin' | 'staff') =>
    run('role', () => rpc('set_member_role', { p_org: current.org_id, p_user: p.user_id, p_role: role }), t('settings.saved'));

  return (
    <Screen>
      <Stack.Screen options={{ title: name }} />
      <H1 style={{ marginBottom: space.xs }}>{name}</H1>
      <Small>{p.email}</Small>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginTop: space.md, marginBottom: space.md }}>
        {p.profession ? <ProfessionTag profession={p.profession} /> : <Badge label={t('admin.no_profession')} />}
        <Badge label={t(`roles.${p.role}`)} tone="neutral" />
        {p.status === 'deactivated' ? <Badge label={t('member_status.deactivated')} tone="danger" /> : null}
      </View>
      {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : null}

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
          <Body>{t('admin.queue_status')}</Body>
          <QueueStateBadge state={p.queue_state} />
        </View>
        {p.queue_position ? <Body style={{ marginTop: space.sm }}>{t('admin.position_short', { position: p.queue_position })}</Body> : null}
        {p.entry_joined_at ? <Small>{t('admin.joined_at', { when: fmtDateTime(p.entry_joined_at, current.org.timezone, i18n.language) })}</Small> : null}
        <Small>{t('admin.member_since', { when: fmtDateTime(p.member_since, current.org.timezone, i18n.language) })}</Small>
        {p.queue_state === 'waiting' || p.queue_state === 'paused' ? (
          <>
            <Gap size={space.sm} />
            <Button title={t('admin.remove_entry')} variant="dangerOutline" icon="remove-circle-outline" onPress={() => withReason('remove_entry')} loading={busy === 'remove_entry'} />
          </>
        ) : null}
      </Card>

      <H2>{t('admin.profession')}</H2>
      <Small style={{ marginBottom: space.md }}>{t('admin.profession_help')}</Small>
      <Segmented
        label={t('admin.profession')}
        value={(p.profession ?? '') as Profession}
        onChange={changeProfession}
        options={[
          { value: 'doctor', label: t('professions.doctor'), testID: 'set-doctor' },
          { value: 'nurse', label: t('professions.nurse'), testID: 'set-nurse' },
        ]}
      />

      {!isSelf ? (
        <>
          <H2>{t('admin.access')}</H2>
          <Card>
            {isOwner && p.role !== 'owner' ? (
              <>
                <Button
                  title={p.role === 'admin' ? t('admin.make_staff') : t('admin.make_manager')}
                  variant="secondary"
                  icon="shield-outline"
                  onPress={() => setRole(p.role === 'admin' ? 'staff' : 'admin')}
                  loading={busy === 'role'}
                />
                <Gap size={space.sm} />
              </>
            ) : null}
            {p.status === 'active' ? (
              <Button title={t('admin.deactivate')} variant="dangerOutline" icon="pause-circle-outline" onPress={() => withReason('deactivate')} loading={busy === 'deactivate'} />
            ) : (
              <Button
                title={t('admin.reactivate')}
                variant="secondary"
                icon="play-circle-outline"
                onPress={() => run('reactivate', () => rpc('reactivate_member', { p_org: current.org_id, p_user: p.user_id }), t('settings.saved'))}
                loading={busy === 'reactivate'}
              />
            )}
            <Gap size={space.sm} />
            <Button title={t('admin.remove')} variant="danger" icon="trash-outline" onPress={() => withReason('remove')} loading={busy === 'remove'} />
          </Card>
        </>
      ) : null}
      <Gap />
      <Button
        title={t('admin.view_audit')}
        variant="ghost"
        icon="list-outline"
        onPress={() => router.push({ pathname: '/admin/audit', params: { subject: p.user_id } })}
      />
    </Screen>
  );
}
