import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Body, Button, Field, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';

// Magic link fallback: the e-mail also contains a 6-digit code, which works even
// when the link is opened on a different device.
export default function Verify() {
  const { t } = useTranslation();
  const { email, next } = useLocalSearchParams<{ email: string; next?: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email: email ?? '', token: code.trim(), type: 'email' });
    setBusy(false);
    if (e) return setError(errorMessage(e));
    if (next && next.startsWith('/')) router.replace(next as never);
  };

  return (
    <Screen>
      <Banner kind="success">{t('auth.link_sent', { email })}</Banner>
      <Body muted style={{ marginBottom: space.md }}>
        {t('auth.code_help')}
      </Body>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Field
        label={t('auth.code')}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={10}
      />
      <Button title={t('auth.verify')} onPress={submit} loading={busy} disabled={code.trim().length < 6} />
    </Screen>
  );
}
