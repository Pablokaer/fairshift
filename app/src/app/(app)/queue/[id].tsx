import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { QueueStateBadge } from '@/components/QueueStateBadge';
import { Banner, Body, Button, Card, Empty, Gap, H1, H2, ListRow, Loading, Screen, Small, Toggle } from '@/components/ui';
import { useMyQueues, useQueue, useRoster } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { space, useTheme } from '@/lib/theme';
import { fmtDateTime, intervalMinutes } from '@/lib/time';
import { useQueueActions } from '@/lib/useQueueActions';

export default function QueueDetail() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { current, isAdmin } = useOrg();
  const mine = useMyQueues(current?.org_id);
  const queue = useQueue(id);
  const showNames = !!current?.org.staff_can_see_names || isAdmin;
  const roster = useRoster(id, showNames);
  const actions = useQueueActions();

  const item = mine.data?.find((q) => q.queue_id === id);
  if (mine.isLoading || queue.isLoading) return <Loading label={t('common.loading')} />;
  if (!item || !queue.data || !current) return <Empty title={t('queue.not_found')} />;
  const q = queue.data;
  const tz = current.org.timezone;
  const inQueue = ['waiting', 'paused', 'offered'].includes(item.state);
  const windowMin = Math.round(intervalMinutes(q.acceptance_window));

  return (
    <Screen refreshControl={<RefreshControl refreshing={mine.isRefetching} onRefresh={() => mine.refetch()} />}>
      <Stack.Screen options={{ title: item.queue_name }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <H1 style={{ marginBottom: 0, flexShrink: 1 }}>{item.queue_name}</H1>
        <QueueStateBadge state={item.state} />
      </View>
      {item.description ? <Body muted>{item.description}</Body> : null}
      <Gap />
      {actions.error ? <Banner kind="error">{actions.error}</Banner> : null}

      <Card>
        {inQueue && !item.lottery_pending ? (
          <>
            <Body
              accessibilityRole="header"
              testID="queue-position"
              style={{ fontSize: 32, fontWeight: '800', color: c.primary }}
            >
              {t('home.position', { position: item.queue_position, total: item.queue_total })}
            </Body>
            <Small>{t('queue.joined_at', { when: fmtDateTime(item.joined_at, tz, i18n.language) })}</Small>
          </>
        ) : item.lottery_pending ? (
          <Body>{t('home.lottery_pending', { when: fmtDateTime(item.lottery_ends_at, tz, i18n.language) })}</Body>
        ) : item.state === 'assigned' ? (
          <Body>{t('queue.assigned_explainer')}</Body>
        ) : (
          <Body>{t('home.not_in_queue', { total: item.queue_total })}</Body>
        )}
        <Small>{t('home.filled_30d', { count: item.filled_30d })}</Small>
      </Card>

      {item.state === 'offered' && item.offer_id ? (
        <Button title={t('home.view_offer')} icon="flash" onPress={() => router.push(`/offer/${item.offer_id}`)} />
      ) : null}
      {item.state === 'assigned' ? (
        <Button title={t('queue.see_my_shift')} variant="secondary" onPress={() => router.push('/shifts')} />
      ) : null}

      {item.state === 'not_joined' ? (
        item.needs_approval ? (
          <Banner kind="info">{t('queue.needs_approval')}</Banner>
        ) : item.cooldown_until ? (
          <Banner kind="info">{t('queue.cooldown_until', { when: fmtDateTime(item.cooldown_until, tz, i18n.language) })}</Banner>
        ) : (
          <Button testID="join" title={t('queue.join')} onPress={() => actions.join(item)} loading={actions.busy === 'join'} />
        )
      ) : null}

      {item.state === 'paused' ? (
        <Button title={t('queue.resume')} onPress={() => actions.resume(item)} loading={actions.busy === 'resume'} />
      ) : null}

      {item.state === 'waiting' || item.state === 'offered' ? (
        <>
          {item.pausing_allowed ? (
            <>
              <Gap size={space.sm} />
              <Button
                title={t('queue.pause')}
                variant="secondary"
                icon="pause"
                onPress={() => actions.pause(item)}
                loading={actions.busy === 'pause'}
                accessibilityHint={t('queue.pause_hint')}
              />
            </>
          ) : null}
        </>
      ) : null}
      {inQueue ? (
        <>
          <Gap size={space.sm} />
          <Button
            testID="leave"
            title={t('queue.leave')}
            variant="danger"
            icon="exit"
            onPress={() => actions.leave(item)}
            loading={actions.busy === 'leave'}
            accessibilityHint={t('queue.leave_hint')}
          />
        </>
      ) : null}

      <Gap />
      <Toggle
        label={t('queue.auto_rejoin')}
        hint={t('queue.auto_rejoin_hint')}
        value={item.auto_rejoin}
        onValueChange={(v) => actions.setAutoRejoin(item, v)}
      />

      <H2>{t('queue.how_it_works')}</H2>
      <Card>
        <Body>• {t('rules.order')}</Body>
        <Body>• {t('rules.window', { minutes: windowMin })}</Body>
        <Body>• {q.decline_policy === 'keep' ? t('rules.decline_keep') : t('rules.decline_end')}</Body>
        <Body>• {q.timeout_policy === 'keep' ? t('rules.timeout_keep') : t('rules.timeout_end')}</Body>
        <Body>• {t('rules.after_shift')}</Body>
        <Body>• {t('rules.cancel_restore')}</Body>
        <Body>• {intervalMinutes(q.withdraw_cooldown) > 0 ? t('rules.withdraw_cooldown', { hours: Math.round(intervalMinutes(q.withdraw_cooldown) / 60) }) : t('rules.withdraw')}</Body>
        <Body>• {q.pausing_allowed ? t('rules.pause') : t('rules.pause_off')}</Body>
        <Body>• {t(`rules.no_show_${q.no_show_policy}`)}</Body>
        <Body>• {t('rules.no_reorder')}</Body>
      </Card>

      {showNames && roster.data ? (
        <>
          <H2>{t('queue.roster')}</H2>
          <Card>
            {roster.data.map((r, i) => (
              <ListRow
                key={`${r.queue_position}-${i}`}
                title={`${r.queue_position ? `#${r.queue_position} ` : ''}${r.display_name || t('common.deleted_user')}${r.is_me ? ` (${t('common.you')})` : ''}`}
                subtitle={t(`states.${r.state}`)}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
