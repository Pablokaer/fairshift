import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ptBR from './locales/pt-BR.json';

export const SUPPORTED_LOCALES = ['en', 'pt-BR'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export function deviceLocale(): AppLocale {
  const tag = getLocales()[0]?.languageTag ?? 'en';
  return tag.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, 'pt-BR': { translation: ptBR } },
  lng: deviceLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
