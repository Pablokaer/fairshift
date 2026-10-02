import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { Body, Card, Chip, Empty, Gap, H2, Loading, Row, Screen, Small } from '@/components/ui';
import { useFairness, useQueues } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { space, useTheme } from '@/lib/theme';

const PERIODS = [30, 90, 365] as const;

export default function Fairness() {
  const { t } = useTranslation();
  const c = useTheme();
  const { current } = useOrg();
  const queues = useQueues(current?.org_id);
  const [days, setDays] = useState<number>(90);
  const [queueId, setQueueId] = useState<string | null>(null);
  const data = useFairness(current?.org_id, days, queueId);

  if (data.isLoading) return <Loading label={t('common.loading')} />;
  const people = data.data?.people ?? [];
  const max = Math.max(1, ...people.map((p) => p.shifts_assigned));
  const total = people.reduce((s, p) => s + p.shifts_assigned, 0);
  const avg = people.length ? total / people.length : 0;
  const stats = (data.data?.queues ?? []).filter((q) => !queueId || q.queue_id === queueId);

  return (
    <Screen refreshControl={<RefreshControl refreshing={data.isRefetching} onRefresh={() => data.refetch()} />}>
      <Small>{t('fairness.explainer')}</Small>
      <Gap size={space.sm} />
      <Row>
        {PERIODS.map((d) => <Chip key={d} label={t('admin.last_days', { count: d })} selected={days === d} onPress={() => setDays(d)} />)}
      </Row>
      <Gap size={space.sm} />
      <Row>
        <Chip label={t('admin.all_queues')} selected={!queueId} onPress={() => setQueueId(null)} />
        {queues.data?.map((q) => <Chip key={q.id} label={q.name} selected={queueId === q.id} onPress={() => setQueueId(q.id)} />)}
      </Row>

      <H2>{t('fairness.queues')}</H2>
      {stats.map((s) => (
        <Card key={s.queue_id}>
          <Body style={{ fontWeight: '700' }}>{s.queue_name}</Body>
          <Small>{t('fairness.queue_line', { size: s.queue_size, paused: s.paused, published: s.shifts_published, filled: s.shifts_filled, unfilled: s.shifts_unfilled })}</Small>
          <Small>
            {t('fairness.avg_wait', { hours: s.avg_wait_hours ?? '–' })} · {t('fairness.time_to_fill', { minutes: s.avg_time_to_fill_minutes ?? '–' })}
          </Small>
        </Card>
      ))}

      <H2>{t('fairness.per_person')}</H2>
      <Small>{t('fairness.average', { avg: avg.toFixed(1) })}</Small>
      <Gap size={space.sm} />
      {people.length === 0 ? <Empty title={t('fairness.no_data')} /> : null}
      <Card>
        {people.map((p) => (
          <View
            key={p.user_id}
            accessible
            accessibilityLabel={t('fairness.person_a11y', {
              name: p.display_name,
              shifts: p.shifts_assigned,
              noShows: p.no_shows,
              declined: p.offers_declined,
              expired: p.offers_expired,
              wait: p.avg_wait_hours ?? '–',
            })}
            style={{ paddingVertical: space.sm, borderBottomWidth: 0.5, borderColor: c.border }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
              <Body style={{ fontWeight: '600', flexShrink: 1 }}>{p.display_name || t('common.deleted_user')}</Body>
              <Body style={{ fontWeight: '800' }}>{p.shifts_assigned}</Body>
            </View>
            <View style={{ height: 10, backgroundColor: c.surfaceAlt, borderRadius: 5, overflow: 'hidden', marginVertical: 4 }}>
              <View style={{ width: `${(p.shifts_assigned / max) * 100}%`, height: 10, backgroundColor: c.primary, borderRadius: 5 }} />
            </View>
            <Small>
              {t('fairness.person_line', {
                completed: p.shifts_completed,
                noShows: p.no_shows,
                withdrawals: p.withdrawals,
                declined: p.offers_declined,
                expired: p.offers_expired,
                wait: p.avg_wait_hours ?? '–',
              })}
              {p.in_queue ? '' : ` · ${t('fairness.not_in_queue')}`}
            </Small>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
