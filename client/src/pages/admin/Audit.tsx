import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, ErrorState, PageHeader, Pagination, Select, SkeletonRows, Table, TextInput } from '../../components/ui';
import { usePagedList } from '../../hooks/usePagedList';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';

interface Row { id: string; at: string; actor: string | null; actorRole?: string; action: string; entityType: string; entityId?: string; details?: Record<string, unknown> }
const TYPES = ['Emergency', 'Assignment', 'RescueTeam', 'CompletionReport', 'Shelter', 'RoadBlockage', 'FoodAllocation', 'FoodSupply', 'FoodProvider', 'Escalation', 'Setting', 'User'];

export default function AdminAudit() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const list = usePagedList<Row>('/admin/audit', { ...(action ? { action } : {}), ...(entityType ? { entityType } : {}) }, { limit: 20, searchable: false });
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.audit')} subtitle={t('admin.auditSubtitle')} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-3">
          <TextInput aria-label={t('admin.action')} placeholder={t('admin.actionPlaceholder')} className="max-w-xs" value={action} onChange={(e) => setAction(e.target.value.trim())} />
          <Select aria-label={t('admin.entity')} className="max-w-48" value={entityType} onChange={(e) => setEntityType(e.target.value)}><option value="">{t('admin.entity')}</option>{TYPES.map((x) => <option key={x}>{x}</option>)}</Select>
        </div>
        {list.loading ? <SkeletonRows rows={8} /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : (
          <Table head={[t('admin.when'), t('admin.actor'), t('admin.action'), t('admin.entity'), t('admin.details')]}>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(r.at, i18n.language)}</td>
                <td className="td text-sm">{r.actor ?? '—'} <span className="text-xs text-ink-500">{r.actorRole}</span></td>
                <td className="td font-mono text-xs">{r.action}</td>
                <td className="td text-xs">{r.entityType} <span className="text-ink-500">{r.entityId?.slice(-6)}</span></td>
                <td className="td max-w-md break-words font-mono text-[11px] text-ink-700">{r.details ? JSON.stringify(r.details) : ''}</td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      </Card>
    </div>
  );
}
