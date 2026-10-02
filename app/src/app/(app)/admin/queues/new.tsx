import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_POLICY, policyToJson, policyValid, QueuePolicyForm, type PolicyState } from '@/components/QueuePolicyForm';
import { Banner, Button, Field, Gap, Screen, Small, Toggle } from '@/components/ui';
import { rpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useOrg } from '@/lib/org';

export default function NewQueue() {
  const { t } = useTranslation();
  const { current } = useOrg();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [policy, setPolicy] = useState<PolicyState>(DEFAULT_POLICY);
  const [lottery, setLottery] = useState(false);
  const [lotteryHours, setLotteryHours] = useState('48');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const json: Record<string, unknown> = policyToJson(policy);
      if (lottery) json.lottery_ends_at = new Date(Date.now() + Number(lotteryHours) * 3_600_000).toISOString();
      const id = await rpc('create_queue', {
        p_org: current!.org_id,
        p_name: name.trim(),
        p_description: description.trim(),
        p_policy: json as never,
      });
      router.replace(`/admin/queues/${id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {error ? <Banner kind="error">{error}</Banner> : null}
      <Field testID="queue-name" label={t('admin.queue_name')} value={name} onChangeText={setName} hint={t('admin.queue_name_hint')} />
      <Field label={t('admin.queue_description')} value={description} onChangeText={setDescription} multiline />
      <QueuePolicyForm value={policy} onChange={setPolicy} />
      <Toggle label={t('policy.lottery')} hint={t('policy.lottery_hint')} value={lottery} onValueChange={setLottery} />
      {lottery ? (
        <Field
          label={t('policy.lottery_hours')}
          value={lotteryHours}
          onChangeText={(v) => setLotteryHours(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
        />
      ) : null}
      <Small>{t('admin.pool_after_create')}</Small>
      <Gap />
      <Button
        testID="create-queue"
        title={t('admin.create_queue')}
        onPress={create}
        loading={busy}
        disabled={name.trim().length < 1 || !policyValid(policy) || (lottery && !(Number(lotteryHours) > 0))}
      />
    </Screen>
  );
}
