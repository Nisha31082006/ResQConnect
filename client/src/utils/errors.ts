import type { TFunction } from 'i18next';
import { ApiError } from '../services/api';

/** Translate an API error (code + field issues) into a human sentence in the current language. */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return t('errors.NETWORK_ERROR');
    const key = `errors.${err.code}`;
    const translated = t(key, { defaultValue: '' });
    if (translated) return translated;
    return err.message || t('errors.UNKNOWN_ERROR');
  }
  return t('errors.UNKNOWN_ERROR');
}

/** Map `details` to { field: translated message } for inline form errors. */
export function fieldErrors(err: unknown, t: TFunction): Record<string, string> {
  const out: Record<string, string> = {};
  if (err instanceof ApiError) {
    for (const d of err.details) {
      const code = d.code || d.message || 'invalid';
      const msg = t(`validation.${code}`, { defaultValue: '' }) || t(`errors.${code.toUpperCase()}`, { defaultValue: '' }) || t('validation.invalid');
      if (!out[d.path]) out[d.path] = msg;
    }
  }
  return out;
}
