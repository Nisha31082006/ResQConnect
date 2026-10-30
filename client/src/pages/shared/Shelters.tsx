import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows, TextInput, Checkbox } from '../../components/ui';
import { usePagedList } from '../../hooks/usePagedList';
import { errorMessage } from '../../utils/errors';
import type { Shelter } from '../../types';

/** Read-only shelter directory (citizens, responders). Occupancy is shown as free places. */
export default function ShelterDirectory() {
  const { t } = useTranslation();
  const [availableOnly, setAvailableOnly] = useState(false);
  const list = usePagedList<Shelter>('/shelters', availableOnly ? { availableOnly: true } : {}, { limit: 9, events: ['shelter:updated', 'map:refresh'] });
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.shelters')} subtitle={t('shelter.directorySubtitle')} />
      <div className="flex flex-wrap items-center gap-4">
        <TextInput aria-label={t('common.search')} placeholder={t('common.search')} className="max-w-xs" value={list.search} onChange={(e) => list.setSearch(e.target.value)} />
        <Checkbox label={t('shelter.onlyAvailable')} checked={availableOnly} onChange={setAvailableOnly} />
      </div>
      {list.loading ? <SkeletonRows /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : list.items.length === 0 ? <EmptyState title={t('common.noResults')} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.items.map((s) => (
            <Card key={s.id} title={s.name}>
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={s.status === 'open' && s.available > 0 ? 'green' : s.status === 'closed' ? 'gray' : 'red'}>{t(`shelterStatus.${s.status}`)}</Badge>
                <span className="text-sm font-semibold">{t('shelter.availability', { available: s.available, capacity: s.capacity })}</span>
              </div>
              <div className="mb-2 h-2 overflow-hidden rounded bg-ink-200" role="img" aria-label={t('shelter.availability', { available: s.available, capacity: s.capacity })}>
                <div className={`h-full ${s.available === 0 ? 'bg-red-600' : 'bg-green-600'}`} style={{ width: `${Math.min(100, (s.occupancy / Math.max(1, s.capacity)) * 100)}%` }} />
              </div>
              <p className="text-sm text-ink-700">{s.location?.address ?? '—'}</p>
              {s.facilities.length > 0 && <p className="mt-2 text-xs">{s.facilities.map((f) => t(`facility.${f}`)).join(' · ')}</p>}
              {s.accessibilityNotes && <p className="mt-1 text-xs text-ink-500">♿ {s.accessibilityNotes}</p>}
              {s.contact.phone && <p className="mt-2 text-sm">📞 <a className="underline" href={`tel:${s.contact.phone}`}>{s.contact.phone}</a></p>}
            </Card>
          ))}
        </div>
      )}
      <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
    </div>
  );
}
