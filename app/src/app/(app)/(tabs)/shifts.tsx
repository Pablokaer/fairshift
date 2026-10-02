import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { Badge, Banner, Body, Button, Card, Empty, Gap, H1, Loading, Screen, Segmented, Small } from '@/components/ui';
import { rpc, useMyShifts, type MyShift } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';
import { fmtDate, fmtTime } from '@/lib/time';

export default function Shifts() {
  const { t } = useTranslation();
  const { current } = useOrg();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const shifts = useMyShifts(scope, current?.org_id);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen edges={['top']} refreshControl={<RefreshControl refreshing={shifts.isRefetching} onRefresh={() => shifts.refetch()} />}>
      <H1>{t('shifts.title')}</H1>
      <Segmented
        label={t('shifts.title')}
        value={scope}
        onChange={setScope}
        options={[
          { value: 'upcoming', label: t('shifts.upcoming') },
          { value: 'past', label: t('shifts.past') },
        ]}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {shifts.isLoading ? <Loading label={t('common.loading')} /> : null}
      {shifts.data?.length === 0 ? (
        <Empty title={scope === 'upcoming' ? t('shifts.none_upcoming') : t('shifts.none_past')} icon="calendar-outline" />
      ) : null}
      {shifts.data?.map((s) => <ShiftCard key={s.assignment_id} s={s} canWithdraw={scope === 'upcoming'} onError={setError} />)}
    </Screen>
  );
}

function ShiftCard({ s, canWithdraw, onError }: { s: MyShift; canWithdraw: boolean; onError: (e: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const loc = i18n.language;
  const started = new Date(s.starts_at).getTime() <= Date.now();

  const withdraw = async () => {
    const reason = await confirm({
      title: t('shifts.withdraw_title'),
      message: t('shifts.withdraw_message'),
      confirmLabel: t('shifts.withdraw'),
      destructive: true,
      input: { label: t('shifts.withdraw_reason'), minLength: 0, multiline: true },
    });
    if (reason === false) return;
    setBusy(true);
    onError(null);
    try {
      await rpc('withdraw_assignment', { p_shift: s.shift_id, p_reason: typeof reason === 'string' && reason ? reason : undefined });
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries();
    }
  };

  const tone = s.assignment_status === 'active' ? 'assigned' : s.assignment_status === 'completed' ? 'waiting' : 'neutral';
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' }}>
        <Body style={{ fontWeight: '700', fontSize: 17, flexShrink: 1 }}>{fmtDate(s.starts_at, s.org_timezone, loc)}</Body>
        <Badge label={t(`assignment.${s.assignment_status}`)} tone={tone} />
      </View>
      <Body>
        {fmtTime(s.starts_at, s.org_timezone, loc)} – {fmtTime(s.ends_at, s.org_timezone, loc)} · {s.queue_name}
      </Body>
      {s.unit ? <Small>{s.unit}</Small> : null}
      {s.notes ? <Small>{s.notes}</Small> : null}
      {canWithdraw && s.assignment_status === 'active' && !started ? (
        <>
          <Gap size={space.sm} />
          <Button title={t('shifts.withdraw')} variant="secondary" onPress={withdraw} loading={busy} />
        </>
      ) : null}
    </Card>
  );
}
