import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { QueueStateBadge } from '@/components/QueueStateBadge';
import { Banner, Body, Button, Card, Empty, Gap, H1, Loading, Screen, Small } from '@/components/ui';
import { useMyQueues, type MyQueue } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { space, useTheme } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';
import { useQueueActions } from '@/lib/useQueueActions';

export default function Home() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const { current } = useOrg();
  const q = useMyQueues(current?.org_id);
  const actions = useQueueActions();

  if (q.isLoading || !current) return <Loading label={t('common.loading')} />;
  const queues = q.data ?? [];
  const offers = queues.filter((x) => x.state === 'offered');

  return (
    <Screen edges={['top']} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
      <OrgSwitcher />
      <H1>{t('home.title')}</H1>
      {actions.error ? <Banner kind="error">{actions.error}</Banner> : null}
      {offers.map((o) => (
        <Banner key={o.offer_id} kind="warning">
          <Body style={{ fontWeight: '700' }}>{t('home.offer_waiting', { queue: o.queue_name })}</Body>
          <Gap size={space.sm} />
          <Button
            testID={`view-offer-${o.queue_id}`}
            title={t('home.view_offer')}
            icon="flash"
            onPress={() => router.push(`/offer/${o.offer_id}`)}
          />
        </Banner>
      ))}
      {queues.length === 0 ? <Empty title={t('home.no_queues')} message={t('home.no_queues_help')} icon="people-outline" /> : null}
      {queues.map((item) => (
        <QueueCard key={item.queue_id} item={item} tz={current.org.timezone} locale={i18n.language} actions={actions} />
      ))}
      <Small style={{ textAlign: 'center', marginTop: space.md }}>{t('home.live_hint')}</Small>
    </Screen>
  );
}

function QueueCard({
  item,
  tz,
  locale,
  actions,
}: {
  item: MyQueue;
  tz: string;
  locale: string;
  actions: ReturnType<typeof useQueueActions>;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const inQueue = item.state === 'waiting' || item.state === 'paused' || item.state === 'offered';
  const positionText = inQueue
    ? item.lottery_pending
      ? t('home.lottery_pending', { when: fmtDateTime(item.lottery_ends_at, tz, locale) })
      : t('home.position', { position: item.queue_position, total: item.queue_total })
    : item.state === 'assigned'
      ? t('home.assigned_hint')
      : t('home.not_in_queue', { total: item.queue_total });

  return (
    <Card testID={`queue-card-${item.queue_name}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.queue_name}. ${t(`states.${item.state}`)}. ${positionText}`}
        accessibilityHint={t('home.open_queue_hint')}
        onPress={() => router.push(`/queue/${item.queue_id}`)}
      >
        <View style={styles.header}>
          <Body style={styles.name}>{item.queue_name}</Body>
          <QueueStateBadge state={item.state} />
        </View>
        <Body
          testID={`position-${item.queue_name}`}
          style={[styles.position, { color: inQueue && !item.lottery_pending ? c.primary : c.text }]}
        >
          {positionText}
        </Body>
        <Small>{t('home.filled_30d', { count: item.filled_30d })}</Small>
      </Pressable>
      {item.state === 'not_joined' ? (
        <>
          <Gap size={space.sm} />
          {item.needs_approval ? (
            <Small>{t('queue.needs_approval')}</Small>
          ) : item.cooldown_until ? (
            <Small>{t('queue.cooldown_until', { when: fmtDateTime(item.cooldown_until, tz, locale) })}</Small>
          ) : (
            <Button
              testID={`join-${item.queue_name}`}
              title={t('queue.join')}
              variant="secondary"
              onPress={() => actions.join(item)}
              loading={actions.busy === 'join'}
            />
          )}
        </>
      ) : null}
      {item.state === 'paused' ? (
        <>
          <Gap size={space.sm} />
          <Button title={t('queue.resume')} variant="secondary" onPress={() => actions.resume(item)} loading={actions.busy === 'resume'} />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  name: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
  position: { fontSize: 22, lineHeight: 30, fontWeight: '800', marginVertical: space.sm },
});
