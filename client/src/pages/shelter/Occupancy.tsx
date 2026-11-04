import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, getPaged, post } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, TextInput } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import type { Shelter } from '../../types';

interface Referral { id: string; people: number; status: string; note?: string; emergency: { id: string; emergencyId: string } | null; createdAt: string; admittedAt?: string }

/** Occupancy changes are validated by the API: never below 0, never above capacity (also under concurrent updates). */
export default function ShelterOccupancy() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useFetch(() => getPaged<Shelter>('/shelters', { mine: true, limit: 50 }), []);
  useSocketEvents(['shelter:updated'], () => void reload());
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.occupancy')} subtitle={t('shelter.occupancySubtitle')} />
      {loading ? <SkeletonRows /> : error ? <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} /> : !data?.data.length ? <EmptyState title={t('shelter.none')} hint={t('shelter.noneHint')} /> : data.data.map((s) => <ShelterCard key={s.id} s={s} onChanged={() => void reload()} />)}
    </div>
  );
}

function ShelterCard({ s, onChanged }: { s: Shelter; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [value, setValue] = useState(String(s.occupancy));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const refs = useFetch(() => get<Referral[]>(`/shelters/${s.id}/referrals`), [s.id]);
  const apply = async (body: { occupancy?: number; delta?: number }) => {
    setBusy(true);
    setErr('');
    try { const r = await post<Shelter>(`/shelters/${s.id}/occupancy`, body); setValue(String(r.occupancy ?? s.occupancy)); toast.success(t('common.saved')); onChanged(); } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(false); }
  };
  const admit = async (id: string) => {
    try { await post(`/shelters/${s.id}/referrals/${id}/admit`); toast.success(t('shelter.admitted')); await refs.reload(); onChanged(); } catch (x) { setErr(errorMessage(x, t)); }
  };
  return (
    <Card title={s.name} actions={<Badge tone={s.status === 'open' ? 'green' : 'red'}>{t(`shelterStatus.${s.status}`)}</Badge>}>
      {err && <div className="mb-3"><Alert tone="danger">{err}</Alert></div>}
      <p className="mb-2 text-lg font-bold">{s.occupancy} / {s.capacity} <span className="text-sm font-normal text-ink-500">({t('shelter.availability', { available: s.available, capacity: s.capacity })})</span></p>
      <div className="mb-3 h-3 overflow-hidden rounded bg-ink-200" aria-hidden><div className={`h-full ${s.available === 0 ? 'bg-red-600' : 'bg-green-600'}`} style={{ width: `${Math.min(100, (s.occupancy / Math.max(1, s.capacity)) * 100)}%` }} /></div>
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="secondary" loading={busy} onClick={() => void apply({ delta: -1 })} aria-label={t('shelter.minusOne')}>−1</Button>
        <Button variant="secondary" loading={busy} onClick={() => void apply({ delta: 1 })} aria-label={t('shelter.plusOne')}>+1</Button>
        <label className="text-sm font-medium" htmlFor={`occ-${s.id}`}>{t('shelter.setOccupancy')}</label>
        <TextInput id={`occ-${s.id}`} type="number" min={0} max={s.capacity} className="max-w-28" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button loading={busy} onClick={() => void apply({ occupancy: Number(value) })}>{t('common.save')}</Button>
      </div>
      <h3 className="mt-5 text-sm font-bold">{t('shelter.referrals')}</h3>
      {refs.data && refs.data.length > 0 ? (
        <ul className="mt-2 divide-y divide-ink-100 text-sm">
          {refs.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{t('shelter.referralLine', { people: r.people })} {r.emergency && <strong>{r.emergency.emergencyId}</strong>} <span className="text-xs text-ink-500">{formatDateTime(r.createdAt, i18n.language)}</span></span>
              {r.status === 'pending' ? <Button onClick={() => void admit(r.id)}>✔ {t('shelter.admit')}</Button> : <Badge tone="green">{t('shelter.admittedBadge')}</Badge>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-500">{t('shelter.noReferrals')}</p>}
    </Card>
  );
}
