import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, View } from 'react-native';
import { HospitalCodeCard } from '@/components/HospitalCodeCard';
import { Body, Button, Card, Empty, H1, H2, ListRow, Loading, ProfessionTag, Screen, Small, Stat } from '@/components/ui';
import { useAdminShifts, useQueueOverview, type QueueOverview } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { font, space } from '@/lib/theme';
import { fmtRange } from '@/lib/time';

export default function AdminHome() {
  const { t, i18n } = useTranslation();
  const { current, isAdmin, isOwner } = useOrg();
  const overview = useQueueOverview(current?.org_id);
  const open = useAdminShifts(current?.org_id, 'open');
  if (!isAdmin) return <Empty title={t('errors.auth.forbidden')} />;
  if (overview.isLoading || !current) return <Loading label={t('common.loading')} />;
  const tz = current.org.timezone;

  return (
    <Screen
      edges={['top']}
      refreshControl={
        <RefreshControl refreshing={overview.isRefetching} onRefresh={() => Promise.all([overview.refetch(), open.refetch()])} />
      }
    >
      <Small>{current.org.name}</Small>
      <H1>{t('admin.title')}</H1>

      <HospitalCodeCard />

      <H2>{t('admin.queues')}</H2>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {(overview.data ?? []).map((q) => (
          <QueueCard key={q.queue_id} q={q} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xl, marginBottom: space.md, gap: space.sm, flexWrap: 'wrap' }}>
        <H2 style={{ marginTop: 0, marginBottom: 0 }}>{t('admin.next_open')}</H2>
        <Button testID="new-shift" title={t('admin.new_shift')} icon="add-circle-outline" onPress={() => router.push('/admin/shifts/new')} />
      </View>
      <Card>
        {open.data?.length ? (
          open.data.slice(0, 5).map((s, i, arr) => (
            <ListRow
              key={s.shift_id}
              testID={`open-shift-${s.unit}`}
              title={fmtRange(s.starts_at, s.ends_at, tz, i18n.language)}
              subtitle={[s.unit, t('admin.slots_filled', { filled: s.filled, slots: s.slots })].filter(Boolean).join(' · ')}
              right={<ProfessionTag profession={s.profession} size="sm" />}
              onPress={() => router.push(`/admin/shifts/${s.shift_id}`)}
              last={i === arr.length - 1}
            />
          ))
        ) : (
          <Empty icon="checkmark-done-outline" title={t('admin.no_open_shifts')} message={t('admin.no_open_shifts_help')} />
        )}
      </Card>

      <H2>{t('admin.manage')}</H2>
      <Card>
        <ListRow testID="admin-shifts" icon="calendar-outline" title={t('admin.shifts')} subtitle={t('admin.shifts_sub')} onPress={() => router.push('/admin/shifts')} />
        <ListRow testID="admin-professionals" icon="people-outline" title={t('admin.professionals')} subtitle={t('admin.professionals_sub')} onPress={() => router.push('/admin/professionals')} />
        <ListRow icon="list-outline" title={t('admin.audit')} subtitle={t('admin.audit_sub')} onPress={() => router.push('/admin/audit')} />
        <ListRow icon="stats-chart-outline" title={t('admin.fairness')} subtitle={t('admin.fairness_sub')} onPress={() => router.push('/admin/fairness')} last={!isOwner} />
        {isOwner ? <ListRow icon="business-outline" title={t('admin.org_settings')} onPress={() => router.push('/admin/org')} last /> : null}
      </Card>
      <Body muted>{t('admin.no_reorder_note')}</Body>
    </Screen>
  );
}

function QueueCard({ q }: { q: QueueOverview }) {
  const { t } = useTranslation();
  return (
    <Pressable
      testID={`queue-card-${q.profession}`}
      accessibilityRole="button"
      accessibilityLabel={t('admin.queue_card_a11y', { queue: t(`queues.${q.profession}`), waiting: q.waiting, paused: q.paused, assigned: q.assigned })}
      onPress={() => router.push(`/admin/queue/${q.profession}`)}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: 280, opacity: pressed ? 0.85 : 1 })}
    >
      <Card style={{ marginBottom: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
          <ProfessionTag profession={q.profession} plural />
          <Small style={{ fontFamily: font.semibold }}>{t('admin.view_queue')} ›</Small>
        </View>
        <View style={{ flexDirection: 'row', gap: space.xl, flexWrap: 'wrap' }}>
          <Stat testID={`count-waiting-${q.profession}`} value={q.waiting + q.paused} label={t('admin.stat_in_queue')} />
          <Stat value={q.paused} label={t('admin.stat_paused')} />
          <Stat value={q.assigned} label={t('admin.stat_assigned')} />
        </View>
        {q.open_slots > 0 ? <Small style={{ marginTop: space.md }}>{t('admin.open_slots', { count: q.open_slots })}</Small> : null}
      </Card>
    </Pressable>
  );
}
