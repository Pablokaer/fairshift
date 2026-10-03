import '@/i18n';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfirmProvider } from '@/components/Confirm';
import { Loading } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { OrgProvider } from '@/lib/org';
import { font, useTheme } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

function RootNavigator() {
  const { session, loading } = useAuth();
  const { t } = useTranslation();
  const c = useTheme();
  if (loading) return <Loading label={t('common.loading')} />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.primaryStrong,
        headerTitleStyle: { color: c.text, fontFamily: font.semibold },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" options={{ title: t('auth.signing_in') }} />
      <Stack.Screen name="privacy" options={{ title: t('privacy.title') }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Inter for every weight we use. If loading fails we still render with the system font.
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <OrgProvider>
            <ConfirmProvider>
              <StatusBar style="dark" />
              <RootNavigator />
            </ConfirmProvider>
          </OrgProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
