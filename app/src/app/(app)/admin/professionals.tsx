import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { QueueStateBadge } from '@/components/QueueStateBadge';
import { Badge, Card, Empty, Field, ListRow, Loading, ProfessionTag, Screen, Segmented, Small } from '@/components/ui';
import { useProfessionals, type Professional } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';

type Filter = 'all' | 'doctor' | 'nurse';

export default function Professionals() {
  const { t } = useTranslation();
  const { current } = useOrg();
  const list = useProfessionals(current?.org_id);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  if (list.isLoading) return <Loading label={t('common.loading')} />;
  const q = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (p) =>
      (filter === 'all' || p.profession === filter) &&
      (!q || p.display_name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q)),
  );

  return (
    <Screen refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} />}>
      <Small style={{ marginBottom: space.md }}>{t('admin.professionals_explainer')}</Small>
      <Segmented
        label={t('admin.filter_profession')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('common.all') },
          { value: 'doctor', label: t('professions_plural.doctor'), testID: 'filter-doctor' },
          { value: 'nurse', label: t('professions_plural.nurse'), testID: 'filter-nurse' },
        ]}
      />
      <Field label={t('admin.search')} value={search} onChangeText={setSearch} autoCapitalize="none" placeholder={t('admin.search_placeholder')} />
      {rows.length === 0 ? (
        <Empty icon="people-outline" title={t('admin.no_professionals')} />
      ) : (
        <Card>
          {rows.map((p, i) => (
            <Row key={p.user_id} p={p} last={i === rows.length - 1} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function Row({ p, last }: { p: Professional; last: boolean }) {
  const { t } = useTranslation();
  const name = p.display_name || t('common.deleted_user');
  const state =
    p.status === 'deactivated'
      ? t('member_status.deactivated')
      : p.queue_state === 'waiting' || p.queue_state === 'paused'
        ? t('admin.position_short', { position: p.queue_position })
        : t(`states.${p.queue_state}`);
  return (
    <ListRow
      testID={`professional-${name}`}
      title={name}
      subtitle={[p.role !== 'staff' ? t(`roles.${p.role}`) : null, state].filter(Boolean).join(' · ')}
      accessibilityLabel={[name, p.profession ? t(`professions.${p.profession}`) : null, p.role !== 'staff' ? t(`roles.${p.role}`) : null, state]
        .filter(Boolean)
        .join(', ')}
      right={
        <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {p.status === 'deactivated' ? <Badge label={t('member_status.deactivated')} tone="danger" /> : null}
          {p.queue_state === 'paused' || p.queue_state === 'assigned' ? <QueueStateBadge state={p.queue_state} /> : null}
          {p.profession ? <ProfessionTag profession={p.profession} size="sm" /> : null}
        </View>
      }
      onPress={() => router.push(`/admin/professional/${p.user_id}`)}
      last={last}
    />
  );
}
