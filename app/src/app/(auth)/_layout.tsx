import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme';

export default function AuthLayout() {
  const { t } = useTranslation();
  const c = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.primary,
        headerTitleStyle: { color: c.text },
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: t('auth.sign_in'), headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: t('auth.create_account') }} />
      <Stack.Screen name="verify" options={{ title: t('auth.enter_code') }} />
    </Stack>
  );
}
