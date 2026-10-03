import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { ShiftDetails } from '@/components/ShiftDetails';
import { AssignmentBadge } from '@/components/ShiftStatusBadge';
import { Banner, Button, Card, Empty, Gap, H1, Loading, ProfessionTag, Screen, Segmented, Small } from '@/components/ui';
import { rpc, useMyShifts, type MyShift } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';

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
          { value: 'upcoming', label: t('shifts.upcoming'), testID: 'shifts-upcoming' },
          { value: 'past', label: t('shifts.past'), testID: 'shifts-past' },
        ]}
      />
      {error ? <Banner kind="error">{error}</Banner> : null}
      {shifts.isLoading ? <Loading label={t('common.loading')} cards={2} /> : null}
      {shifts.data?.length === 0 ? (
        <Empty
          title={scope === 'upcoming' ? t('shifts.none_upcoming') : t('shifts.none_past')}
          message={scope === 'upcoming' ? t('shifts.none_upcoming_help') : undefined}
          icon="calendar-outline"
        />
      ) : null}
      {shifts.data?.map((s) => <ShiftCard key={s.assignment_id} s={s} upcoming={scope === 'upcoming'} onError={setError} />)}
    </Screen>
  );
}

function ShiftCard({ s, upcoming, onError }: { s: MyShift; upcoming: boolean; onError: (e: string | null) => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const started = new Date(s.starts_at).getTime() <= Date.now();

  const giveBack = async () => {
    const reason = await confirm({
      title: t('shifts.give_back_title'),
      message: t('shifts.give_back_message'),
      confirmLabel: t('shifts.give_back'),
      destructive: true,
      input: { label: t('shifts.give_back_reason'), minLength: 0, multiline: true },
    });
    if (reason === false) return;
    setBusy(true);
    onError(null);
    try {
      await rpc('give_back_shift', { p_shift: s.shift_id, p_reason: typeof reason === 'string' && reason ? reason : undefined });
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries();
    }
  };

  return (
    <Card testID={`my-shift-${s.shift_id}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', marginBottom: space.md }}>
        <ProfessionTag profession={s.profession} size="sm" />
        <AssignmentBadge status={s.assignment_status} />
      </View>
      <ShiftDetails startsAt={s.starts_at} endsAt={s.ends_at} tz={s.org_timezone} unit={s.unit} notes={s.notes} />
      {s.queue_position ? <Small style={{ marginTop: space.sm }}>{t('shifts.position_at', { position: s.queue_position })}</Small> : null}
      {upcoming && s.assignment_status === 'active' && !started ? (
        <>
          <Gap />
          <Button title={t('shifts.give_back')} variant="dangerOutline" icon="return-down-back-outline" onPress={giveBack} loading={busy} />
        </>
      ) : null}
    </Card>
  );
}
