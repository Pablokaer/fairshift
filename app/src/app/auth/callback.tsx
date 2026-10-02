import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Loading, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// Magic-link landing (PKCE): exchange ?code= for a session.
export default function AuthCallback() {
  const { t } = useTranslation();
  const { code, next, error_description } = useLocalSearchParams<{ code?: string; next?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(error_description ?? null);

  useEffect(() => {
    if (!code) return;
    supabase.auth.exchangeCodeForSession(code).then(({ error: e }) => {
      if (e) setError(errorMessage(e));
      else router.replace((next && next.startsWith('/') ? next : '/') as never);
    });
  }, [code, next]);

  if (error || !code) {
    return (
      <Screen>
        <Banner kind="error">{error ?? t('auth.link_invalid')}</Banner>
        <Button title={t('auth.back_to_sign_in')} onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }
  return <Loading label={t('auth.signing_in')} />;
}
