import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { Body, Button, Card, Empty, H1, H2, ListRow, Loading, Screen, Small } from '@/components/ui';
import { useFairness, useQueues } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { space, useTheme } from '@/lib/theme';

export default function AdminHome() {
  const { t } = useTranslation();
  const c = useTheme();
  const { current, isAdmin, isOwner } = useOrg();
  const queues = useQueues(current?.org_id);
  const stats = useFairness(current?.org_id, 30);
  if (!isAdmin) return <Empty title={t('auth.forbidden')} />;
  if (queues.isLoading) return <Loading label={t('common.loading')} />;
  const byQueue = new Map((stats.data?.queues ?? []).map((s) => [s.queue_id, s]));

  return (
    <Screen edges={['top']}
      refreshControl={
        <RefreshControl refreshing={queues.isRefetching} onRefresh={() => Promise.all([queues.refetch(), stats.refetch()])} />
      }
    >
      <H1>{t('admin.title')}</H1>
      <Small>{current?.org.name}</Small>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', marginVertical: space.md }}>
        <Button testID="new-shift" title={t('admin.new_shifts')} icon="add-circle" onPress={() => router.push('/admin/shifts/new')} />
        <Button title={t('admin.new_queue')} variant="secondary" icon="add" onPress={() => router.push('/admin/queues/new')} />
      </View>

      <H2>{t('admin.queues')}</H2>
      {queues.data?.length === 0 ? <Empty title={t('admin.no_queues')} /> : null}
      {queues.data?.map((q) => {
        const s = byQueue.get(q.id);
        return (
          <Card key={q.id}>
            <ListRow
              testID={`admin-queue-${q.name}`}
              title={q.name}
              subtitle={
                s
                  ? t('admin.queue_summary', {
                      size: s.queue_size,
                      paused: s.paused,
                      filled: s.shifts_filled,
                      unfilled: s.shifts_unfilled,
                    })
                  : undefined
              }
              onPress={() => router.push(`/admin/queues/${q.id}`)}
            />
          </Card>
        );
      })}

      <H2>{t('admin.manage')}</H2>
      <Card>
        <ListRow icon="calendar" title={t('admin.shifts')} subtitle={t('admin.shifts_sub')} onPress={() => router.push('/admin/shifts')} />
        <ListRow icon="people" title={t('admin.staff')} subtitle={t('admin.staff_sub')} onPress={() => router.push('/admin/staff')} />
        <ListRow icon="list" title={t('admin.audit')} subtitle={t('admin.audit_sub')} onPress={() => router.push('/admin/audit')} />
        <ListRow icon="stats-chart" title={t('admin.fairness')} subtitle={t('admin.fairness_sub')} onPress={() => router.push('/admin/fairness')} />
        {isOwner ? (
          <ListRow icon="business" title={t('admin.org_settings')} onPress={() => router.push('/admin/org')} />
        ) : null}
      </Card>
      <Body muted style={{ color: c.textMuted }}>{t('admin.no_reorder_note')}</Body>
    </Screen>
  );
}
