import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { get, multipart, post, http } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Select, SkeletonRows, TextArea } from '../../components/ui';
import { EvidenceItem } from '../../components/Evidence';
import { FileInput } from '../../components/FormBits';
import { emptyLoc, locPayload, locValid, LocationPicker, type Loc } from '../../components/LocationPicker';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { BLOCKAGE_TYPES, SEVERITIES } from '../../utils/enums';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import { collect, minLen, required, translateErrors } from '../../utils/validate';
import type { Road } from '../../types';

interface PendingClearance { id: string; note: string; photoUrl: string | null; submittedBy?: string; createdAt: string; blockage: { id: string; type: string; severity: string; description: string; verificationStatus: string } | null }

/**
 * One roads page for every role. The API decides what each role sees; the buttons shown here only mirror those permissions:
 * citizens/responders/admin report, responders submit "cleared" claims, and ONLY an admin can verify or accept clearance.
 */
export default function RoadsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const canReport = ['citizen', 'volunteer', 'team_leader', 'admin'].includes(user?.role ?? '');
  const canClear = ['volunteer', 'team_leader', 'admin'].includes(user?.role ?? '');
  const [filter, setFilter] = useState<'active' | 'cleared' | 'all'>('active');
  const roads = useFetch(() => get<Road[]>('/roads', filter === 'all' ? {} : { status: filter }), [filter]);
  const pending = useFetch(() => (isAdmin ? get<PendingClearance[]>('/roads/clearances/pending') : Promise.resolve([] as PendingClearance[])), [isAdmin]);
  const [report, setReport] = useState(false);
  const [clearFor, setClearFor] = useState<Road | null>(null);
  const [decide, setDecide] = useState<{ kind: 'verify' | 'reject' | 'approve' | 'deny'; id: string } | null>(null);
  const reloadAll = () => { void roads.reload(); void pending.reload(); };
  useSocketEvents(['road:updated', 'map:refresh'], reloadAll);

  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.roads')} subtitle={t('roads.subtitle')} actions={canReport ? <Button onClick={() => setReport(true)}>＋ {t('roads.report')}</Button> : undefined} />
      {isAdmin && pending.data && pending.data.length > 0 && (
        <Card title={t('roads.pendingClearances')}>
          <ul className="space-y-3">
            {pending.data.map((p) => (
              <li key={p.id} className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-semibold">{p.blockage ? `${t(`blockageType.${p.blockage.type}`)} · ${t(`severity.${p.blockage.severity}`)}` : '—'}</p>
                <p className="text-ink-700">{p.blockage?.description}</p>
                <p className="mt-1"><strong>{t('roads.clearanceClaim')}:</strong> {p.note} <span className="text-xs text-ink-500">({p.submittedBy} · {formatDateTime(p.createdAt, i18n.language)})</span></p>
                {p.photoUrl && <div className="mt-2"><EvidenceItem url={p.photoUrl} mime="image/jpeg" /></div>}
                <div className="mt-2 flex gap-2">
                  <Button onClick={() => setDecide({ kind: 'approve', id: p.id })}>✔ {t('roads.approveClearance')}</Button>
                  <Button variant="danger" onClick={() => setDecide({ kind: 'deny', id: p.id })}>✕ {t('roads.denyClearance')}</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex items-center gap-3">
        <label htmlFor="road-filter" className="text-sm font-medium">{t('common.status')}</label>
        <Select id="road-filter" className="max-w-48" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="active">{t('roads.status.active')}</option><option value="cleared">{t('roads.status.cleared')}</option><option value="all">{t('common.all')}</option>
        </Select>
      </div>
      {roads.loading ? <SkeletonRows /> : roads.error ? <ErrorState message={errorMessage(roads.error, t)} onRetry={() => void roads.reload()} /> : !roads.data?.length ? <EmptyState title={t('roads.none')} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {roads.data.map((r) => (
            <Card key={r.id} title={`${t(`blockageType.${r.type}`)} · ${t(`severity.${r.severity}`)}`}>
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge tone={r.verificationStatus === 'verified' ? 'green' : r.verificationStatus === 'rejected' ? 'red' : 'amber'}>{t(`roads.verification.${r.verificationStatus}`)}</Badge>
                <Badge tone={r.status === 'cleared' ? 'green' : 'red'}>{t(`roads.status.${r.status}`)}</Badge>
                {r.clearancePending && <Badge tone="blue">{t('roads.clearancePending')}</Badge>}
              </div>
              {r.verificationStatus === 'unverified' && <p className="mb-2 text-xs text-amber-800">⚠ {t('roads.unverifiedWarning')}</p>}
              <p className="text-sm">{r.description}</p>
              <p className="mt-1 text-xs text-ink-500">{r.location?.address ?? (r.location ? `${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)}` : '')} · {formatDateTime(r.reportedAt, i18n.language)}</p>
              {r.photoUrl && <div className="mt-2"><EvidenceItem url={r.photoUrl} mime="image/jpeg" /></div>}
              {r.verificationNote && <p className="mt-2 text-xs"><strong>{t('roads.adminNote')}:</strong> {r.verificationNote}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {isAdmin && r.verificationStatus === 'unverified' && (
                  <>
                    <Button onClick={() => setDecide({ kind: 'verify', id: r.id })}>✔ {t('roads.verify')}</Button>
                    <Button variant="danger" onClick={() => setDecide({ kind: 'reject', id: r.id })}>✕ {t('roads.reject')}</Button>
                  </>
                )}
                {canClear && r.status === 'active' && r.verificationStatus !== 'rejected' && !r.clearancePending && <Button variant="secondary" onClick={() => setClearFor(r)}>🧹 {t('roads.reportCleared')}</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {report && <ReportModal onClose={() => setReport(false)} onDone={() => { setReport(false); toast.success(t('roads.reported')); reloadAll(); }} />}
      {clearFor && <ClearanceModal road={clearFor} onClose={() => setClearFor(null)} onDone={() => { setClearFor(null); toast.success(t('roads.clearanceSubmitted')); reloadAll(); }} />}
      {decide && <DecisionModal d={decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); toast.success(t('common.saved')); reloadAll(); }} />}
    </div>
  );
}

function ReportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ type: 'flooded', severity: 'medium', description: '' });
  const [loc, setLoc] = useState<Loc>(emptyLoc);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([['description', required(f.description) ?? minLen(f.description, 5)], ['location.lat', locValid(loc) ? undefined : 'invalid_coordinates']]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await http.post('/roads', multipart({ ...f, description: f.description.trim(), location: locPayload(loc) }, files.slice(0, 1)));
      onDone();
    } catch (err) {
      setErrors(fieldErrors(err, t));
      setServerError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open wide title={t('roads.report')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="road-form" loading={busy}>{t('common.submit')}</Button></>}>
      <form id="road-form" onSubmit={submit} noValidate className="space-y-4">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Alert tone="info">{t('roads.reportNote')}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.type')} required>{(id) => <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{BLOCKAGE_TYPES.map((x) => <option key={x} value={x}>{t(`blockageType.${x}`)}</option>)}</Select>}</Field>
          <Field label={t('citizen.severity')} required>{(id) => <Select id={id} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{SEVERITIES.map((x) => <option key={x} value={x}>{t(`severity.${x}`)}</option>)}</Select>}</Field>
        </div>
        <Field label={t('citizen.description')} required error={errors.description}>{(id, d) => <TextArea id={id} aria-describedby={d} rows={3} value={f.description} error={errors.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <LocationPicker value={loc} onChange={setLoc} errors={errors} compact />
        <Field label={t('roads.photo')}>{() => <FileInput files={files} onChange={setFiles} max={1} />}</Field>
      </form>
    </Modal>
  );
}

function ClearanceModal({ road, onClose, onDone }: { road: Road; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 5) return setError(t('validation.too_short'));
    setBusy(true);
    try {
      await http.post(`/roads/${road.id}/clearance`, multipart({ note: note.trim() }, files.slice(0, 1)));
      onDone();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={t('roads.reportCleared')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="clr-form" loading={busy}>{t('common.submit')}</Button></>}>
      <form id="clr-form" onSubmit={submit} noValidate className="space-y-4">
        <Alert tone="warn">{t('roads.clearanceNote')}</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('roads.clearanceClaim')} required>{(id) => <TextArea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <Field label={t('roads.photo')}>{() => <FileInput files={files} onChange={setFiles} max={1} />}</Field>
      </form>
    </Modal>
  );
}

function DecisionModal({ d, onClose, onDone }: { d: { kind: 'verify' | 'reject' | 'approve' | 'deny'; id: string }; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsReason = d.kind === 'reject' || d.kind === 'deny';
  const go = async () => {
    if (needsReason && note.trim().length < 3) return setError(t('validation.reason_required'));
    setBusy(true);
    try {
      if (d.kind === 'verify' || d.kind === 'reject') await post(`/roads/${d.id}/verify`, { verify: d.kind === 'verify', note: note.trim() || undefined });
      else await post(`/roads/clearances/${d.id}/decision`, { approve: d.kind === 'approve', reason: note.trim() || undefined });
      onDone();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={t(`roads.dialog.${d.kind}`)} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button variant={needsReason ? 'danger' : 'primary'} loading={busy} onClick={() => void go()}>{t('common.confirm')}</Button></>}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label={needsReason ? t('common.reason') : t('common.note')} required={needsReason}>{(id) => <TextArea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Modal>
  );
}
