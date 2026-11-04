import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { post } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, Select, SkeletonRows, TextArea } from '../../components/ui';
import { EvidenceList } from '../../components/Evidence';
import { useToast } from '../../context/ToastContext';
import { usePagedList } from '../../hooks/usePagedList';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import type { CompletionReport } from '../../types';

/**
 * Completion verification: submitted -> under review (emergency moves to admin_verification) -> approved (resolved) or rejected (back to in progress).
 * A rejection REQUIRES a reason; every step is audit logged by the API.
 */
export default function AdminVerification() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const list = usePagedList<CompletionReport>('/completion-reports', { ...(status ? { status } : {}), ...(kind ? { kind } : {}) }, { searchable: false, events: ['completion:submitted', 'completion:verified', 'emergency:status'] });
  const [dlg, setDlg] = useState<{ r: CompletionReport; approve: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const startReview = async (r: CompletionReport) => {
    setBusy(r.id);
    try { await post(`/completion-reports/${r.id}/review`); toast.success(t('common.saved')); await list.reload(); } catch (x) { toast.error(errorMessage(x, t)); } finally { setBusy(''); }
  };
  const decide = async () => {
    if (!dlg) return;
    if (!dlg.approve && reason.trim().length < 3) return setErr(t('validation.reason_required'));
    setBusy('d');
    try { await post(`/completion-reports/${dlg.r.id}/decision`, { approve: dlg.approve, ...(reason.trim() ? { reason: reason.trim() } : {}) }); toast.success(t('common.saved')); setDlg(null); setReason(''); setErr(''); await list.reload(); } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(''); }
  };
  const tone = (s: string) => (s === 'approved' ? 'green' : s === 'rejected' ? 'red' : s === 'under_review' ? 'blue' : 'amber');
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.verification')} subtitle={t('admin.verificationSubtitle')} />
      <div className="flex flex-wrap gap-3">
        <Select aria-label={t('common.status')} className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('common.allStatuses')}</option>{['submitted', 'under_review', 'approved', 'rejected'].map((s) => <option key={s} value={s}>{t(`admin.reportStatus.${s}`)}</option>)}</Select>
        <Select aria-label={t('common.kind')} className="max-w-48" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">{t('common.all')}</option><option value="completion">{t('responder.kindCompletion')}</option><option value="assistance">{t('responder.kindAssistance')}</option></Select>
      </div>
      {list.loading ? <SkeletonRows /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : list.items.length === 0 ? <EmptyState title={t('admin.noReports')} /> : list.items.map((r) => (
        <Card key={r.id} title={`${r.emergency.emergencyId ?? ''} · ${r.team?.name ?? r.submittedBy.name ?? ''}`} actions={<Badge tone={tone(r.status)}>{t(`admin.reportStatus.${r.status}`)}</Badge>}>
          <p className="text-xs text-ink-500">{t(r.kind === 'completion' ? 'responder.kindCompletion' : 'responder.kindAssistance')} · {r.submittedBy.name} · {formatDateTime(r.createdAt, i18n.language)}</p>
          <dl className="mt-2 grid gap-2 text-sm md:grid-cols-2">
            <div className="md:col-span-2"><dt className="font-semibold">{t('responder.actionsPerformed')}</dt><dd className="whitespace-pre-wrap">{r.actionsPerformed}</dd></div>
            <div><dt className="font-semibold">{t('responder.peopleAssisted')}</dt><dd>{r.peopleAssisted}</dd></div>
            <div><dt className="font-semibold">{t('responder.resourcesUsed')}</dt><dd>{r.resourcesUsed || '—'}</dd></div>
            {r.notes && <div className="md:col-span-2"><dt className="font-semibold">{t('common.notes')}</dt><dd>{r.notes}</dd></div>}
          </dl>
          {r.evidence.length > 0 && <div className="mt-3"><EvidenceList items={r.evidence} /></div>}
          {r.decisionReason && <p className="mt-2 text-sm"><strong>{t('common.reason')}:</strong> {r.decisionReason}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {r.emergency.id && <Link className="btn-secondary" to={`/admin/emergencies/${r.emergency.id}`}>{t('common.viewDetails')}</Link>}
            {r.kind === 'completion' && r.status === 'submitted' && <Button loading={busy === r.id} onClick={() => void startReview(r)}>🔍 {t('admin.startReview')}</Button>}
            {r.kind === 'completion' && r.status === 'under_review' && (<><Button onClick={() => { setDlg({ r, approve: true }); setErr(''); }}>✔ {t('admin.approveCompletion')}</Button><Button variant="danger" onClick={() => { setDlg({ r, approve: false }); setErr(''); }}>✕ {t('admin.rejectCompletion')}</Button></>)}
          </div>
        </Card>
      ))}
      <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      {dlg && (
        <Modal open title={dlg.approve ? t('admin.approveCompletion') : t('admin.rejectCompletion')} onClose={() => setDlg(null)} footer={<><Button variant="secondary" onClick={() => setDlg(null)}>{t('common.cancel')}</Button><Button variant={dlg.approve ? 'primary' : 'danger'} loading={busy === 'd'} onClick={() => void decide()}>{t('common.confirm')}</Button></>}>
          {err && <Alert tone="danger">{err}</Alert>}
          <p className="mb-3 text-sm">{dlg.approve ? t('admin.approveNote') : t('admin.rejectNote')}</p>
          <Field label={t('common.reason')} required={!dlg.approve}>{(id) => <TextArea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </Modal>
      )}
    </div>
  );
}
