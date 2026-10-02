import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Body, H1, H2, Screen } from '@/components/ui';

const SECTIONS = ['who', 'what', 'why', 'visibility', 'retention', 'rights', 'contact'] as const;

export default function Privacy() {
  const { t } = useTranslation();
  return (
    <Screen>
      <H1>{t('privacy.title')}</H1>
      <Body muted>{t('privacy.intro')}</Body>
      {SECTIONS.map((s) => (
        <View key={s}>
          <H2>{t(`privacy.${s}.title`)}</H2>
          <Body>{t(`privacy.${s}.body`)}</Body>
        </View>
      ))}
    </Screen>
  );
}
