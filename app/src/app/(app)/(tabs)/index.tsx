import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RefreshControl, Text, View } from 'react-native';
import { DevAccountSwitcher } from '@/components/DevAccountSwitcher';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { QueueStateBadge } from '@/components/QueueStateBadge';
import { ShiftDetails } from '@/components/ShiftDetails';
import { Banner, Body, Button, Card, Empty, Gap, H1, H2, Loading, Overline, ProfessionTag, Screen, Small } from '@/components/ui';
import { useMyQueue, type MyQueue } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { font, radius, shadow, space, useTheme } from '@/lib/theme';
import { fmtDateTime } from '@/lib/time';
import { useQueueActions } from '@/lib/useQueueActions';

export default function Home() {
  const { t } = useTranslation();
  const { current, isAdmin } = useOrg();
  const q = useMyQueue(current?.org_id);
  const actions = useQueueActions();

  if (q.isLoading || !current) return <Loading label={t('common.loading')} cards={1} />;
  const me = q.data;

  return (
    <Screen edges={['top']} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}>
      <DevAccountSwitcher />
      <OrgSwitcher />
      <H1>{t('home.title')}</H1>
      {actions.error ? <Banner kind="error">{actions.error}</Banner> : null}

      {!me || me.state === 'no_profession' || !me.profession ? (
        <Card>
          <Empty
            icon="person-circle-outline"
            title={isAdmin ? t('home.manager_title') : t('home.no_profession_title')}
            message={isAdmin ? t('home.manager_body') : t('home.no_profession_body')}
          />
          {isAdmin ? <Button title={t('home.go_to_admin')} icon="grid-outline" onPress={() => router.push('/admin')} /> : null}
        </Card>
      ) : (
        <Hero me={me} tz={current.org.timezone} actions={actions} />
      )}

      {me?.profession ? <HowItWorks /> : null}
    </Screen>
  );
}

function Hero({ me, tz, actions }: { me: MyQueue; tz: string; actions: ReturnType<typeof useQueueActions> }) {
  const { t, i18n } = useTranslation();
  const c = useTheme();
  const profession = me.profession!;
  const total = me.queue_total ?? 0;

  return (
    <View testID="home-hero" style={[styles.hero, shadow.raised, { backgroundColor: c.surface }]}>
      <View style={styles.heroHeader}>
        <ProfessionTag profession={profession} plural />
        <QueueStateBadge state={me.state!} />
      </View>

      {me.state === 'not_joined' ? (
        <>
          <Text
            testID="waiting-count"
            accessibilityRole="header"
            style={[styles.heroTitle, { color: c.text }]}
            maxFontSizeMultiplier={1.6}
          >
            {t(`home.waiting_${profession}`, { count: total })}
          </Text>
          <Body muted style={{ marginBottom: space.xl }}>{t('home.join_hint')}</Body>
          <Button
            testID="join-queue"
            size="lg"
            icon="enter-outline"
            title={t('home.join_cta')}
            onPress={() => actions.join(me)}
            loading={actions.busy === 'join'}
          />
        </>
      ) : null}

      {me.state === 'waiting' || me.state === 'paused' ? (
        <>
          <Overline>{t('home.your_position')}</Overline>
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={t('home.position_a11y', { position: me.queue_position, total })}
            testID="queue-position"
            style={styles.positionRow}
          >
            <Text testID="position-number" style={[styles.positionNumber, { color: c.primaryStrong }]} maxFontSizeMultiplier={1.4}>
              #{me.queue_position}
            </Text>
            <Text testID="position-total" style={[styles.positionTotal, { color: c.textMuted }]} maxFontSizeMultiplier={1.6}>
              {t('home.of_total', { total })}
            </Text>
          </View>
          <View style={styles.liveRow}>
            <View style={[styles.liveDot, { backgroundColor: c.success }]} />
            <Small>{t('home.live_hint')}</Small>
          </View>
          {me.joined_at ? <Small style={{ marginTop: space.xs }}>{t('home.joined_at', { when: fmtDateTime(me.joined_at, tz, i18n.language) })}</Small> : null}

          {me.state === 'paused' ? (
            <>
              <Gap />
              <Banner kind="warning">
                <Body style={{ fontFamily: font.semibold }}>{t('home.paused_title')}</Body>
                <Body>{t('home.paused_body', { position: me.queue_position })}</Body>
              </Banner>
              <Button testID="resume" title={t('queue.resume')} icon="play-outline" onPress={() => actions.resume(me)} loading={actions.busy === 'resume'} />
            </>
          ) : null}

          <Gap size={space.xl} />
          <View style={styles.secondaryRow}>
            {me.state === 'waiting' ? (
              <Button
                testID="pause"
                title={t('queue.pause')}
                variant="secondary"
                icon="pause-outline"
                onPress={() => actions.pause(me)}
                loading={actions.busy === 'pause'}
                accessibilityHint={t('queue.pause_hint')}
                style={{ flex: 1 }}
              />
            ) : null}
            <Button
              testID="leave-queue"
              title={t('queue.leave')}
              variant="dangerOutline"
              icon="exit-outline"
              onPress={() => actions.leave(me)}
              loading={actions.busy === 'leave'}
              accessibilityHint={t('queue.leave_hint')}
              style={{ flex: 1 }}
            />
          </View>
        </>
      ) : null}

      {me.state === 'assigned' && me.shift_starts_at && me.shift_ends_at ? (
        <>
          <View style={styles.assignedTitle}>
            <Ionicons name="checkmark-circle" size={28} color={c.success} />
            <Text accessibilityRole="header" style={[styles.heroTitleSmall, { color: c.text }]}>{t('home.assigned_title')}</Text>
          </View>
          <View testID="assigned-shift" style={[styles.shiftBox, { backgroundColor: c.primaryTint }]}>
            <ShiftDetails startsAt={me.shift_starts_at} endsAt={me.shift_ends_at} tz={tz} unit={me.shift_unit} notes={me.shift_notes} large />
          </View>
          <Body muted style={{ marginTop: space.md }}>{t('home.assigned_explainer')}</Body>
          <Gap />
          <Button title={t('home.see_my_shifts')} variant="secondary" icon="calendar-outline" onPress={() => router.push('/shifts')} />
        </>
      ) : null}
    </View>
  );
}

function HowItWorks() {
  const { t } = useTranslation();
  const rules = ['order', 'slots', 'after_shift', 'pause', 'cancel', 'give_back', 'no_reorder', 'privacy'] as const;
  return (
    <>
      <H2>{t('home.how_it_works')}</H2>
      <Card>
        {rules.map((r) => (
          <View key={r} style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.sm }}>
            <Body muted>•</Body>
            <Body style={{ flex: 1 }}>{t(`rules.${r}`)}</Body>
          </View>
        ))}
      </Card>
    </>
  );
}

const styles = {
  hero: { borderRadius: radius.lg, padding: space.xl, marginBottom: space.md },
  heroHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, gap: space.sm, flexWrap: 'wrap' as const, marginBottom: space.lg },
  heroTitle: { fontFamily: font.bold, fontSize: 26, lineHeight: 33, marginBottom: space.sm },
  heroTitleSmall: { fontFamily: font.bold, fontSize: 22, lineHeight: 28, flexShrink: 1 },
  positionRow: { flexDirection: 'row' as const, alignItems: 'baseline' as const, flexWrap: 'wrap' as const, gap: space.sm, marginTop: space.xs },
  positionNumber: { fontFamily: font.extrabold, fontSize: 88, lineHeight: 96, letterSpacing: -2 },
  positionTotal: { fontFamily: font.semibold, fontSize: 24, lineHeight: 30 },
  liveRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.sm, marginTop: space.xs },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  secondaryRow: { flexDirection: 'row' as const, gap: space.sm, flexWrap: 'wrap' as const },
  assignedTitle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.sm, marginBottom: space.md },
  shiftBox: { borderRadius: radius.md, padding: space.lg },
};
