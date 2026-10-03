import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { Body, Card, Chip, Empty, Gap, H2, Loading, ProfessionTag, Row, Screen, Small, Stat } from '@/components/ui';
import { useFairness, type Profession } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { font, space, useTheme } from '@/lib/theme';

const PERIODS = [30, 90, 365] as const;

export default function Fairness() {
  const { t } = useTranslation();
  const c = useTheme();
  const { current } = useOrg();
  const [days, setDays] = useState<number>(90);
  const [profession, setProfession] = useState<Profession | null>(null);
  const data = useFairness(current?.org_id, days, profession);

  if (data.isLoading) return <Loading label={t('common.loading')} />;
  const people = data.data?.people ?? [];
  const max = Math.max(1, ...people.map((p) => p.shifts_assigned));
  const total = people.reduce((s, p) => s + p.shifts_assigned, 0);
  const avg = people.length ? total / people.length : 0;
  const stats = (data.data?.queues ?? []).filter((q) => !profession || q.profession === profession);

  return (
    <Screen refreshControl={<RefreshControl refreshing={data.isRefetching} onRefresh={() => data.refetch()} />}>
      <Small>{t('fairness.explainer')}</Small>
      <Gap />
      <Row>
        {PERIODS.map((d) => (
          <Chip key={d} label={t('admin.last_days', { count: d })} selected={days === d} onPress={() => setDays(d)} />
        ))}
      </Row>
      <Gap size={space.sm} />
      <Row>
        <Chip label={t('common.all')} selected={!profession} onPress={() => setProfession(null)} />
        <Chip label={t('professions_plural.doctor')} selected={profession === 'doctor'} onPress={() => setProfession('doctor')} />
        <Chip label={t('professions_plural.nurse')} selected={profession === 'nurse'} onPress={() => setProfession('nurse')} />
      </Row>

      <H2>{t('fairness.queues')}</H2>
      {stats.map((s) => (
        <Card key={s.queue_id}>
          <ProfessionTag profession={s.profession} plural />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl, marginTop: space.md }}>
            <Stat value={s.queue_size} label={t('fairness.in_queue')} />
            <Stat value={s.shifts_published} label={t('fairness.shifts_published')} />
            <Stat value={`${s.slots_filled}/${s.slots_published}`} label={t('fairness.slots_filled')} />
            <Stat value={s.avg_wait_hours ?? '–'} label={t('fairness.avg_wait_hours')} />
          </View>
        </Card>
      ))}

      <H2>{t('fairness.per_person')}</H2>
      <Small>{t('fairness.average', { avg: avg.toFixed(1) })}</Small>
      <Gap size={space.sm} />
      {people.length === 0 ? <Empty title={t('fairness.no_data')} icon="stats-chart-outline" /> : null}
      {people.length > 0 ? (
        <Card>
          {people.map((p, i) => (
            <View
              key={p.user_id}
              accessible
              accessibilityLabel={t('fairness.person_a11y', {
                name: p.display_name,
                shifts: p.shifts_assigned,
                noShows: p.no_shows,
                givenBack: p.given_back,
                wait: p.avg_wait_hours ?? '–',
              })}
              style={{ paddingVertical: space.md, borderBottomWidth: i === people.length - 1 ? 0 : 0.5, borderColor: c.border }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
                <Body style={{ fontFamily: font.semibold, flexShrink: 1 }}>{p.display_name || t('common.deleted_user')}</Body>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  {p.profession ? <ProfessionTag profession={p.profession} size="sm" /> : null}
                  <Body style={{ fontFamily: font.extrabold }}>{p.shifts_assigned}</Body>
                </View>
              </View>
              <View style={{ height: 8, backgroundColor: c.surfaceAlt, borderRadius: 4, overflow: 'hidden', marginVertical: 6 }}>
                <View style={{ width: `${(p.shifts_assigned / max) * 100}%`, height: 8, backgroundColor: c.primary, borderRadius: 4 }} />
              </View>
              <Small>
                {t('fairness.person_line', {
                  completed: p.shifts_completed,
                  noShows: p.no_shows,
                  givenBack: p.given_back,
                  wait: p.avg_wait_hours ?? '–',
                })}
                {p.in_queue ? '' : ` · ${t('fairness.not_in_queue')}`}
              </Small>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
