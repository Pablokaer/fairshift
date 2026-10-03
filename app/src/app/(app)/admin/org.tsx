import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card, Field, Gap, Screen, Small } from '@/components/ui';
import { rpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';

export default function OrgSettings() {
  const { t } = useTranslation();
  const { current, refresh } = useOrg();
  const [name, setName] = useState('');
  const [tz, setTz] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (current) {
      setName(current.org.name);
      setTz(current.org.timezone);
    }
  }, [current]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await rpc('update_organization', { p_org: current!.org_id, p_name: name.trim(), p_timezone: tz.trim() });
      await refresh();
      setMsg({ kind: 'success', text: t('settings.saved') });
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {msg ? <Banner kind={msg.kind}>{msg.text}</Banner> : null}
      <Card>
        <Field label={t('admin.org_name')} value={name} onChangeText={setName} />
        <Field label={t('admin.timezone')} value={tz} onChangeText={setTz} autoCapitalize="none" hint={t('admin.timezone_hint')} />
        <Small>{t('admin.org_settings_audited')}</Small>
        <Gap />
        <Button title={t('common.save')} onPress={save} loading={busy} />
      </Card>
    </Screen>
  );
}
