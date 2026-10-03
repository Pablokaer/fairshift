import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { Banner, Body, Card, H2, Loading, Screen, Toggle } from '@/components/ui';
import { useNotificationPrefs } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useOrg } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';

const STAFF_TYPES = ['shift_assigned', 'shift_cancelled', 'shift_updated', 'eligible_to_rejoin', 'moved_top3'];
const ADMIN_TYPES = ['shift_short', 'shift_started_short', 'shift_given_back'];
const EMAIL_TYPES = new Set(['shift_assigned']);

export default function NotificationSettings() {
  const { t } = useTranslation();
  const userId = useUserId();
  const prefs = useNotificationPrefs(userId);
  const { isAdmin } = useOrg();
  const qc = useQueryClient();
  if (prefs.isLoading) return <Loading label={t('common.loading')} />;

  const get = (type: string) => prefs.data?.find((p) => p.type === type) ?? { push: true, email: false };
  const set = async (type: string, patch: { push?: boolean; email?: boolean }) => {
    const cur = get(type);
    await supabase
      .from('notification_prefs')
      .upsert({ user_id: userId!, type, push: patch.push ?? cur.push, email: patch.email ?? cur.email });
    qc.invalidateQueries({ queryKey: ['notification_prefs'] });
  };

  const types = isAdmin ? [...STAFF_TYPES, ...ADMIN_TYPES] : STAFF_TYPES;
  return (
    <Screen>
      {Platform.OS === 'web' ? <Banner kind="info">{t('notifications.web_note')}</Banner> : null}
      <Body muted style={{ marginBottom: space.md }}>{t('notifications.explainer')}</Body>
      {types.map((type) => (
        <Card key={type}>
          <H2 style={{ marginTop: 0, marginBottom: space.xs }}>{t(`notifications.types.${type}`)}</H2>
          <Toggle label={t('notifications.push')} value={get(type).push} onValueChange={(v) => set(type, { push: v })} />
          {EMAIL_TYPES.has(type) ? (
            <Toggle
              label={t('notifications.email_always')}
              hint={t('notifications.email_fallback_hint')}
              value={get(type).email}
              onValueChange={(v) => set(type, { email: v })}
            />
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
