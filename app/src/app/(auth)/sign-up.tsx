import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Body, Button, Card, Field, Gap, Screen, Segmented } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import i18n from '@/i18n';
import { supabase } from '@/lib/supabase';
import { font, space } from '@/lib/theme';

// Anyone can create an account, but only with their hospital's code: the
// server (auth hook + sign-up trigger) rejects sign-ups without a valid one.
export default function SignUp() {
  const { t } = useTranslation();
  const { next, code: codeParam } = useLocalSearchParams<{ next?: string; code?: string }>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(codeParam ?? '');
  const [profession, setProfession] = useState<'doctor' | 'nurse' | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: name.trim(), locale: i18n.language, hospital_code: code.trim(), profession },
      },
    });
    setBusy(false);
    if (e) return setError(errorMessage(e));
    if (!data.session) return setInfo(t('auth.check_email'));
    if (next && next.startsWith('/')) router.replace(next as never);
  };

  const valid =
    name.trim().length >= 2 &&
    password.length >= 8 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) &&
    code.replace(/[^A-Za-z0-9]/g, '').length >= 6 &&
    !!profession;

  return (
    <Screen>
      <Body muted style={{ marginBottom: space.lg }}>{t('auth.sign_up_help')}</Body>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {info ? <Banner kind="success">{info}</Banner> : null}

      <Card tone="tint">
        <Field
          testID="hospital-code"
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
            { value: 'doctor', label: t('professions.doctor'), testID: 'profession-doctor' },
            { value: 'nurse', label: t('professions.nurse'), testID: 'profession-nurse' },
          ]}
        />
        <Body muted style={{ marginTop: -space.sm }}>{t('signup.profession_hint')}</Body>
      </Card>

      <Field testID="name" label={t('auth.display_name')} value={name} onChangeText={setName} autoComplete="name" hint={t('auth.display_name_hint')} />
      <Field
        testID="email"
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        testID="password"
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        hint={t('auth.password_hint')}
      />
      <Body muted style={{ marginBottom: space.md }}>{t('auth.privacy_consent')}</Body>
      <Button testID="create-account" size="lg" title={t('auth.create_account')} onPress={submit} loading={busy} disabled={!valid} />
      <Gap />
      <Link href="/sign-in" asChild>
        <Button variant="ghost" title={t('auth.have_account')} />
      </Link>
      <Link href="/privacy" asChild>
        <Button variant="ghost" title={t('privacy.title')} />
      </Link>
    </Screen>
  );
}
