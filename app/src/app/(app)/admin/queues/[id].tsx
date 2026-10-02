import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { DEFAULT_POLICY, policyToJson, policyValid, QueuePolicyForm, type PolicyState } from '@/components/QueuePolicyForm';
import { QueueStateBadge } from '@/components/QueueStateBadge';
import { Banner, Body, Button, Card, Empty, Gap, H2, Loading, Screen, Segmented, Small } from '@/components/ui';
import { rpc, useMembers, useQueue, useRoster, type QueueRow } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';
import { fmtDateTime, fmtTime, intervalMinutes } from '@/lib/time';

function policyFromQueue(q: QueueRow): PolicyState {
  return {
    acceptance_window_minutes: String(Math.round(intervalMinutes(q.acceptance_window))),
    decline_policy: q.decline_policy,
    timeout_policy: q.timeout_policy,
    pausing_allowed: q.pausing_allowed,
    withdraw_cooldown_hours: String(Math.round((intervalMinutes(q.withdraw_cooldown) / 60) * 100) / 100),
    no_show_policy: q.no_show_policy,
    no_show_cooldown_hours: String(Math.round((intervalMinutes(q.no_show_cooldown) / 60) * 100) / 100),
    auto_pause_after_timeouts: q.auto_pause_after_timeouts ? String(q.auto_pause_after_timeouts) : '',
    reoffer_after_withdraw: q.reoffer_after_withdraw,
  };
}

export default function AdminQueue() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current } = useOrg();
  const queue = useQueue(id);
  const roster = useRoster(id);
  const members = useMembers(current?.org_id);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'live' | 'pool' | 'policy'>('live');
  const [policy, setPolicy] = useState<PolicyState>(DEFAULT_POLICY);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (queue.data) setPolicy(policyFromQueue(queue.data));
  }, [queue.data]);

  if (queue.isLoading) return <Loading label={t('common.loading')} />;
  if (!queue.data || !current) return <Empty title={t('queue.not_found')} />;
  const q = queue.data;
  const tz = current.org.timezone;
  const loc = i18n.language;

  const run = async (key: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      await fn();
      if (okMsg) setInfo(okMsg);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      qc.invalidateQueries();
    }
  };

  const removeEntry = async (userId: string, name: string) => {
    const reason = await confirm({
      title: t('admin.remove_title', { name }),
      message: t('admin.remove_message'),
      confirmLabel: t('admin.remove'),
      destructive: true,
      input: { label: t('admin.reason_required'), minLength: 3, multiline: true },
    });
    if (reason === false) return;
    const block = await confirm({
      title: t('admin.block_title'),
      message: t('admin.block_message', { name }),
      confirmLabel: t('admin.block_yes'),
      cancelLabel: t('admin.block_no'),
      destructive: true,
    });
    await run('remove', () =>
      rpc('admin_remove_entry', { p_queue: q.id, p_user: userId, p_reason: String(reason), p_revoke_eligibility: block === true }),
    );
  };

  const savePolicy = () =>
    run('policy', () => rpc('update_queue', { p_queue: q.id, p_policy: policyToJson(policy) as never }), t('settings.saved'));

  const archive = async () => {
    const reason = await confirm({
      title: t('admin.archive_title'),
      message: t('admin.archive_message'),
      confirmLabel: t('admin.archive'),
      destructive: true,
      input: { label: t('admin.reason_required'), minLength: 3 },
    });
    if (reason === false) return;
    await run('archive', async () => {
      await rpc('archive_queue', { p_queue: q.id, p_reason: String(reason) });
      router.back();
    });
  };

  const poolIds = new Set((members.data ?? []).filter((m) => m.queue_ids.includes(q.id)).map((m) => m.user_id));
  const activeStaff = (members.data ?? []).filter((m) => m.status === 'active');

  return (
    <Screen refreshControl={<RefreshControl refreshing={roster.isRefetching} onRefresh={() => roster.refetch()} />}>
      <Stack.Screen options={{ title: q.name }} />
      <Segmented
        label={q.name}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'live', label: t('admin.live_queue') },
          { value: 'pool', label: t('admin.pool') },
          { value: 'policy', label: t('policy.title') },
        ]}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {info ? <Banner kind="success">{info}</Banner> : null}

      {tab === 'live' ? (
        <>
          <Small>{t('admin.live_hint')}</Small>
          <Gap size={space.sm} />
          {roster.data?.length === 0 ? <Empty title={t('admin.queue_empty')} /> : null}
          {roster.data?.map((r) => (
            <Card key={r.user_id ?? r.display_name} testID={`roster-${r.display_name}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
                <Body style={{ fontSize: 20, fontWeight: '800', minWidth: 44 }}>{r.queue_position ? `#${r.queue_position}` : '—'}</Body>
                <View style={{ flex: 1, minWidth: 160 }}>
                  <Body style={{ fontWeight: '700' }}>{r.display_name || t('common.deleted_user')}</Body>
                  <Small>
                    {r.state === 'offered' && r.offer_expires_at
                      ? t('admin.offer_until', { time: fmtTime(r.offer_expires_at, tz, loc) })
                      : r.state === 'paused' && r.paused_at
                        ? t('admin.paused_since', { when: fmtDateTime(r.paused_at, tz, loc) })
                        : t('admin.joined', { when: fmtDateTime(r.joined_at, tz, loc) })}
                  </Small>
                </View>
                <QueueStateBadge state={r.state} />
              </View>
              {r.state !== 'assigned' && r.user_id ? (
                <Button
                  title={t('admin.remove')}
                  variant="ghost"
                  icon="person-remove"
                  onPress={() => removeEntry(r.user_id!, r.display_name)}
                  accessibilityLabel={t('admin.remove_named', { name: r.display_name })}
                />
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {tab === 'pool' ? (
        <>
          <Body muted style={{ marginBottom: space.md }}>{t('admin.pool_explainer')}</Body>
          {activeStaff.map((m) => {
            const inPool = poolIds.has(m.user_id);
            return (
              <Card key={m.user_id}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Body style={{ fontWeight: '700' }}>{m.display_name}</Body>
                    <Small>{t(`roles.${m.role}`)}</Small>
                  </View>
                  {inPool ? (
                    <Button
                      title={t('admin.remove_from_pool')}
                      variant="secondary"
                      onPress={async () => {
                        const reason = await confirm({
                          title: t('admin.remove_from_pool'),
                          message: t('admin.remove_from_pool_message', { name: m.display_name }),
                          confirmLabel: t('admin.remove'),
                          destructive: true,
                          input: { label: t('admin.reason_required'), minLength: 3 },
                        });
                        if (reason !== false)
                          await run('pool', () => rpc('remove_queue_member', { p_queue: q.id, p_user: m.user_id, p_reason: String(reason) }));
                      }}
                    />
                  ) : (
                    <Button
                      title={t('admin.add_to_pool')}
                      onPress={() => run('pool', () => rpc('add_queue_members', { p_queue: q.id, p_user_ids: [m.user_id] }))}
                    />
                  )}
                </View>
              </Card>
            );
          })}
        </>
      ) : null}

      {tab === 'policy' ? (
        <>
          <QueuePolicyForm value={policy} onChange={setPolicy} />
          <Gap />
          <Button title={t('common.save')} onPress={savePolicy} loading={busy === 'policy'} disabled={!policyValid(policy)} />
          <H2>{t('admin.danger_zone')}</H2>
          <Button title={t('admin.archive')} variant="danger" onPress={archive} loading={busy === 'archive'} />
        </>
      ) : null}
    </Screen>
  );
}
