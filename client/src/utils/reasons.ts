import type { TFunction } from 'i18next';

/** Translate a priority / suggestion / duplicate reason code. Unknown codes fall back to the raw code. */
export function reasonText(r: { code: string; params?: Record<string, unknown> }, t: TFunction): string {
  const p = { ...(r.params ?? {}) } as Record<string, unknown>;
  for (const k of ['groups', 'matched']) if (Array.isArray(p[k])) p[k] = (p[k] as string[]).join(', ');
  return t(`reason.${r.code}`, { ...p, defaultValue: r.code.replace(/_/g, ' ') });
}
