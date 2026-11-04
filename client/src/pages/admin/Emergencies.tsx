import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, ErrorState, PageHeader, Pagination, Select, SkeletonRows, TextInput, Checkbox } from '../../components/ui';
import { EmergencyTable } from '../../components/EmergencyTable';
import { usePagedList } from '../../hooks/usePagedList';
import { EMERGENCY_TYPES, PRIORITIES, STATUSES } from '../../utils/enums';
import { errorMessage } from '../../utils/errors';
import type { Emergency } from '../../types';

export default function AdminEmergencies() {
  const { t } = useTranslation();
  const [f, setF] = useState({ status: '', priority: '', type: '', kind: '', duplicates: false });
  const filters = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v !== false));
  const list = usePagedList<Emergency>('/emergencies', filters, { events: ['emergency:created', 'emergency:updated', 'emergency:status', 'assignment:changed'] });
  const sel = (key: keyof typeof f, label: string, options: readonly string[], tp: string) => (
    <Select aria-label={label} className="max-w-44" value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{tp ? t(`${tp}.${o}`) : o}</option>)}
    </Select>
  );
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.emergencies')} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <TextInput aria-label={t('common.search')} placeholder={t('admin.searchEmergencies')} className="max-w-xs" value={list.search} onChange={(e) => list.setSearch(e.target.value)} />
          {sel('kind', t('common.kind'), ['sos', 'normal'], 'kind')}
          {sel('status', t('common.status'), STATUSES, 'status')}
          {sel('priority', t('priority.title'), PRIORITIES, 'priority')}
          {sel('type', t('common.type'), EMERGENCY_TYPES, 'emergencyType')}
          <Checkbox label={t('admin.possibleDuplicates')} checked={f.duplicates} onChange={(v) => setF({ ...f, duplicates: v })} />
        </div>
        {list.loading ? <SkeletonRows /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : <EmergencyTable items={list.items} basePath="/admin/emergencies" showReporter />}
        <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      </Card>
    </div>
  );
}
