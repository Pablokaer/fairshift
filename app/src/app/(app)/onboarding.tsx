import { getCalendars } from 'expo-localization';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Body, Button, Card, Field, Gap, H1, H2, Screen } from '@/components/ui';
import { rpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';

export default function Onboarding() {
  const { t } = useTranslation();
  const { orgs, refresh, setCurrent } = useOrg();
  const [code, setCode] = useState('');
  const [orgName, setOrgName] = useState('');
  const [tz, setTz] = useState(getCalendars()[0]?.timeZone ?? 'UTC');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const done = async (orgId: string) => {
    await refresh();
    setCurrent(orgId);
    router.replace('/');
  };

  const join = async () => {
    setBusy('join');
    setError(null);
    try {
      const orgId = await rpc('accept_invite', { p_token: code.trim() });
      await done(orgId as unknown as string);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      const orgId = await rpc('create_organization', { p_name: orgName.trim(), p_timezone: tz.trim() });
      await done(orgId as unknown as string);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={orgs.length ? ['bottom'] : ['top', 'bottom']}>
      {orgs.length === 0 ? <H1>{t('onboarding.welcome')}</H1> : null}
      <Body muted style={{ marginBottom: space.lg }}>{t('onboarding.explainer')}</Body>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Card>
        <H2 style={{ marginTop: 0 }}>{t('onboarding.join_with_code')}</H2>
        <Field
          testID="invite-code"
          label={t('onboarding.code')}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          hint={t('onboarding.code_hint')}
        />
        <Button testID="join-org" title={t('onboarding.join')} onPress={join} loading={busy === 'join'} disabled={code.trim().length < 6} />
      </Card>
      <Card>
        <H2 style={{ marginTop: 0 }}>{t('onboarding.create_org')}</H2>
        <Body muted style={{ marginBottom: space.md }}>{t('onboarding.create_org_help')}</Body>
        <Field label={t('onboarding.org_name')} value={orgName} onChangeText={setOrgName} />
        <Field label={t('onboarding.timezone')} value={tz} onChangeText={setTz} autoCapitalize="none" hint={t('onboarding.timezone_hint')} />
        <Button title={t('onboarding.create')} variant="secondary" onPress={create} loading={busy === 'create'} disabled={orgName.trim().length < 2} />
      </Card>
      {orgs.length === 0 ? (
        <>
          <Gap />
          <Button variant="ghost" title={t('auth.sign_out')} onPress={() => supabase.auth.signOut()} />
        </>
      ) : null}
    </Screen>
  );
}
