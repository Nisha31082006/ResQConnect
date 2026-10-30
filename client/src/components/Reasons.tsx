import { useTranslation } from 'react-i18next';
import { reasonText } from '../utils/reasons';

export function Reasons({ reasons, showPoints = true }: { reasons: { code: string; points?: number; params?: Record<string, unknown> }[]; showPoints?: boolean }) {
  const { t } = useTranslation();
  if (!reasons.length) return <p className="text-sm text-ink-500">{t('priority.noReasons')}</p>;
  return (
    <ul className="space-y-1 text-sm">
      {reasons.map((r, i) => (
        <li key={i} className="flex justify-between gap-3 rounded bg-ink-50 px-2 py-1">
          <span>{reasonText(r, t)}</span>
          {showPoints && r.points !== undefined && <span className="font-mono font-semibold">{r.points > 0 ? '+' : ''}{r.points}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Timeline({ items }: { items: { at: string; title: string; note?: string }[] }) {
  const { i18n } = useTranslation();
  return (
    <ol className="relative ml-2 space-y-3 border-l-2 border-ink-200 pl-4">
      {items.map((it, i) => (
        <li key={i}>
          <span className="absolute -left-[7px] mt-1 h-3 w-3 rounded-full bg-brand-600" aria-hidden />
          <p className="text-sm font-semibold">{it.title}</p>
          <p className="text-xs text-ink-500">{new Intl.DateTimeFormat(i18n.language.startsWith('ta') ? 'ta-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(it.at))}</p>
          {it.note && <p className="text-sm text-ink-700">{it.note}</p>}
        </li>
      ))}
    </ol>
  );
}
