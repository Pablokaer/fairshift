import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';
import i18n, { type AppLocale } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export async function setAppLocale(locale: AppLocale, userId?: string | null) {
  await i18n.changeLanguage(locale);
  if (userId) await supabase.from('profiles').update({ locale }).eq('id', userId);
}

/** Compact EN / PT toggle for screens shown before sign-in. */
export function LanguageSwitcher() {
  const { t, i18n: inst } = useTranslation();
  const c = useTheme();
  const next: AppLocale = inst.language === 'pt-BR' ? 'en' : 'pt-BR';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('settings.switch_language_to', { language: t(`languages.${next}`) })}
      onPress={() => setAppLocale(next)}
      style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 12 }}
    >
      <Text style={{ color: c.primary, fontWeight: '700', fontSize: 16 }}>{next === 'en' ? 'English' : 'Português'}</Text>
    </Pressable>
  );
}
