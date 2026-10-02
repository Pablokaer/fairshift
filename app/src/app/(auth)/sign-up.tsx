import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Body, Button, Field, Gap, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import i18n from '@/i18n';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';

export default function SignUp() {
  const { t } = useTranslation();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim(), locale: i18n.language } },
    });
    setBusy(false);
    if (e) return setError(errorMessage(e));
    if (!data.session) return setInfo(t('auth.check_email'));
    if (next && next.startsWith('/')) router.replace(next as never);
  };

  return (
    <Screen>
      <Body muted style={{ marginBottom: space.lg }}>
        {t('auth.sign_up_help')}
      </Body>
      {error ? <Banner kind="error">{error}</Banner> : null}
      {info ? <Banner kind="success">{info}</Banner> : null}
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
      <Body muted style={{ marginBottom: space.md }}>
        {t('auth.privacy_consent')}
      </Body>
      <Button
        testID="create-account"
        title={t('auth.create_account')}
        onPress={submit}
        loading={busy}
        disabled={name.trim().length < 2 || password.length < 8 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
      />
      <Gap />
      <Link href="/privacy" asChild>
        <Button variant="ghost" title={t('privacy.title')} />
      </Link>
    </Screen>
  );
}
