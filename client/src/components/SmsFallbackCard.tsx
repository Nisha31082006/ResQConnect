import { useTranslation } from 'react-i18next';
import { useSmsNumber } from '../hooks/useSmsNumber';
import { buildSmsBody, smsHref } from '../utils/format';
import { Alert } from './ui';

/**
 * Prepares (but never sends) an SMS to the emergency-response number.
 * Opening the SMS app is NOT the same as sending: the UI says so and never shows "sent" or "delivered".
 */
export function SmsFallbackCard({ type, people, lat, lng, text, reportId, onPrepared }: { type: string; people: number; lat?: number; lng?: number; text?: string; reportId?: string; onPrepared?: () => void }) {
  const { t } = useTranslation();
  const number = useSmsNumber();
  const body = buildSmsBody({ type, people, lat, lng, text, reportId });
  return (
    <section className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4" aria-labelledby="sms-fallback-title">
      <h2 id="sms-fallback-title" className="font-bold text-amber-900">📱 {t('offline.smsTitle')}</h2>
      <p className="mt-1 text-sm text-amber-900">{t('offline.smsIntro')}</p>
      <pre className="mt-3 whitespace-pre-wrap break-words rounded bg-white p-3 text-xs" aria-label={t('offline.smsPreview')}>{body}</pre>
      {number ? (
        <>
          <p className="mt-2 text-sm">{t('offline.smsTo')}: <strong>{number}</strong></p>
          <a href={smsHref(number, body)} onClick={onPrepared} className="btn-primary mt-3 inline-flex">✉ {t('offline.smsOpen')}</a>
        </>
      ) : (
        <div className="mt-3"><Alert tone="warn">{t('offline.smsNoNumber')}</Alert></div>
      )}
      <p className="mt-3 text-xs font-semibold text-amber-900">⚠ {t('offline.smsNotSent')}</p>
    </section>
  );
}
