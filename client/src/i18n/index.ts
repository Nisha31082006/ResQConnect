import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import ta from './locales/ta';

export const LANG_KEY = 'rq_lang';
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ்' },
] as const;

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'ta') return saved;
  } catch {
    /* ignore */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ta') ? 'ta' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ta: { translation: ta } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(code: 'en' | 'ta') {
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = code;
  return i18n.changeLanguage(code);
}
document.documentElement.lang = i18n.language;

export default i18n;
