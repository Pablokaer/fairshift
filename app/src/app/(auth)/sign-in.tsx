import * as Linking from 'expo-linking';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Banner, Body, Button, Field, Gap, H1, Screen, Segmented } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';

export default function SignIn() {
  const { t } = useTranslation();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const afterLogin = () => {
    if (next && next.startsWith('/')) router.replace(next as never);
  };

  const signInWithPassword = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (e) setError(errorMessage(e));
    else afterLogin();
  };

  const sendMagicLink = async () => {
    setBusy(true);
    setError(null);
    const redirect = Linking.createURL('/auth/callback', { queryParams: next ? { next } : undefined });
    const { error: e } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect, shouldCreateUser: true },
    });
    setBusy(false);
    if (e) setError(errorMessage(e));
    else router.push({ pathname: '/verify', params: { email: email.trim(), next: next ?? '' } });
  };

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ alignItems: 'flex-end' }}>
        <LanguageSwitcher />
      </View>
      <H1>{t('app.name')}</H1>
      <Body muted style={{ marginBottom: space.xl }}>
        {t('app.tagline')}
      </Body>
      <Segmented
        label={t('auth.method')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'password', label: t('auth.password') },
          { value: 'magic', label: t('auth.magic_link') },
        ]}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Field
        testID="email"
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
        textContentType="emailAddress"
      />
      {mode === 'password' ? (
        <>
          <Field
            testID="password"
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={signInWithPassword}
          />
          <Button
            testID="sign-in"
            title={t('auth.sign_in')}
            onPress={signInWithPassword}
            loading={busy}
            disabled={!validEmail || password.length < 1}
          />
        </>
      ) : (
        <>
          <Body muted style={{ marginBottom: space.md }}>
            {t('auth.magic_link_help')}
          </Body>
          <Button title={t('auth.send_link')} onPress={sendMagicLink} loading={busy} disabled={!validEmail} />
        </>
      )}
      <Gap size={space.xl} />
      <Link href={{ pathname: '/sign-up', params: next ? { next } : {} }} asChild>
        <Button variant="ghost" title={t('auth.no_account')} />
      </Link>
      <Link href="/privacy" asChild>
        <Button variant="ghost" title={t('privacy.title')} />
      </Link>
    </Screen>
  );
}
