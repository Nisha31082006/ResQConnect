import { useTranslation } from 'react-i18next';
import { reasonText } from '../../../utils/reasons';
import type { ReasonItem } from './types';

/** Compact "why" list: every recommendation shows the rules that produced it. */
export function ReasonList({ reasons }: { reasons: ReasonItem[] }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-1 flex flex-wrap gap-1 text-xs">
      {reasons.map((r, i) => <li key={i} className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-700">{reasonText(r, t)}</li>)}
    </ul>
  );
}
