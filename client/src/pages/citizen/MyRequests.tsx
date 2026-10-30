import { useTranslation } from 'react-i18next';
import { Card, ErrorState, PageHeader, Pagination, Select, SkeletonRows, TextInput } from '../../components/ui';
import { EmergencyTable } from '../../components/EmergencyTable';
import { usePagedList } from '../../hooks/usePagedList';
import { useState } from 'react';
import { STATUSES } from '../../utils/enums';
import { errorMessage } from '../../utils/errors';
import type { Emergency } from '../../types';

export default function MyRequests() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const list = usePagedList<Emergency>('/emergencies', { mine: true, ...(status ? { status } : {}) }, { events: ['emergency:updated', 'emergency:status', 'sos:updated'] });
  return (
    <div className="space-y-4">
      <PageHeader title={t('citizen.myRequests')} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-3">
          <TextInput aria-label={t('common.search')} placeholder={t('common.search')} className="max-w-xs" value={list.search} onChange={(e) => list.setSearch(e.target.value)} />
          <Select aria-label={t('common.status')} className="max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('common.allStatuses')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </Select>
        </div>
        {list.loading ? <SkeletonRows /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : <EmergencyTable items={list.items} basePath="/citizen/requests" />}
        <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      </Card>
    </div>
  );
}
