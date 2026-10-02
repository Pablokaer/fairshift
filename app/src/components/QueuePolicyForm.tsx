import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { space } from '@/lib/theme';
import { Body, Chip, Field, H2, Row, Small, Toggle } from './ui';

export interface PolicyState {
  acceptance_window_minutes: string;
  decline_policy: 'keep' | 'move_to_end';
  timeout_policy: 'keep' | 'move_to_end';
  pausing_allowed: boolean;
  withdraw_cooldown_hours: string;
  no_show_policy: 'rejoin_end' | 'cooldown' | 'admin_approval';
  no_show_cooldown_hours: string;
  auto_pause_after_timeouts: string; // '' = off
  reoffer_after_withdraw: 'restart' | 'continue';
}

export const DEFAULT_POLICY: PolicyState = {
  acceptance_window_minutes: '30',
  decline_policy: 'keep',
  timeout_policy: 'keep',
  pausing_allowed: true,
  withdraw_cooldown_hours: '0',
  no_show_policy: 'rejoin_end',
  no_show_cooldown_hours: '0',
  auto_pause_after_timeouts: '',
  reoffer_after_withdraw: 'restart',
};

export function policyToJson(p: PolicyState) {
  return {
    acceptance_window_minutes: Number(p.acceptance_window_minutes),
    decline_policy: p.decline_policy,
    timeout_policy: p.timeout_policy,
    pausing_allowed: p.pausing_allowed,
    withdraw_cooldown_hours: Number(p.withdraw_cooldown_hours || 0),
    no_show_policy: p.no_show_policy,
    no_show_cooldown_hours: Number(p.no_show_cooldown_hours || 0),
    auto_pause_after_timeouts: p.auto_pause_after_timeouts ? Number(p.auto_pause_after_timeouts) : 0,
    reoffer_after_withdraw: p.reoffer_after_withdraw,
  };
}

export function policyValid(p: PolicyState) {
  const w = Number(p.acceptance_window_minutes);
  return Number.isFinite(w) && w >= 1 && w <= 10080 && Number(p.withdraw_cooldown_hours || 0) >= 0;
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ marginBottom: space.md }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Body style={{ fontWeight: '600', marginBottom: space.xs }}>{label}</Body>
      <Row>
        {options.map((o) => (
          <Chip key={o.value} label={o.label} selected={value === o.value} onPress={() => onChange(o.value)} />
        ))}
      </Row>
    </View>
  );
}

export function QueuePolicyForm({ value, onChange }: { value: PolicyState; onChange: (p: PolicyState) => void }) {
  const { t } = useTranslation();
  const set = <K extends keyof PolicyState>(k: K, v: PolicyState[K]) => onChange({ ...value, [k]: v });
  const posOpts = [
    { value: 'keep' as const, label: t('policy.keep') },
    { value: 'move_to_end' as const, label: t('policy.move_to_end') },
  ];
  return (
    <View>
      <H2>{t('policy.title')}</H2>
      <Field
        label={t('policy.window')}
        value={value.acceptance_window_minutes}
        onChangeText={(v) => set('acceptance_window_minutes', v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        hint={t('policy.window_hint')}
      />
      <Choice label={t('policy.decline')} value={value.decline_policy} options={posOpts} onChange={(v) => set('decline_policy', v)} />
      <Choice label={t('policy.timeout')} value={value.timeout_policy} options={posOpts} onChange={(v) => set('timeout_policy', v)} />
      <Toggle label={t('policy.pausing')} hint={t('policy.pausing_hint')} value={value.pausing_allowed} onValueChange={(v) => set('pausing_allowed', v)} />
      <Field
        label={t('policy.withdraw_cooldown')}
        value={value.withdraw_cooldown_hours}
        onChangeText={(v) => set('withdraw_cooldown_hours', v.replace(/[^\d.]/g, ''))}
        keyboardType="decimal-pad"
        hint={t('policy.withdraw_cooldown_hint')}
      />
      <Choice
        label={t('policy.reoffer')}
        value={value.reoffer_after_withdraw}
        options={[
          { value: 'restart', label: t('policy.reoffer_restart') },
          { value: 'continue', label: t('policy.reoffer_continue') },
        ]}
        onChange={(v) => set('reoffer_after_withdraw', v)}
      />
      <Choice
        label={t('policy.no_show')}
        value={value.no_show_policy}
        options={[
          { value: 'rejoin_end', label: t('policy.no_show_rejoin_end') },
          { value: 'cooldown', label: t('policy.no_show_cooldown') },
          { value: 'admin_approval', label: t('policy.no_show_admin_approval') },
        ]}
        onChange={(v) => set('no_show_policy', v)}
      />
      {value.no_show_policy === 'cooldown' ? (
        <Field
          label={t('policy.no_show_cooldown_hours')}
          value={value.no_show_cooldown_hours}
          onChangeText={(v) => set('no_show_cooldown_hours', v.replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
        />
      ) : null}
      <Field
        label={t('policy.auto_pause')}
        value={value.auto_pause_after_timeouts}
        onChangeText={(v) => set('auto_pause_after_timeouts', v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        hint={t('policy.auto_pause_hint')}
      />
      <Small>{t('policy.fairness_note')}</Small>
    </View>
  );
}
