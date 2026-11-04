import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Emergency } from '../types';
import { formatDateTime } from '../utils/format';
import { EmptyState, KindBadge, PriorityBadge, StatusBadge, Table } from './ui';

export function EmergencyTable({ items, basePath, showPriority = true, showReporter = false }: { items: Emergency[]; basePath: string; showPriority?: boolean; showReporter?: boolean }) {
  const { t, i18n } = useTranslation();
  const head = [t('common.id'), t('common.type'), t('common.status'), ...(showPriority ? [t('priority.title')] : []), t('common.people'), ...(showReporter ? [t('common.reporter')] : []), t('common.created'), ''];
  return (
    <Table head={head} empty={items.length === 0 ? <EmptyState title={t('common.noResults')} /> : undefined}>
      {items.map((e) => (
        <tr key={e.id} className={e.kind === 'sos' && e.status === 'pending' ? 'bg-red-50' : ''}>
          <td className="td whitespace-nowrap font-mono text-xs"><div className="flex items-center gap-1">{e.emergencyId} <KindBadge kind={e.kind} /></div></td>
          <td className="td">{t(`emergencyType.${e.type}`)}{e.duplicateOf ? <span className="ml-1 text-xs text-amber-800">({t('duplicates.possible')})</span> : null}</td>
          <td className="td"><StatusBadge status={e.status} /></td>
          {showPriority && <td className="td"><PriorityBadge level={e.effectivePriority.level} confirmed={e.effectivePriority.confirmed} /></td>}
          <td className="td">{e.affectedCount}</td>
          {showReporter && <td className="td">{e.reporter?.name ?? '—'}</td>}
          <td className="td whitespace-nowrap">{formatDateTime(e.createdAt, i18n.language)}</td>
          <td className="td"><Link className="font-semibold text-blue-700 underline" to={`${basePath}/${e.id}`}>{t('common.viewDetails')}</Link></td>
        </tr>
      ))}
    </Table>
  );
}
