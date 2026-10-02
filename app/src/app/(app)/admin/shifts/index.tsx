import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, View } from 'react-native';
import { ShiftStatusBadge } from '@/components/ShiftStatusBadge';
import { Banner, Body, Button, Card, Chip, Empty, Gap, Loading, Row, Screen, Small } from '@/components/ui';
import { rpc, useAdminShifts, useQueues, type AdminShift } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space, useTheme } from '@/lib/theme';
import { fmtDate, fmtTime } from '@/lib/time';

type Filter = 'open' | 'draft' | 'assigned' | 'past' | 'all';

export default function AdminShifts() {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const { current } = useOrg();
  const queues = useQueues(current?.org_id);
  const [queueId, setQueueId] = useState<string | undefined>();
  const [filter, setFilter] = useState<Filter>('open');
  const shifts = useAdminShifts(current?.org_id, queueId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  const list = useMemo(() => {
    const now = Date.now();
    return (shifts.data ?? []).filter((s) => {
      const future = new Date(s.ends_at).getTime() > now;
      switch (filter) {
        case 'open':
          return ['published', 'offered', 'unfilled'].includes(s.status) && future;
        case 'draft':
          return s.status === 'draft';
        case 'assigned':
          return s.status === 'assigned';
        case 'past':
          return !future && s.status !== 'draft';
        default:
          return true;
      }
    });
  }, [shifts.data, filter]);

  if (shifts.isLoading || !current) return <Loading label={t('common.loading')} />;
  const tz = current.org.timezone;
  const loc = i18n.language;

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await rpc('publish_shifts', { p_shift_ids: [...selected] });
      setSelected(new Set());
      setFilter('open');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries();
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={shifts.isRefetching} onRefresh={() => shifts.refetch()} />}>
      <Button title={t('admin.new_shifts')} icon="add-circle" onPress={() => router.push('/admin/shifts/new')} />
      <Gap />
      <Row>
        <Chip label={t('admin.all_queues')} selected={!queueId} onPress={() => setQueueId(undefined)} />
        {queues.data?.map((q) => (
          <Chip key={q.id} label={q.name} selected={queueId === q.id} onPress={() => setQueueId(q.id)} />
        ))}
      </Row>
      <Gap size={space.sm} />
      <Row>
        {(['open', 'draft', 'assigned', 'past', 'all'] as Filter[]).map((f) => (
          <Chip key={f} label={t(`admin.filter_${f}`)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </Row>
      <Gap />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {filter === 'draft' && list.length > 0 ? (
        <View style={{ marginBottom: space.md }}>
          <Row>
            <Button
              variant="secondary"
              title={selected.size === list.length ? t('admin.select_none') : t('admin.select_all')}
              onPress={() => setSelected(selected.size === list.length ? new Set() : new Set(list.map((s) => s.shift_id)))}
            />
            <Button
              testID="publish-selected"
              title={t('admin.publish_n', { count: selected.size })}
              icon="send"
              onPress={publish}
              loading={busy}
              disabled={selected.size === 0}
            />
          </Row>
        </View>
      ) : null}
      {list.length === 0 ? <Empty title={t('admin.no_shifts')} icon="calendar-outline" /> : null}
      {list.map((s) => (
        <ShiftRow
          key={s.shift_id}
          s={s}
          tz={tz}
          loc={loc}
          selectable={filter === 'draft'}
          selected={selected.has(s.shift_id)}
          onToggle={() => toggle(s.shift_id)}
        />
      ))}
    </Screen>
  );
}

function ShiftRow({
  s,
  tz,
  loc,
  selectable,
  selected,
  onToggle,
}: {
  s: AdminShift;
  tz: string;
  loc: string;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const progress =
    s.status === 'offered' && s.current_offer_name
      ? t('admin.offered_to', {
          name: s.current_offer_name,
          position: s.current_offer_position,
          time: fmtTime(s.current_offer_expires_at, tz, loc),
        })
      : s.status === 'assigned' || s.status === 'completed' || s.status === 'no_show'
        ? t('admin.assigned_to', { name: s.assignee_name || t('common.deleted_user') })
        : s.status === 'published'
          ? t('admin.waiting_for_free')
          : s.status === 'unfilled'
            ? t('admin.unfilled_hint')
            : '';
  return (
    <Card>
      <Pressable
        testID={`admin-shift-${s.unit}`}
        accessibilityRole={selectable ? 'checkbox' : 'button'}
        accessibilityState={selectable ? { checked: selected } : undefined}
        accessibilityLabel={`${s.queue_name}, ${fmtDate(s.starts_at, tz, loc)} ${fmtTime(s.starts_at, tz, loc)}, ${t(`shift_status.${s.status}`)}. ${progress}`}
        onPress={selectable ? onToggle : () => router.push(`/admin/shifts/${s.shift_id}`)}
        onLongPress={() => router.push(`/admin/shifts/${s.shift_id}`)}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' }}>
          <Body style={{ fontWeight: '700', flexShrink: 1 }}>
            {selectable ? (selected ? '☑ ' : '☐ ') : ''}
            {fmtDate(s.starts_at, tz, loc)} · {fmtTime(s.starts_at, tz, loc)}–{fmtTime(s.ends_at, tz, loc)}
          </Body>
          <ShiftStatusBadge status={s.status} />
        </View>
        <Small>
          {s.queue_name}
          {s.unit ? ` · ${s.unit}` : ''}
        </Small>
        {progress ? <Body style={{ color: c.text, marginTop: space.xs }}>{progress}</Body> : null}
        {s.declined_count + s.expired_count > 0 ? (
          <Small>{t('admin.declined_expired', { declined: s.declined_count, expired: s.expired_count })}</Small>
        ) : null}
      </Pressable>
      {selectable ? (
        <Button variant="ghost" title={t('admin.open_details')} onPress={() => router.push(`/admin/shifts/${s.shift_id}`)} />
      ) : null}
    </Card>
  );
}
