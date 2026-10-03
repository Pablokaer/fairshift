import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { QueueStateBadge } from '@/components/QueueStateBadge';
import { Banner, Body, Button, Card, Empty, H2, Loading, ProfessionTag, Screen, Small } from '@/components/ui';
import { rpc, useQueueOverview, useRoster, type RosterRow } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { font, space, useTheme } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';

export default function LiveQueue() {
  const { t, i18n } = useTranslation();
  const { profession } = useLocalSearchParams<{ profession: 'doctor' | 'nurse' }>();
  const { current } = useOrg();
  const overview = useQueueOverview(current?.org_id);
  const queue = overview.data?.find((q) => q.profession === profession);
  const roster = useRoster(queue?.queue_id);
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);

  if (overview.isLoading || roster.isLoading || !current) return <Loading label={t('common.loading')} />;
  if (!queue) return <Empty title={t('errors.queue.not_found')} />;
  const tz = current.org.timezone;
  const rows = roster.data ?? [];
  const inLine = rows.filter((r) => r.state !== 'assigned');
  const assigned = rows.filter((r) => r.state === 'assigned');

  const remove = async (r: RosterRow) => {
    const reason = await confirm({
      title: t('admin.remove_entry_title', { name: r.display_name || t('common.deleted_user') }),
      message: t('admin.remove_entry_message'),
      confirmLabel: t('admin.remove_entry'),
      destructive: true,
      input: { label: t('admin.reason'), minLength: 3, multiline: true },
    });
    if (reason === false) return;
    setError(null);
    try {
      await rpc('admin_remove_entry', { p_queue: queue.queue_id, p_user: r.user_id, p_reason: String(reason) });
      roster.refetch();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={roster.isRefetching} onRefresh={() => roster.refetch()} />}>
      <Stack.Screen options={{ title: t(`queues.${profession}`) }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap', marginBottom: space.md }}>
        <ProfessionTag profession={profession} plural />
        <Small>{t('admin.roster_total', { count: inLine.length })}</Small>
      </View>
      <Small style={{ marginBottom: space.md }}>{t('admin.roster_explainer')}</Small>
      {error ? <Banner kind="error">{error}</Banner> : null}

      {inLine.length === 0 ? (
        <Card>
          <Empty icon="people-outline" title={t('admin.queue_empty')} />
        </Card>
      ) : (
        <Card>
          {inLine.map((r, i) => (
            <RosterLine key={r.user_id} r={r} tz={tz} locale={i18n.language} onRemove={() => remove(r)} last={i === inLine.length - 1} />
          ))}
        </Card>
      )}

      {assigned.length > 0 ? (
        <>
          <H2>{t('admin.assigned_section')}</H2>
          <Small style={{ marginBottom: space.md }}>{t('admin.assigned_section_help')}</Small>
          <Card>
            {assigned.map((r, i) => (
              <RosterLine key={r.user_id} r={r} tz={tz} locale={i18n.language} last={i === assigned.length - 1} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function RosterLine({
  r,
  tz,
  locale,
  onRemove,
  last,
}: {
  r: RosterRow;
  tz: string;
  locale: string;
  onRemove?: () => void;
  last?: boolean;
}) {
  const { t } = useTranslation();
  const c = useTheme();
  const name = r.display_name || t('common.deleted_user');
  return (
    <View
      testID={`roster-${name}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: last ? 0 : 0.5, borderColor: c.border }}
    >
      <Text style={{ fontFamily: font.extrabold, fontSize: 20, minWidth: 44, color: r.queue_position ? c.primaryStrong : c.textMuted }}>
        {r.queue_position ? `#${r.queue_position}` : '–'}
      </Text>
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: font.semibold }}>{name}</Body>
        <Small>
          {r.state === 'assigned' && r.assigned_shift_starts_at
            ? t('admin.assigned_for', { when: fmtDateTime(r.assigned_shift_starts_at, tz, locale) })
            : t('admin.joined_at', { when: fmtDateTime(r.joined_at, tz, locale) })}
        </Small>
      </View>
      {r.state !== 'waiting' ? <QueueStateBadge state={r.state} /> : null}
      {r.state === 'assigned' && r.assigned_shift_id ? (
        <Button title={t('admin.open_shift')} variant="ghost" onPress={() => router.push(`/admin/shifts/${r.assigned_shift_id}`)} />
      ) : null}
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('admin.remove_entry')}: ${name}`}
          onPress={onRemove}
          hitSlop={4}
          style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="remove-circle-outline" size={24} color={c.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}
