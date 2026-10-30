import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { post } from '../../services/api';
import { Alert, Button, Card, EmptyState, ErrorState, Modal, PageHeader, Pagination, Select, SkeletonRows, TextArea, Field } from '../../components/ui';
import { Reasons } from '../../components/Reasons';
import { useToast } from '../../context/ToastContext';
import { usePagedList } from '../../hooks/usePagedList';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';

interface Brief { id: string; emergencyId: string; kind: string; type: string; status: string; description: string; affectedCount: number; address?: string; createdAt: string }
interface Pair { key: string; a: Brief; b: Brief | null; score: number; reasons: { code: string; points?: number; params?: Record<string, unknown> }[]; distanceMeters: number; similarity: number; reviewStatus: string; note?: string }
type Decision = 'related' | 'confirmed_duplicate' | 'not_duplicate';

/** Duplicates are only ever flagged for review. Reports are never deleted or merged, whatever the decision. */
export default function AdminDuplicates() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const list = usePagedList<Pair>('/emergencies/duplicates/pairs', { status }, { searchable: false, events: ['emergency:created', 'sos:created', 'emergency:updated'] });
  const [dlg, setDlg] = useState<{ pair: Pair; decision: Decision } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!dlg || !dlg.pair.b) return;
    setBusy(true);
    try {
      await post(`/emergencies/${dlg.pair.a.id}/duplicates`, { otherId: dlg.pair.b.id, decision: dlg.decision, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(t('duplicates.saved'));
      setDlg(null); setNote(''); setErr('');
      await list.reload();
    } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(false); }
  };
  const col = (b: Brief | null) => b ? (
    <div className="rounded border border-ink-200 p-3 text-sm">
      <Link className="font-mono font-bold underline" to={`/admin/emergencies/${b.id}`}>{b.emergencyId}</Link> · {t(`emergencyType.${b.type}`)} · {t(`status.${b.status}`)}
      <p className="mt-1 line-clamp-3">{b.description}</p>
      <p className="mt-1 text-xs text-ink-500">{b.affectedCount} {t('common.people')} · {b.address ?? '—'} · {formatDateTime(b.createdAt, i18n.language)}</p>
    </div>
  ) : <p className="text-sm text-ink-500">—</p>;
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.duplicates')} subtitle={t('duplicates.subtitle')} />
      <Alert tone="info">{t('duplicates.neverDeleted')}</Alert>
      <Select aria-label={t('common.status')} className="max-w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
        {['pending', 'related', 'confirmed_duplicate', 'not_duplicate', 'all'].map((s) => <option key={s} value={s}>{s === 'all' ? t('common.all') : t(`duplicates.review.${s}`)}</option>)}
      </Select>
      {list.loading ? <SkeletonRows /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : list.items.length === 0 ? <EmptyState title={t('duplicates.none')} /> : list.items.map((p) => (
        <Card key={p.key} title={`${t('duplicates.score', { score: p.score })} · ${Math.round(p.distanceMeters)} m · ${t('duplicates.similarity', { pct: Math.round(p.similarity * 100) })}`}>
          <div className="grid gap-3 md:grid-cols-2">{col(p.a)}{col(p.b)}</div>
          <div className="mt-3"><Reasons reasons={p.reasons} showPoints={false} /></div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{t(`duplicates.review.${p.reviewStatus}`)}</span>
            {p.note && <span className="text-xs text-ink-500">“{p.note}”</span>}
            <span className="flex-1" />
            <Button variant="secondary" onClick={() => setDlg({ pair: p, decision: 'related' })}>{t('duplicates.review.related')}</Button>
            <Button variant="secondary" onClick={() => setDlg({ pair: p, decision: 'confirmed_duplicate' })}>{t('duplicates.review.confirmed_duplicate')}</Button>
            <Button variant="ghost" onClick={() => setDlg({ pair: p, decision: 'not_duplicate' })}>{t('duplicates.review.not_duplicate')}</Button>
          </div>
        </Card>
      ))}
      <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      {dlg && (
        <Modal open title={t(`duplicates.review.${dlg.decision}`)} onClose={() => setDlg(null)} footer={<><Button variant="secondary" onClick={() => setDlg(null)}>{t('common.cancel')}</Button><Button loading={busy} onClick={() => void submit()}>{t('common.confirm')}</Button></>}>
          {err && <Alert tone="danger">{err}</Alert>}
          <p className="mb-3 text-sm">{t('duplicates.confirmNote')}</p>
          <Field label={t('common.note')}>{(id) => <TextArea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </Modal>
      )}
    </div>
  );
}
