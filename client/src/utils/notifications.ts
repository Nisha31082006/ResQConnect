import type { TFunction } from 'i18next';
import type { AppNotification } from '../types';

/** Translate a stored notification by its type; unknown types fall back to the English text saved by the server. */
export function notificationText(n: Pick<AppNotification, 'type' | 'message' | 'params'>, t: TFunction): string {
  const p = { ...(n.params ?? {}) } as Record<string, unknown>;
  if (Array.isArray(p.fields)) p.fields = (p.fields as string[]).join(', ');
  return t(`notificationTypes.${n.type}`, { ...p, defaultValue: n.message });
}
