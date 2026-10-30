import type { TFunction } from 'i18next';

const locale = (lang: string) => (lang.startsWith('ta') ? 'ta-IN' : 'en-IN');

export const formatDateTime = (iso: string | Date | undefined | null, lang: string): string =>
  iso ? new Intl.DateTimeFormat(locale(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—';

export const formatNumber = (n: number, lang: string) => new Intl.NumberFormat(locale(lang)).format(n);

/** 3725 -> "1h 2m" using translated unit letters. */
export function formatDuration(totalSeconds: number, t: TFunction): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}${t('common.unitH')} ${m}${t('common.unitM')}`;
  if (m > 0) return `${m}${t('common.unitM')} ${sec}${t('common.unitS')}`;
  return `${sec}${t('common.unitS')}`;
}

export const toLocalInput = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function buildSmsBody(p: { type: string; people: number; lat?: number; lng?: number; text?: string; reportId?: string }): string {
  const loc = p.lat !== undefined && p.lng !== undefined ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : 'UNKNOWN';
  const id = p.reportId ? ` ID:${p.reportId}` : '';
  return `RESQ ${p.type.toUpperCase()} ${p.people} ${loc} ${p.text ?? ''}${id}`.trim().slice(0, 300);
}
/** `sms:` links differ slightly between platforms; "?body=" works on Android and modern iOS. */
export const smsHref = (number: string, body: string) => `sms:${number}?body=${encodeURIComponent(body)}`;

export const homePathFor = (role: string) =>
  ({ citizen: '/citizen', volunteer: '/responder', team_leader: '/responder', admin: '/admin', food_provider: '/food', shelter_coordinator: '/shelter' } as Record<string, string>)[role] ?? '/';
