import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useConfirm } from '@/components/Confirm';
import { setAppLocale } from '@/components/LanguageSwitcher';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { Banner, Body, Button, Card, Chip, Field, Gap, H1, H2, ListRow, ProfessionTag, Row, Screen, Small, Toggle } from '@/components/ui';
import { SUPPORTED_LOCALES, type AppLocale } from '@/i18n';
import { rpc, useMyQueue, useProfile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { saveTextFile } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';
import { useQueueActions } from '@/lib/useQueueActions';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const profile = useProfile(userId);
  const { current } = useOrg();
  const myQueue = useMyQueue(current?.org_id);
  const actions = useQueueActions();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data) setName(profile.data.display_name);
  }, [profile.data]);

  const saveName = async () => {
    setBusy('name');
    const { error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', userId!);
    setBusy(null);
    setMsg(error ? { kind: 'error', text: errorMessage(error) } : { kind: 'success', text: t('settings.saved') });
    profile.refetch();
  };

  const exportData = async () => {
    setBusy('export');
    try {
      const data = await rpc('export_my_data', {});
      await saveTextFile('fairshift-my-data.json', JSON.stringify(data, null, 2), 'application/json');
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    const typed = await confirm({
      title: t('settings.delete_title'),
      message: t('settings.delete_message'),
      confirmLabel: t('settings.delete_confirm'),
      destructive: true,
      input: { label: t('settings.delete_type', { word: t('settings.delete_word') }), minLength: 1 },
    });
    if (typed === false) return;
    if (String(typed).trim().toUpperCase() !== t('settings.delete_word').toUpperCase()) {
      setMsg({ kind: 'error', text: t('settings.delete_word_mismatch') });
      return;
    }
    setBusy('delete');
    const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    setBusy(null);
    if (error || (data as { error?: string } | null)?.error) {
      let code = (data as { error?: string } | null)?.error;
      try {
        code = code ?? (await (error as { context?: Response }).context?.json())?.error;
      } catch {
        /* ignore */
      }
      setMsg({ kind: 'error', text: errorMessage({ message: code ?? error?.message }) });
      return;
    }
    await supabase.auth.signOut();
  };

  const me = myQueue.data;
  return (
    <Screen edges={['top']}>
      <H1>{t('settings.title')}</H1>
      {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : null}
      {actions.error ? <Banner kind="error">{actions.error}</Banner> : null}

      <H2 style={{ marginTop: 0 }}>{t('settings.hospital')}</H2>
      <Card>
        <OrgSwitcher />
        {current ? (
          <View style={{ gap: space.sm }}>
            <Body>{t('settings.role_line', { role: t(`roles.${current.role}`), tz: current.org.timezone })}</Body>
            {current.profession ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                <ProfessionTag profession={current.profession} />
                <Small>{t('settings.profession_by_managers')}</Small>
              </View>
            ) : (
              <Small>{t('settings.no_profession')}</Small>
            )}
          </View>
        ) : null}
        {me?.queue_id ? (
          <Toggle
            testID="auto-rejoin"
            label={t('queue.auto_rejoin')}
            hint={t('queue.auto_rejoin_hint')}
            value={me.auto_rejoin ?? false}
            onValueChange={(v) => actions.setAutoRejoin(me, v)}
          />
        ) : null}
      </Card>

      <H2>{t('settings.profile')}</H2>
      <Card>
        <Small style={{ marginBottom: space.md }}>{session?.user.email}</Small>
        <Field label={t('auth.display_name')} value={name} onChangeText={setName} hint={t('auth.display_name_hint')} />
        <Button title={t('common.save')} variant="secondary" onPress={saveName} loading={busy === 'name'} disabled={name.trim().length < 2} />
      </Card>

      <H2>{t('settings.language')}</H2>
      <Row>
        {SUPPORTED_LOCALES.map((l: AppLocale) => (
          <Chip key={l} label={t(`languages.${l}`)} selected={i18n.language === l} onPress={() => setAppLocale(l, userId)} />
        ))}
      </Row>

      <H2>{t('settings.more')}</H2>
      <Card>
        <ListRow icon="notifications-outline" title={t('settings.notifications')} onPress={() => router.push('/notification-settings')} />
        <ListRow icon="key-outline" title={t('settings.link_hospital')} onPress={() => router.push('/onboarding')} />
        <ListRow icon="shield-checkmark-outline" title={t('privacy.title')} onPress={() => router.push('/privacy')} last />
      </Card>

      <H2>{t('settings.your_data')}</H2>
      <Card>
        <Body muted style={{ marginBottom: space.md }}>{t('settings.data_explainer')}</Body>
        <Button title={t('settings.export')} variant="secondary" icon="download-outline" onPress={exportData} loading={busy === 'export'} />
        <Gap size={space.sm} />
        <Button title={t('settings.delete_account')} variant="dangerOutline" icon="trash-outline" onPress={deleteAccount} loading={busy === 'delete'} />
      </Card>

      <Gap />
      <Button testID="sign-out" title={t('auth.sign_out')} variant="secondary" icon="log-out-outline" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
