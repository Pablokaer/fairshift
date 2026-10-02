import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { Banner, Body, Button, Card, Chip, Empty, Gap, H1, H2, Loading, Row, Screen, Small } from '@/components/ui';
import { rpc, useMembers, useQueues } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';

export default function MemberDetail() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current, isOwner } = useOrg();
  const members = useMembers(current?.org_id);
  const queues = useQueues(current?.org_id);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (members.isLoading || !current) return <Loading label={t('common.loading')} />;
  const m = members.data?.find((x) => x.user_id === id);
  if (!m) return <Empty title={t('admin.member_not_found')} />;

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

  const askReason = (title: string, message: string, confirmLabel: string) =>
    confirm({ title, message, confirmLabel, destructive: true, input: { label: t('admin.reason_required'), minLength: 3, multiline: true } });

  return (
    <Screen>
      <Stack.Screen options={{ title: m.display_name }} />
      <H1>{m.display_name || t('common.deleted_user')}</H1>
      <Small>{m.email}</Small>
      <Body muted>{t(`roles.${m.role}`)}{m.status === 'deactivated' ? ` · ${t('admin.deactivated')}` : ''}</Body>
      <Gap />
      {error ? <Banner kind="error">{error}</Banner> : null}

      <H2>{t('admin.pools')}</H2>
      <Card>
        <Small>{t('admin.pools_member_hint')}</Small>
        <Gap size={space.sm} />
        <Row>
          {queues.data?.map((q) => {
            const inPool = m.queue_ids.includes(q.id);
            return (
              <Chip
                key={q.id}
                label={q.name}
                selected={inPool}
                onPress={async () => {
                  if (!inPool) return run('pool', () => rpc('add_queue_members', { p_queue: q.id, p_user_ids: [m.user_id] }));
                  const reason = await askReason(t('admin.remove_from_pool'), t('admin.remove_from_pool_message', { name: m.display_name }), t('admin.remove'));
                  if (reason !== false) await run('pool', () => rpc('remove_queue_member', { p_queue: q.id, p_user: m.user_id, p_reason: String(reason) }));
                }}
              />
            );
          })}
        </Row>
      </Card>

      <H2>{t('admin.rejoin_blocks')}</H2>
      <Card>
        <Small>{t('admin.allow_rejoin_hint')}</Small>
        <Gap size={space.sm} />
        <Row>
          {queues.data
            ?.filter((q) => m.queue_ids.includes(q.id))
            .map((q) => (
              <Button
                key={q.id}
                variant="secondary"
                title={t('admin.allow_rejoin', { queue: q.name })}
                onPress={() => run('allow', () => rpc('allow_rejoin', { p_queue: q.id, p_user: m.user_id }))}
              />
            ))}
        </Row>
      </Card>

      {m.role !== 'owner' ? (
        <>
          <H2>{t('admin.account')}</H2>
          <View style={{ gap: space.sm }}>
            {isOwner ? (
              <Button
                variant="secondary"
                title={m.role === 'admin' ? t('admin.make_staff') : t('admin.make_admin')}
                onPress={() => run('role', () => rpc('set_member_role', { p_org: current.org_id, p_user: m.user_id, p_role: m.role === 'admin' ? 'staff' : 'admin' }))}
              />
            ) : null}
            {m.status === 'active' ? (
              <Button
                variant="secondary"
                title={t('admin.deactivate')}
                loading={busy === 'deactivate'}
                onPress={async () => {
                  const reason = await askReason(t('admin.deactivate'), t('admin.deactivate_message', { name: m.display_name }), t('admin.deactivate'));
                  if (reason !== false) await run('deactivate', () => rpc('deactivate_member', { p_org: current.org_id, p_user: m.user_id, p_reason: String(reason) }));
                }}
              />
            ) : (
              <Button variant="secondary" title={t('admin.reactivate')} onPress={() => run('reactivate', () => rpc('reactivate_member', { p_org: current.org_id, p_user: m.user_id }))} />
            )}
            <Button
              variant="danger"
              title={t('admin.remove_from_org')}
              loading={busy === 'remove'}
              onPress={async () => {
                const reason = await askReason(t('admin.remove_from_org'), t('admin.remove_from_org_message', { name: m.display_name }), t('admin.remove'));
                if (reason !== false)
                  await run('remove', async () => {
                    await rpc('remove_member', { p_org: current.org_id, p_user: m.user_id, p_reason: String(reason) });
                    router.back();
                  });
              }}
            />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
