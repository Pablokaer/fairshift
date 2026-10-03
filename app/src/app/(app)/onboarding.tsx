import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Body, Button, Card, Field, Gap, H1, Screen, Segmented } from '@/components/ui';
import { rpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import { font, space } from '@/lib/theme';

// For an account that is not (or no longer) linked to a hospital, or to link a
// second hospital. Hospitals themselves are created by the operator, not here.
export default function Onboarding() {
  const { t } = useTranslation();
  const { orgs, refresh, setCurrent } = useOrg();
  const [code, setCode] = useState('');
  const [profession, setProfession] = useState<'doctor' | 'nurse' | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = async () => {
    setBusy(true);
    setError(null);
    try {
      const orgId = await rpc('join_hospital', { p_code: code.trim(), p_profession: profession as 'doctor' | 'nurse' });
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
    <Screen edges={orgs.length ? ['bottom'] : ['top', 'bottom']}>
      {orgs.length === 0 ? <H1>{t('onboarding.welcome')}</H1> : null}
      <Body muted style={{ marginBottom: space.lg }}>{t('onboarding.explainer')}</Body>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Card>
        <Field
          testID="link-code"
          label={t('signup.hospital_code')}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          hint={t('signup.hospital_code_hint')}
          style={{ fontFamily: font.bold, letterSpacing: 2 }}
        />
        <Body style={{ fontFamily: font.semibold, marginBottom: space.xs }}>{t('signup.profession')}</Body>
        <Segmented
          label={t('signup.profession')}
          value={profession as 'doctor' | 'nurse'}
          onChange={setProfession}
          options={[
            { value: 'doctor', label: t('professions.doctor') },
            { value: 'nurse', label: t('professions.nurse') },
          ]}
        />
        <Button
          testID="link-hospital"
          title={t('onboarding.link')}
          onPress={link}
          loading={busy}
          disabled={code.replace(/[^A-Za-z0-9]/g, '').length < 6 || !profession}
        />
      </Card>
      {orgs.length === 0 ? (
        <>
          <Gap />
          <Body muted>{t('onboarding.no_code')}</Body>
          <Gap />
          <Button variant="ghost" title={t('auth.sign_out')} onPress={() => supabase.auth.signOut()} />
        </>
      ) : null}
    </Screen>
  );
}
