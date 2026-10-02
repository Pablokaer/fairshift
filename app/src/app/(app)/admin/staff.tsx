import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { Badge, Banner, Body, Button, Card, Chip, Field, Gap, H2, ListRow, Loading, Row, Screen, Segmented, Small } from '@/components/ui';
import { rpc, useInvites, useMembers, useQueues } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';

export default function Staff() {
  const { t, i18n } = useTranslation();
  const { current, isOwner } = useOrg();
  const members = useMembers(current?.org_id);
  const invites = useInvites(current?.org_id);
  const queues = useQueues(current?.org_id);
  const qc = useQueryClient();
  const [kind, setKind] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  const [pools, setPools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ kind: 'email' | 'code'; token: string } | null>(null);
  const [search, setSearch] = useState('');

  if (members.isLoading || !current) return <Loading label={t('common.loading')} />;
  const tz = current.org.timezone;

  const invite = async () => {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const [res] = await rpc('create_invite', {
        p_org: current.org_id,
        p_kind: kind,
        p_email: kind === 'email' ? email.trim() : undefined,
        p_role: role,
        p_queue_ids: pools,
      });
      setCreated({ kind, token: res.token });
      setEmail('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['invites'] });
    }
  };

  const filtered = (members.data ?? []).filter((m) =>
    `${m.display_name} ${m.email ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const inviteLink = (token: string) => Linking.createURL(`/invite/${token}`);

  return (
    <Screen refreshControl={<RefreshControl refreshing={members.isRefetching} onRefresh={() => members.refetch()} />}>
      <H2 style={{ marginTop: 0 }}>{t('admin.invite')}</H2>
      <Card>
        <Segmented
          label={t('admin.invite')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'email', label: t('admin.invite_email') },
            { value: 'code', label: t('admin.invite_code') },
          ]}
        />
        {kind === 'email' ? (
          <Field testID="invite-email" label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        ) : (
          <Small>{t('admin.code_explainer')}</Small>
        )}
        {isOwner ? (
          <>
            <Body style={{ fontWeight: '600', marginVertical: space.xs }}>{t('admin.role')}</Body>
            <Row>
              <Chip label={t('roles.staff')} selected={role === 'staff'} onPress={() => setRole('staff')} />
              <Chip label={t('roles.admin')} selected={role === 'admin'} onPress={() => setRole('admin')} />
            </Row>
          </>
        ) : null}
        <Body style={{ fontWeight: '600', marginVertical: space.xs }}>{t('admin.pools_for_invite')}</Body>
        <Row>
          {queues.data?.map((q) => (
            <Chip
              key={q.id}
              label={q.name}
              selected={pools.includes(q.id)}
              onPress={() => setPools(pools.includes(q.id) ? pools.filter((x) => x !== q.id) : [...pools, q.id])}
            />
          ))}
        </Row>
        <Gap />
        {error ? <Banner kind="error">{error}</Banner> : null}
        <Button
          testID="create-invite"
          title={kind === 'email' ? t('admin.send_invite') : t('admin.create_code')}
          onPress={invite}
          loading={busy}
          disabled={kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
        />
        {created ? (
          <View style={{ marginTop: space.md }}>
            <Banner kind="success">
              <Body>{created.kind === 'email' ? t('admin.invite_sent') : t('admin.code_created')}</Body>
              <Body testID="invite-token" selectable style={{ fontWeight: '800', fontSize: created.kind === 'code' ? 24 : 14, marginVertical: space.sm }}>
                {created.kind === 'code' ? created.token : inviteLink(created.token)}
              </Body>
              <Button
                variant="secondary"
                title={t('common.copy')}
                icon="copy"
                onPress={() => Clipboard.setStringAsync(created.kind === 'code' ? created.token : inviteLink(created.token))}
              />
            </Banner>
          </View>
        ) : null}
      </Card>

      <H2>{t('admin.members', { count: members.data?.length ?? 0 })}</H2>
      <Field label={t('common.search')} value={search} onChangeText={setSearch} />
      <Card>
        {filtered.map((m) => (
          <ListRow
            key={m.user_id}
            title={m.display_name || t('common.deleted_user')}
            subtitle={`${t(`roles.${m.role}`)} · ${t('admin.in_pools', { count: m.queue_ids.length })}${m.status === 'deactivated' ? ` · ${t('admin.deactivated')}` : ''}`}
            right={m.status === 'deactivated' ? <Badge label={t('admin.deactivated')} /> : undefined}
            onPress={() => router.push(`/admin/member/${m.user_id}`)}
          />
        ))}
      </Card>

      <H2>{t('admin.recent_invites')}</H2>
      <Card>
        {(invites.data ?? []).map((inv) => {
          const expired = new Date(inv.expires_at).getTime() < Date.now();
          const state = inv.revoked_at ? t('admin.revoked') : expired ? t('admin.expired') : inv.use_count >= inv.max_uses ? t('admin.used') : t('admin.active');
          return (
            <ListRow
              key={inv.id}
              title={inv.kind === 'code' ? `${t('admin.invite_code')}: ${inv.code}` : `${t('admin.invite_email')}: ${inv.email}`}
              subtitle={`${state} · ${t('admin.uses', { used: inv.use_count, max: inv.max_uses })} · ${t('admin.expires', { when: fmtDateTime(inv.expires_at, tz, i18n.language) })}`}
              right={
                !inv.revoked_at && !expired ? (
                  <Button
                    variant="ghost"
                    title={t('admin.revoke')}
                    onPress={async () => {
                      try {
                        await rpc('revoke_invite', { p_invite: inv.id });
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                      qc.invalidateQueries({ queryKey: ['invites'] });
                    }}
                  />
                ) : undefined
              }
            />
          );
        })}
      </Card>
    </Screen>
  );
}
