import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useOrg } from '@/lib/org';
import { space } from '@/lib/theme';
import { Chip, Small } from './ui';

/** Shown only when the user belongs to more than one organization. */
export function OrgSwitcher() {
  const { t } = useTranslation();
  const { orgs, current, setCurrent } = useOrg();
  if (orgs.length < 2) {
    return current ? <Small style={{ marginBottom: space.xs }}>{current.org.name}</Small> : null;
  }
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('org.switch')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
      {orgs.map((o) => (
        <Chip key={o.org_id} label={o.org.name} selected={o.org_id === current?.org_id} onPress={() => setCurrent(o.org_id)} />
      ))}
    </View>
  );
}
