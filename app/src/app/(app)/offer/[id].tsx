import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { Countdown } from '@/components/Countdown';
import { Banner, Body, Button, Card, Empty, Gap, H1, Loading, Screen, Small } from '@/components/ui';
import { rpc, useOffer } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { syncServerClock } from '@/lib/serverClock';
import { space } from '@/lib/theme';
import { fmtDate, fmtTime } from '@/lib/time';

export default function OfferScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const offer = useOffer(id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockReady, setClockReady] = useState(false);

  useEffect(() => {
    syncServerClock(true).finally(() => setClockReady(true));
  }, []);

  if (offer.isLoading || !clockReady) return <Loading label={t('common.loading')} />;
  const o = offer.data;
  if (!o) return <Empty title={t('offer.not_found')} />;
  const tz = o.org_timezone;
  const loc = i18n.language;
  const open = o.outcome === null;

  const accept = async () => {
    setBusy('accept');
    setError(null);
    try {
      await rpc('accept_offer', { p_offer: o.offer_id });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      qc.invalidateQueries();
    }
  };

  const decline = async () => {
    const ok = await confirm({
      title: t('offer.decline_title'),
      message: o.decline_policy === 'keep' ? t('offer.decline_keep') : t('offer.decline_end'),
      confirmLabel: t('offer.decline'),
      destructive: o.decline_policy !== 'keep',
    });
    if (!ok) return;
    setBusy('decline');
    setError(null);
    try {
      await rpc('decline_offer', { p_offer: o.offer_id });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      qc.invalidateQueries();
    }
  };

  return (
    <Screen>
      <H1>{t('offer.heading', { queue: o.queue_name })}</H1>
      <Small>{o.org_name}</Small>
      <Gap />
      {error ? <Banner kind="error">{error}</Banner> : null}

      <Card>
        <Body style={{ fontSize: 20, fontWeight: '800' }} testID="offer-date">
          {fmtDate(o.starts_at, tz, loc, { weekday: 'long', year: 'numeric' })}
        </Body>
        <Body style={{ fontSize: 20 }}>
          {fmtTime(o.starts_at, tz, loc)} – {fmtTime(o.ends_at, tz, loc)}
        </Body>
        {o.unit ? <Body style={{ marginTop: space.sm }}>{t('offer.unit', { unit: o.unit })}</Body> : null}
        {o.notes ? <Body muted style={{ marginTop: space.sm }}>{o.notes}</Body> : null}
        <Small style={{ marginTop: space.sm }}>{t('offer.timezone_note', { tz })}</Small>
      </Card>

      {open ? (
        <>
          <Card>
            <Body style={{ textAlign: 'center', marginBottom: space.sm }}>{t('offer.respond_within')}</Body>
            <Countdown expiresAt={o.expires_at} offeredAt={o.offered_at} onExpire={() => setTimeout(() => offer.refetch(), 1500)} />
          </Card>
          <View style={{ gap: space.md }}>
            <Button testID="accept-offer" title={t('offer.accept')} icon="checkmark-circle" onPress={accept} loading={busy === 'accept'} disabled={!!busy} />
            <Button testID="decline-offer" title={t('offer.decline')} variant="secondary" onPress={decline} loading={busy === 'decline'} disabled={!!busy} />
          </View>
          <Gap />
          <Small style={{ textAlign: 'center' }}>{o.decline_policy === 'keep' ? t('offer.decline_keep') : t('offer.decline_end')}</Small>
        </>
      ) : (
        <>
          <Banner kind={o.outcome === 'accepted' ? 'success' : 'info'}>{t(`offer.outcome_${o.outcome}`)}</Banner>
          <Button title={o.outcome === 'accepted' ? t('offer.see_shifts') : t('common.go_home')} onPress={() => router.replace(o.outcome === 'accepted' ? '/shifts' : '/')} />
        </>
      )}
    </Screen>
  );
}
