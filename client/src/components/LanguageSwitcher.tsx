import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';
import { useAuth } from '../context/AuthContext';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const { user, updateProfile } = useAuth();
  const change = async (code: 'en' | 'ta') => {
    await setLanguage(code);
    if (user && user.preferredLanguage !== code) void updateProfile({ preferredLanguage: code }).catch(() => undefined);
  };
  return (
    <label className={`inline-flex items-center gap-1 text-sm ${className}`}>
      <span className="sr-only">{t('common.language')}</span>
      <span aria-hidden>🌐</span>
      <select className="rounded-lg border border-ink-300 bg-white px-2 py-1 text-sm" value={i18n.language.startsWith('ta') ? 'ta' : 'en'} onChange={(e) => void change(e.target.value as 'en' | 'ta')}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </label>
  );
}
