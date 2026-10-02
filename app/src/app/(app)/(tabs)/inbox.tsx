import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl } from 'react-native';
import { Card, Empty, H1, ListRow, Loading, Screen } from '@/components/ui';
import { rpc, useInbox } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { renderNotification } from '@/lib/notificationText';
import { useOrg } from '@/lib/org';
import { fmtDateTime } from '@/lib/time';

export default function Inbox() {
  const { t, i18n } = useTranslation();
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
    <Screen refreshControl={<RefreshControl refreshing={inbox.isRefetching} onRefresh={() => inbox.refetch()} />}>
      <H1>{t('inbox.title')}</H1>
      {items.length === 0 ? <Empty title={t('inbox.empty')} icon="notifications-off-outline" /> : null}
      {items.length > 0 ? (
        <Card>
          {items.map((n) => {
            const r = renderNotification(n.type, n.payload as Record<string, unknown>, t, i18n.language);
            return (
              <ListRow
                key={n.id}
                icon={n.read_at ? 'mail-open-outline' : 'mail-unread'}
                title={`${n.read_at ? '' : '• '}${r.title}`}
                subtitle={`${r.body}\n${fmtDateTime(n.created_at, tz, i18n.language)}`}
                accessibilityLabel={`${n.read_at ? '' : t('inbox.unread') + '. '}${r.title}. ${r.body}`}
                onPress={r.url ? () => router.push(r.url as never) : undefined}
              />
            );
          })}
        </Card>
      ) : null}
    </Screen>
  );
}
