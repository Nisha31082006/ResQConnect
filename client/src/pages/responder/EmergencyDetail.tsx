import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get, http, multipart, post } from '../../services/api';
import { Alert, Button, Card, ErrorState, Field, KindBadge, PageHeader, PriorityBadge, Select, Spinner, StatusBadge, TextArea, TextInput } from '../../components/ui';
import { EvidenceList } from '../../components/Evidence';
import { FileInput } from '../../components/FormBits';
import { Timeline } from '../../components/Reasons';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import { collect, intBetween, minLen, required, translateErrors } from '../../utils/validate';
import type { Emergency } from '../../types';

/** What a responder may do is decided by the API (assignment + role); the UI hides actions that cannot succeed. */
export default function ResponderEmergencyDetail() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const em = useFetch(() => get<Emergency>(`/emergencies/${id}`), [id]);
  useSocketEvents(['emergency:updated', 'emergency:status', 'assignment:changed', 'priority:confirmed'], () => void em.reload());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [percent, setPercent] = useState('');
  const [err, setErr] = useState('');
  const [showReport, setShowReport] = useState(false);

  if (em.loading) return <Spinner />;
  if (em.error || !em.data) return <ErrorState message={errorMessage(em.error, t)} onRetry={() => void em.reload()} />;
  const e = em.data;
  const active = e.assignments?.find((a) => a.status === 'active');
  const isLeader = user?.role === 'team_leader';

  const changeStatus = async (to: 'acknowledged' | 'in_progress') => {
    setBusy(true);
    setErr('');
    try {
      await post(`/emergencies/${e.id}/status`, { to });
      toast.success(t('common.saved'));
      await em.reload();
    } catch (x) {
      setErr(errorMessage(x, t));
    } finally {
      setBusy(false);
    }
  };
  const addProgress = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!active) return;
    const errs = collect([['note', required(note) ?? minLen(note, 2)], ['percent', percent ? intBetween(percent, 0, 100) : undefined]]);
    if (Object.keys(errs).length) return setErr(t(`validation.${Object.values(errs)[0]}`));
    setBusy(true);
    setErr('');
    try {
      await post(`/assignments/${active.id}/progress`, { note: note.trim(), ...(percent ? { percent: Number(percent) } : {}) });
      setNote('');
      setPercent('');
      toast.success(t('responder.progressSaved'));
      await em.reload();
    } catch (x) {
      setErr(errorMessage(x, t));
    } finally {
      setBusy(false);
    }
  };

  const progress = (e.assignments ?? []).flatMap((a) => a.progress.map((p) => ({ at: p.at, title: p.percent !== undefined ? `${p.percent}%` : t('responder.update'), note: p.note }))).sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return (
    <div className="space-y-4">
      <PageHeader title={`${e.emergencyId} · ${t(`emergencyType.${e.type}`)}`} subtitle={formatDateTime(e.createdAt, i18n.language)} actions={<Link className="btn-secondary" to="/responder">‹ {t('responder.assigned')}</Link>} />
      <div className="flex flex-wrap gap-2"><KindBadge kind={e.kind} /> <StatusBadge status={e.status} /> <PriorityBadge level={e.effectivePriority.level} confirmed={e.effectivePriority.confirmed} /></div>
      {err && <Alert tone="danger">{err}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('citizen.details')} className="lg:col-span-2">
          <p className="whitespace-pre-wrap text-sm">{e.description}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-ink-500">{t('common.peopleAffected')}</dt><dd className="font-semibold">{e.affectedCount}</dd></div>
            <div><dt className="text-ink-500">{t('citizen.dangerToLife')}</dt><dd className="font-semibold">{e.dangerToLife ? t('common.yes') : t('common.no')}</dd></div>
            <div><dt className="text-ink-500">{t('citizen.severity')}</dt><dd className="font-semibold">{t(`severity.${e.severity}`)}</dd></div>
            <div className="col-span-2"><dt className="text-ink-500">{t('common.addressLandmark')}</dt><dd className="font-semibold">{e.location?.address ?? '—'} {e.location && <a className="ml-1 underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${e.location.lat}&mlon=${e.location.lng}#map=17/${e.location.lat}/${e.location.lng}`}>🗺</a>}</dd></div>
            <div><dt className="text-ink-500">{t('common.phone')}</dt><dd className="font-semibold">{e.contact.phone ? <a className="underline" href={`tel:${e.contact.phone}`}>{e.contact.phone}</a> : '—'}</dd></div>
          </dl>
          {Object.entries(e.vulnerable ?? {}).some(([, v]) => v) && <p className="mt-3 text-sm"><strong>{t('citizen.vulnerableTitle')}:</strong> {Object.entries(e.vulnerable).filter(([, v]) => v).map(([k]) => t(`vulnerable.${k}`)).join(', ')}</p>}
          {e.assistanceNeeds.length > 0 && <p className="mt-1 text-sm"><strong>{t('citizen.assistanceTitle')}:</strong> {e.assistanceNeeds.map((n) => t(`assistance.${n}`, { defaultValue: n })).join(', ')}</p>}
          {e.evidence.length > 0 && <div className="mt-4"><EvidenceList items={e.evidence} /></div>}
        </Card>
        <Card title={t('responder.assignment')}>
          {active ? (
            <div className="space-y-1 text-sm">
              <p>{t('responder.team')}: <strong>{active.team?.name ?? '—'}</strong></p>
              {active.volunteers.length > 0 && <p>{t('responder.volunteers')}: {active.volunteers.map((v) => v.name).join(', ')}</p>}
              {active.instructions && <p className="rounded bg-amber-50 p-2"><strong>{t('responder.instructions')}:</strong> {active.instructions}</p>}
            </div>
          ) : <p className="text-sm text-ink-500">{t('responder.noActiveAssignment')}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {e.status === 'assigned' && <Button loading={busy} onClick={() => void changeStatus('acknowledged')}>{t('responder.acknowledge')}</Button>}
            {(e.status === 'acknowledged' || e.status === 'assigned') && <Button variant="secondary" loading={busy} onClick={() => void changeStatus('in_progress')}>▶ {t('responder.startWork')}</Button>}
          </div>
        </Card>
      </div>
      {active && ['assigned', 'acknowledged', 'in_progress'].includes(e.status) && (
        <Card title={t('responder.progressTitle')}>
          <form onSubmit={addProgress} className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" noValidate>
            <Field label={t('responder.progressNote')} required>{(i) => <TextInput id={i} value={note} onChange={(x) => setNote(x.target.value)} />}</Field>
            <Field label={t('responder.percent')}>{(i) => <TextInput id={i} type="number" min={0} max={100} value={percent} onChange={(x) => setPercent(x.target.value)} />}</Field>
            <Button type="submit" loading={busy}>{t('responder.addUpdate')}</Button>
          </form>
        </Card>
      )}
      {progress.length > 0 && <Card title={t('responder.progressHistory')}><Timeline items={progress} /></Card>}
      {e.status === 'in_progress' && (
        <Card title={t('responder.completionTitle')}>
          {!showReport ? (
            <div className="space-y-2">
              <p className="text-sm text-ink-700">{t('responder.completionHint')}</p>
              <Button onClick={() => setShowReport(true)}>📝 {t('responder.submitCompletion')}</Button>
            </div>
          ) : (
            <CompletionForm emergencyId={e.id} defaultPeople={e.affectedCount} allowCompletion={isLeader} onDone={() => { setShowReport(false); toast.success(t('responder.completionSubmitted')); void em.reload(); }} onCancel={() => setShowReport(false)} />
          )}
        </Card>
      )}
      {e.status === 'completion_submitted' || e.status === 'admin_verification' ? <Alert tone="info">{t('responder.awaitingVerification')}</Alert> : null}
    </div>
  );
}

function CompletionForm({ emergencyId, defaultPeople, allowCompletion, onDone, onCancel }: { emergencyId: string; defaultPeople: number; allowCompletion: boolean; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ kind: allowCompletion ? 'completion' : 'assistance', actionsPerformed: '', peopleAssisted: String(defaultPeople), resourcesUsed: '', notes: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs = collect([['actionsPerformed', required(f.actionsPerformed) ?? minLen(f.actionsPerformed, 5)], ['peopleAssisted', intBetween(f.peopleAssisted, 0, 100000)]]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError('');
    try {
      await http.post('/completion-reports', multipart({ emergencyId, kind: f.kind, actionsPerformed: f.actionsPerformed.trim(), peopleAssisted: Number(f.peopleAssisted), resourcesUsed: f.resourcesUsed.trim(), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) }, files));
      onDone();
    } catch (x) {
      setErrors(fieldErrors(x, t));
      setServerError(errorMessage(x, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <Alert tone="info">{allowCompletion ? t('responder.completionNote') : t('responder.assistanceNote')}</Alert>
      {allowCompletion && (
        <Field label={t('responder.reportKind')}>
          {(id) => <Select id={id} value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value })}><option value="completion">{t('responder.kindCompletion')}</option><option value="assistance">{t('responder.kindAssistance')}</option></Select>}
        </Field>
      )}
      <Field label={t('responder.actionsPerformed')} required error={errors.actionsPerformed}>{(id, d) => <TextArea id={id} aria-describedby={d} rows={3} value={f.actionsPerformed} error={errors.actionsPerformed} onChange={(x) => setF({ ...f, actionsPerformed: x.target.value })} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('responder.peopleAssisted')} required error={errors.peopleAssisted}>{(id, d) => <TextInput id={id} aria-describedby={d} type="number" min={0} value={f.peopleAssisted} error={errors.peopleAssisted} onChange={(x) => setF({ ...f, peopleAssisted: x.target.value })} />}</Field>
        <Field label={t('responder.resourcesUsed')}>{(id) => <TextInput id={id} value={f.resourcesUsed} onChange={(x) => setF({ ...f, resourcesUsed: x.target.value })} />}</Field>
      </div>
      <Field label={t('common.notes')}>{(id) => <TextArea id={id} rows={2} value={f.notes} onChange={(x) => setF({ ...f, notes: x.target.value })} />}</Field>
      <Field label={t('responder.evidence')}>{() => <FileInput files={files} onChange={setFiles} />}</Field>
      <div className="flex gap-2"><Button type="submit" loading={busy}>{t('common.submit')}</Button><Button type="button" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button></div>
    </form>
  );
}
