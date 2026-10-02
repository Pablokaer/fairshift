import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loading } from '@/components/ui';
import i18n from '@/i18n';
import { useMyQueues, useProfile } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { registerForPush, useNotificationNavigation } from '@/lib/notifications';
import { useOrg } from '@/lib/org';
import { useRealtimeTopics } from '@/lib/realtime';
import { useTheme } from '@/lib/theme';

export default function AppLayout() {
  const { t } = useTranslation();
  const c = useTheme();
  const userId = useUserId();
  const { orgs, loading, current, isAdmin } = useOrg();
  const profile = useProfile(userId);
  const myQueues = useMyQueues(current?.org_id);

  // The language stored on the profile wins over the device language.
  useEffect(() => {
    const locale = profile.data?.locale;
    if (locale && locale !== i18n.language) i18n.changeLanguage(locale);
  }, [profile.data?.locale]);

  useEffect(() => {
    if (userId) registerForPush();
  }, [userId]);
  useNotificationNavigation();

  // Live updates: my inbox, every queue I'm eligible for, and (admins) the whole org.
  const topics = [
    userId ? `user:${userId}` : null,
    ...(myQueues.data ?? []).map((q) => `queue:${q.queue_id}`),
    isAdmin && current ? `org:${current.org_id}:admin` : null,
  ].filter((x): x is string => !!x);
  useRealtimeTopics(topics);

  if (loading) return <Loading label={t('common.loading')} />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.surface },
        headerTintColor: c.primary,
        headerTitleStyle: { color: c.text },
        contentStyle: { backgroundColor: c.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Protected guard={orgs.length > 0}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="queue/[id]" options={{ title: t('queue.title') }} />
        <Stack.Screen name="offer/[id]" options={{ title: t('offer.title'), presentation: 'modal' }} />
        <Stack.Screen name="notification-settings" options={{ title: t('settings.notifications') }} />
        <Stack.Screen name="admin/queues/new" options={{ title: t('admin.new_queue') }} />
        <Stack.Screen name="admin/queues/[id]" options={{ title: t('admin.queue') }} />
        <Stack.Screen name="admin/shifts/index" options={{ title: t('admin.shifts') }} />
        <Stack.Screen name="admin/shifts/new" options={{ title: t('admin.new_shifts') }} />
        <Stack.Screen name="admin/shifts/[id]" options={{ title: t('admin.shift') }} />
        <Stack.Screen name="admin/staff" options={{ title: t('admin.staff') }} />
        <Stack.Screen name="admin/member/[id]" options={{ title: t('admin.member') }} />
        <Stack.Screen name="admin/audit" options={{ title: t('admin.audit') }} />
        <Stack.Screen name="admin/fairness" options={{ title: t('admin.fairness') }} />
        <Stack.Screen name="admin/org" options={{ title: t('admin.org_settings') }} />
      </Stack.Protected>
      <Stack.Screen name="onboarding" options={{ title: t('onboarding.title'), headerShown: orgs.length > 0 }} />
    </Stack>
  );
}
