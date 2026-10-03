import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { ShiftStatusBadge } from '@/components/ShiftStatusBadge';
import { Banner, Body, Button, Card, Chip, Empty, Loading, ProfessionTag, Row, Screen, Segmented, Small } from '@/components/ui';
import { assigneesOf, rpc, useAdminShifts, type AdminShift, type Profession, type ShiftScope } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { font, space, useTheme } from '@/lib/theme';
import { fmtRange } from '@/lib/time';

const PERIODS = [7, 30, 90, 0] as const;

export default function AdminShifts() {
  const { t } = useTranslation();
  const { current } = useOrg();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [scope, setScope] = useState<ShiftScope>('open');
  const [profession, setProfession] = useState<Profession | null>(null);
  const [days, setDays] = useState<number>(30);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shifts = useAdminShifts(current?.org_id, scope, { profession, days: scope === 'history' ? days || null : null });

  const publish = async () => {
    const ok = await confirm({
      title: t('admin.publish_title', { count: selected.length }),
      message: t('admin.publish_message'),
      confirmLabel: t('admin.publish'),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await rpc('publish_shifts', { p_shift_ids: selected });
      const first = selected.length === 1 ? selected[0] : null;
      setSelected([]);
      if (first) router.push(`/admin/shifts/${first}`);
      else setScope('history');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries();
    }
  };

  const rows = shifts.data ?? [];
  return (
    <Screen refreshControl={<RefreshControl refreshing={shifts.isRefetching} onRefresh={() => shifts.refetch()} />}>
      <Segmented
        label={t('admin.shifts')}
        value={scope}
        onChange={(v) => {
          setScope(v);
          setSelected([]);
        }}
        options={[
          { value: 'open', label: t('admin.scope_open'), testID: 'scope-open' },
          { value: 'drafts', label: t('admin.scope_drafts'), testID: 'scope-drafts' },
          { value: 'history', label: t('admin.scope_history'), testID: 'scope-history' },
        ]}
      />
      <Row style={{ marginBottom: space.sm }}>
        <Chip label={t('common.all')} selected={!profession} onPress={() => setProfession(null)} />
        <Chip label={t('professions_plural.doctor')} selected={profession === 'doctor'} onPress={() => setProfession('doctor')} />
        <Chip label={t('professions_plural.nurse')} selected={profession === 'nurse'} onPress={() => setProfession('nurse')} />
      </Row>
      {scope === 'history' ? (
        <Row style={{ marginBottom: space.sm }}>
          {PERIODS.map((d) => (
            <Chip key={d} label={d ? t('admin.last_days', { count: d }) : t('admin.all_time')} selected={days === d} onPress={() => setDays(d)} />
          ))}
        </Row>
      ) : null}
      <Small style={{ marginBottom: space.md }}>{t(`admin.scope_${scope}_help`)}</Small>
      {error ? <Banner kind="error">{error}</Banner> : null}

      <Button testID="new-shift" title={t('admin.new_shift')} icon="add-circle-outline" onPress={() => router.push('/admin/shifts/new')} />
      {scope === 'drafts' && selected.length > 0 ? (
        <Button
          testID="publish-selected"
          title={t('admin.publish_selected', { count: selected.length })}
          icon="paper-plane-outline"
          variant="secondary"
          onPress={publish}
          loading={busy}
          style={{ marginTop: space.sm }}
        />
      ) : null}
      <View style={{ height: space.md }} />

      {shifts.isLoading ? <Loading label={t('common.loading')} cards={2} /> : null}
      {!shifts.isLoading && rows.length === 0 ? (
        <Empty icon="calendar-clear-outline" title={t(`admin.no_${scope}`)} />
      ) : null}
      {rows.map((s) => (
        <ShiftRow
          key={s.shift_id}
          s={s}
          tz={current?.org.timezone ?? 'UTC'}
          selectable={scope === 'drafts'}
          selected={selected.includes(s.shift_id)}
          onToggle={() => setSelected((x) => (x.includes(s.shift_id) ? x.filter((y) => y !== s.shift_id) : [...x, s.shift_id]))}
        />
      ))}
    </Screen>
  );
}

function ShiftRow({
  s,
  tz,
  selectable,
  selected,
  onToggle,
}: {
  s: AdminShift;
  tz: string;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const people = assigneesOf(s).filter((a) => a.status !== 'withdrawn' && a.status !== 'cancelled');
  const range = fmtRange(s.starts_at, s.ends_at, tz, i18n.language);
  return (
    <Card testID={`shift-${s.unit}`} style={selected ? { borderWidth: 2, borderColor: c.primary } : undefined}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
        {selectable ? (
          <Pressable
            testID={`select-${s.unit}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={t('admin.select_shift', { range })}
            onPress={onToggle}
            hitSlop={8}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={26} color={c.primary} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${range}. ${s.unit}. ${t('admin.slots_filled', { filled: s.filled, slots: s.slots })}`}
          onPress={() => router.push(`/admin/shifts/${s.shift_id}`)}
          style={{ flex: 1 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap', marginBottom: space.sm }}>
            <ProfessionTag profession={s.profession} size="sm" />
            <ShiftStatusBadge status={s.status} />
          </View>
          <Body style={{ fontFamily: font.semibold }}>{range}</Body>
          {s.unit ? <Small>{s.unit}</Small> : null}
          <Small style={{ marginTop: space.xs }}>{t('admin.slots_filled', { filled: s.filled, slots: s.slots })}</Small>
          {people.length ? (
            <Small numberOfLines={2}>
              {people.map((a) => `#${a.position ?? '–'} ${a.display_name || t('common.deleted_user')}`).join(' · ')}
            </Small>
          ) : null}
        </Pressable>
      </View>
    </Card>
  );
}
