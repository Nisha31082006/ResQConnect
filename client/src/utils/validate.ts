/** Client-side checks return stable codes, translated under "validation.<code>" (same codes the server uses). */
export type Errors = Record<string, string>;
export const required = (v: unknown): string | undefined => (v === undefined || v === null || String(v).trim() === '' ? 'required' : undefined);
export const minLen = (v: string, n: number): string | undefined => (v.trim().length < n ? 'too_short' : undefined);
export const email = (v: string): string | undefined => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? undefined : 'invalid_email');
export const phone = (v: string): string | undefined => (/^\+?[0-9][0-9\s-]{6,17}$/.test(v.trim()) ? undefined : 'invalid_phone');
export const password = (v: string): string | undefined => (v.length < 8 ? 'password_too_short' : !/[A-Za-z]/.test(v) ? 'password_needs_letter' : !/[0-9]/.test(v) ? 'password_needs_digit' : undefined);
export const intBetween = (v: unknown, min: number, max: number): string | undefined => {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || Number.isNaN(n) || !Number.isInteger(n)) return 'invalid_number';
  return n < min ? (min === 1 ? 'min_one' : 'too_small') : n > max ? 'too_large' : undefined;
};
export function collect(entries: [string, string | undefined][]): Errors {
  const out: Errors = {};
  for (const [k, v] of entries) if (v) out[k] = v;
  return out;
}
/** Translate a codes map through i18n. */
export const translateErrors = (e: Errors, t: (k: string) => string): Errors => Object.fromEntries(Object.entries(e).map(([k, c]) => [k, t(`validation.${c}`)]));
