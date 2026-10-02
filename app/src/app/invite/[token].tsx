import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Body, Button, Card, Gap, H1, Loading, Screen } from '@/components/ui';
import { rpc } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';

export default function InviteLanding() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session } = useAuth();
  const { setCurrent, refresh } = useOrg();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['invite_preview', token, session?.user.id],
    enabled: !!session && !!token,
    queryFn: async () => (await rpc('get_invite_preview', { p_token: token! }))[0],
  });

  if (!session) {
    const next = `/invite/${token}`;
    return (
      <Screen>
        <H1>{t('invite.title')}</H1>
        <Body style={{ marginBottom: 16 }}>{t('invite.sign_in_first')}</Body>
        <Button title={t('auth.sign_in')} onPress={() => router.push({ pathname: '/sign-in', params: { next } })} />
        <Gap />
        <Button
          variant="secondary"
          title={t('auth.create_account')}
          onPress={() => router.push({ pathname: '/sign-up', params: { next } })}
        />
      </Screen>
    );
  }
  if (preview.isLoading) return <Loading label={t('common.loading')} />;
  const p = preview.data;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const orgId = await rpc('accept_invite', { p_token: token! });
      await refresh();
      setCurrent(orgId as unknown as string);
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>{t('invite.title')}</H1>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {!p || !p.valid ? (
        <Banner kind="error">{t(`errors.${p?.reason ?? 'invite.not_found'}`)}</Banner>
      ) : (
        <Card>
          <Body style={{ fontWeight: '700', fontSize: 18 }}>{p.org_name}</Body>
          <Body muted>{t('invite.role', { role: t(`roles.${p.role}`) })}</Body>
          <Gap />
          <Body>{t('invite.explainer')}</Body>
          <Gap />
          <Button testID="accept-invite" title={t('invite.accept')} onPress={accept} loading={busy} />
        </Card>
      )}
      <Button variant="ghost" title={t('common.go_home')} onPress={() => router.replace('/')} />
    </Screen>
  );
}
