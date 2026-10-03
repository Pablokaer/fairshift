import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, View } from 'react-native';
import { Body, Card, Empty, H1, Loading, Screen, Small } from '@/components/ui';
import { rpc, useInbox } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { renderNotification } from '@/lib/notificationText';
import { useOrg } from '@/lib/org';
import { font, radius, space, useTheme } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';

export default function Inbox() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const userId = useUserId();
  const inbox = useInbox(userId);
  const { current } = useOrg();
  const qc = useQueryClient();

  // Opening the inbox marks everything as read (after a short delay so the
  // unread styling is visible first).
  useFocusEffect(
    useCallback(() => {
      const id = setTimeout(() => {
        rpc('mark_notifications_read', {}).then(() => qc.invalidateQueries({ queryKey: ['inbox'] }));
      }, 1500);
      return () => clearTimeout(id);
    }, [qc]),
  );

  if (inbox.isLoading) return <Loading label={t('common.loading')} />;
  const items = inbox.data ?? [];
  const tz = current?.org.timezone ?? 'UTC';
  return (
    <Screen edges={['top']} refreshControl={<RefreshControl refreshing={inbox.isRefetching} onRefresh={() => inbox.refetch()} />}>
      <H1>{t('inbox.title')}</H1>
      {items.length === 0 ? <Card><Empty title={t('inbox.empty')} message={t('inbox.empty_help')} icon="notifications-off-outline" /></Card> : null}
      {items.map((n) => {
        const r = renderNotification(n.type, n.payload as Record<string, unknown>, t, i18n.language);
        const unread = !n.read_at;
        return (
          <Pressable
            key={n.id}
            accessibilityRole={r.url ? 'button' : undefined}
            accessibilityLabel={`${unread ? t('inbox.unread') + '. ' : ''}${r.title}. ${r.body}`}
            onPress={r.url ? () => router.push(r.url as never) : undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
          >
            <Card style={unread ? { borderLeftWidth: 4, borderLeftColor: c.primary } : undefined}>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={18} color={c.primaryStrong} />
                </View>
                <View style={{ flex: 1 }}>
                  <Body style={{ fontFamily: unread ? font.bold : font.semibold }}>{r.title}</Body>
                  {r.body ? <Body muted>{r.body}</Body> : null}
                  <Small style={{ marginTop: space.xs }}>{fmtDateTime(n.created_at, tz, i18n.language)}</Small>
                </View>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
