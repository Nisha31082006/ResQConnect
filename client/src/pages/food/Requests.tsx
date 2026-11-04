import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, Select, SkeletonRows, TextArea, TextInput } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { usePagedList } from '../../hooks/usePagedList';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import type { FoodAllocation, FoodSupply } from '../../types';

const STATUSES = ['requested', 'approved', 'rejected', 'dispatched', 'delivered', 'cancelled'];
const tone = (s: string) => (s === 'delivered' ? 'green' : s === 'rejected' || s === 'cancelled' ? 'red' : s === 'requested' ? 'amber' : 'blue');

/** Food requests: admin approves against a supply (over-allocation is refused by the API), provider dispatches/delivers. */
export default function FoodRequests() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const isProvider = user?.role === 'food_provider';
  const [status, setStatus] = useState('');
  const list = usePagedList<FoodAllocation>('/food/allocations', status ? { status } : {}, { searchable: false, events: ['food:updated'] });
  const [dlg, setDlg] = useState<{ a: FoodAllocation; kind: 'approve' | 'reject' | 'deliver' } | null>(null);
  const [busy, setBusy] = useState('');
  const move = async (a: FoodAllocation, s: string) => {
    setBusy(a.id);
    try { await post(`/food/allocations/${a.id}/status`, { status: s }); toast.success(t('common.saved')); await list.reload(); } catch (x) { toast.error(errorMessage(x, t)); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title={isAdmin ? t('nav.food') + ' — ' + t('food.requests') : t('food.requests')} actions={isAdmin ? <Link className="btn-secondary" to="/admin/food/supplies">{t('food.supplies')}</Link> : undefined} />
      <Select aria-label={t('common.status')} className="max-w-52" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('common.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`food.status.${s}`)}</option>)}</Select>
      {list.loading ? <SkeletonRows /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : list.items.length === 0 ? <EmptyState title={t('food.noRequests')} /> : list.items.map((a) => (
        <Card key={a.id} title={`${a.emergency?.emergencyId ?? a.community ?? '—'} · ${a.quantityRequested} ${t(`food.unit.${a.unit}`)}`} actions={<Badge tone={tone(a.status)}>{t(`food.status.${a.status}`)}</Badge>}>
          <p className="text-xs text-ink-500">{a.requestedBy?.name} · {formatDateTime(a.createdAt, i18n.language)}</p>
          {a.deliveryAddress && <p className="mt-1 text-sm">📍 {a.deliveryAddress}</p>}
          {a.provider && <p className="mt-1 text-sm">{t('food.provider')}: <strong>{a.provider.name}</strong> · {a.supply?.foodType} · {t('food.approvedQty', { count: a.quantityApproved ?? 0 })}{a.quantitySupplied !== undefined && ` · ${t('food.suppliedQty', { count: a.quantitySupplied })}`}</p>}
          {a.decisionNote && <p className="mt-1 text-sm"><strong>{t('common.note')}:</strong> {a.decisionNote}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {isAdmin && a.status === 'requested' && (<><Button onClick={() => setDlg({ a, kind: 'approve' })}>✔ {t('admin.approve')}</Button><Button variant="danger" onClick={() => setDlg({ a, kind: 'reject' })}>✕ {t('roads.reject')}</Button></>)}
            {(isProvider || isAdmin) && a.status === 'approved' && <Button loading={busy === a.id} onClick={() => void move(a, 'dispatched')}>🚚 {t('food.dispatch')}</Button>}
            {(isProvider || isAdmin) && a.status === 'dispatched' && <Button loading={busy === a.id} onClick={() => setDlg({ a, kind: 'deliver' })}>📦 {t('food.markDelivered')}</Button>}
          </div>
        </Card>
      ))}
      <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      {dlg && <Decision d={dlg} onClose={() => setDlg(null)} onDone={() => { setDlg(null); toast.success(t('common.saved')); void list.reload(); }} />}
    </div>
  );
}

function Decision({ d, onClose, onDone }: { d: { a: FoodAllocation; kind: 'approve' | 'reject' | 'deliver' }; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const supplies = useFetch(() => (d.kind === 'approve' ? get<(FoodSupply & { providerName?: string })[]>('/food/supplies') : Promise.resolve([])), [d.kind]);
  const [supplyId, setSupplyId] = useState('');
  const [qty, setQty] = useState(String(d.kind === 'deliver' ? d.a.quantityApproved ?? '' : d.a.quantityRequested));
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const usable = (supplies.data ?? []).filter((s) => s.active && s.unit === d.a.unit && s.quantityAvailable > 0);
  const chosen = usable.find((s) => s.id === supplyId);
  const go = async () => {
    setErr('');
    setBusy(true);
    try {
      if (d.kind === 'approve') {
        if (!supplyId) throw new Error('select');
        await post(`/food/allocations/${d.a.id}/approve`, { supplyId, quantity: Number(qty), ...(note.trim() ? { note: note.trim() } : {}) });
      } else if (d.kind === 'reject') {
        if (note.trim().length < 3) throw new Error('reason');
        await post(`/food/allocations/${d.a.id}/reject`, { note: note.trim() });
      } else await post(`/food/allocations/${d.a.id}/status`, { status: 'delivered', quantitySupplied: Number(qty), ...(note.trim() ? { note: note.trim() } : {}) });
      onDone();
    } catch (x) {
      setErr(x instanceof Error && x.message === 'select' ? t('food.selectSupply') : x instanceof Error && x.message === 'reason' ? t('validation.reason_required') : errorMessage(x, t));
    } finally { setBusy(false); }
  };
  return (
    <Modal open title={t(`food.dialog.${d.kind}`)} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button variant={d.kind === 'reject' ? 'danger' : 'primary'} loading={busy} onClick={() => void go()}>{t('common.confirm')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="danger">{err}</Alert>}
        {d.kind === 'approve' && (
          <>
            <Alert tone="info">{t('food.approveNote')}</Alert>
            <Field label={t('food.supply')} required>{(id) => <Select id={id} value={supplyId} onChange={(e) => setSupplyId(e.target.value)}><option value="">—</option>{usable.map((s) => <option key={s.id} value={s.id}>{s.providerName} · {s.foodType} · {t('food.availableLabel')}: {s.quantityAvailable}</option>)}</Select>}</Field>
            {chosen && Number(qty) > chosen.quantityAvailable && <Alert tone="warn">{t('food.overAllocationWarn', { available: chosen.quantityAvailable })}</Alert>}
          </>
        )}
        {d.kind !== 'reject' && <Field label={d.kind === 'deliver' ? t('food.quantitySupplied') : t('food.quantityApproved')} required>{(id) => <TextInput id={id} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>}
        <Field label={d.kind === 'reject' ? t('common.reason') : t('common.note')} required={d.kind === 'reject'}>{(id) => <TextArea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
