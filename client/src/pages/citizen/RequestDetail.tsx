import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get, patch, post } from '../../services/api';
import { Alert, Button, Card, Checkbox, ErrorState, Field, KindBadge, Modal, PageHeader, PriorityBadge, Spinner, StatusBadge, TextArea, TextInput } from '../../components/ui';
import { EvidenceList } from '../../components/Evidence';
import { Timeline } from '../../components/Reasons';
import { SmsFallbackCard } from '../../components/SmsFallbackCard';
import { emptyLoc, locPayload, locValid, LocationPicker, type Loc } from '../../components/LocationPicker';
import { MultiCheck } from '../../components/FormBits';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { useToast } from '../../context/ToastContext';
import { VULNERABLE } from '../../utils/enums';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import { collect, intBetween, minLen, required, translateErrors } from '../../utils/validate';
import type { Emergency } from '../../types';

interface Revision { revision: number; at: string; editedBy: { name: string | null; role: string }; changes: Record<string, { from: unknown; to: unknown }> | string[]; priorityRecalculated: boolean }

const show = (v: unknown, t: (k: string) => string): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).filter(([, x]) => x).map(([k, x]) => (x === true ? k : `${k}: ${String(x)}`)).join(', ') || '—';
  return String(v);
};

export default function RequestDetail() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const em = useFetch(() => get<Emergency>(`/emergencies/${id}`), [id]);
  const revs = useFetch(() => get<Revision[]>(`/emergencies/${id}/revisions`), [id]);
  const [editing, setEditing] = useState(false);
  const [showSms, setShowSms] = useState(false);
  useSocketEvents(['emergency:updated', 'emergency:status', 'assignment:changed', 'priority:confirmed'], () => { void em.reload(); void revs.reload(); });

  if (em.loading) return <Spinner />;
  if (em.error || !em.data) return <ErrorState message={errorMessage(em.error, t)} onRetry={() => void em.reload()} />;
  const e = em.data;
  const closed = e.status === 'resolved';
  const timeline = [{ at: e.createdAt, title: t('citizen.timelineCreated') }, ...e.statusHistory.filter((h) => h.from).map((h) => ({ at: h.at, title: t(`status.${h.to}`), note: h.note }))];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${e.emergencyId} · ${t(`emergencyType.${e.type}`)}`}
        subtitle={formatDateTime(e.createdAt, i18n.language)}
        actions={<>
          <Link to="/citizen/requests" className="btn-secondary">‹ {t('citizen.myRequests')}</Link>
          {!closed && <Button onClick={() => setEditing(true)}>✎ {t('citizen.updateRequest')}</Button>}
        </>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={e.kind} /> <StatusBadge status={e.status} /> <PriorityBadge level={e.effectivePriority.level} confirmed={e.effectivePriority.confirmed} />
        {e.revisionCount > 0 && <span className="text-xs text-ink-500">{t('citizen.revisionCount', { count: e.revisionCount })}</span>}
      </div>
      {!e.effectivePriority.confirmed && <Alert tone="info">{t('citizen.priorityPending')}</Alert>}
      {e.assignedTeams && e.assignedTeams.length > 0 && <Alert tone="ok">{t('citizen.helpAssigned', { teams: e.assignedTeams.map((x) => x.name).join(', ') })}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('citizen.details')} className="lg:col-span-2">
          <p className="whitespace-pre-wrap text-sm">{e.description}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-500">{t('common.peopleAffected')}</dt><dd className="font-semibold">{e.affectedCount}</dd></div>
            <div><dt className="text-ink-500">{t('citizen.severity')}</dt><dd className="font-semibold">{t(`severity.${e.severity}`)}</dd></div>
            <div><dt className="text-ink-500">{t('citizen.dangerToLife')}</dt><dd className="font-semibold">{e.dangerToLife ? t('common.yes') : t('common.no')}</dd></div>
            <div><dt className="text-ink-500">{t('common.addressLandmark')}</dt><dd className="font-semibold">{e.location?.address || (e.location ? `${e.location.lat.toFixed(4)}, ${e.location.lng.toFixed(4)}` : '—')}</dd></div>
          </dl>
          {e.evidence.length > 0 && <div className="mt-4"><EvidenceList items={e.evidence} /></div>}
        </Card>
        <Card title={t('citizen.progress')}><Timeline items={timeline} /></Card>
      </div>
      {!closed && (
        <Card title={t('offline.smsTitle')}>
          <p className="mb-2 text-sm text-ink-700">{t('citizen.smsDetailHint')}</p>
          {e.sms.prepared && <p className="mb-2 text-xs text-ink-500">{t('citizen.smsPreparedAt', { at: formatDateTime(e.sms.preparedAt, i18n.language) })}</p>}
          {showSms ? (
            <SmsFallbackCard type={e.type} people={e.affectedCount} lat={e.location?.lat} lng={e.location?.lng} reportId={e.emergencyId} onPrepared={() => void post(`/emergencies/${e.id}/sms-prepared`, {}).then(() => em.reload()).catch(() => undefined)} />
          ) : (
            <Button variant="secondary" onClick={() => setShowSms(true)}>📱 {t('citizen.prepareSms')}</Button>
          )}
        </Card>
      )}
      <Card title={t('citizen.revisionHistory')}>
        {revs.data && revs.data.length > 0 ? (
          <ol className="space-y-3 text-sm">
            {revs.data.map((r) => (
              <li key={r.revision} className="rounded border border-ink-200 p-3">
                <p className="font-semibold">{t('citizen.revision', { n: r.revision })} · <span className="font-normal text-ink-500">{formatDateTime(r.at, i18n.language)}</span></p>
                {Array.isArray(r.changes) ? <p>{r.changes.join(', ')}</p> : (
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(r.changes).map(([k, c]) => <li key={k}><span className="font-medium">{t(`fields.${k}`, { defaultValue: k })}:</span> <s className="text-ink-500">{show(c.from, t)}</s> → <strong>{show(c.to, t)}</strong></li>)}
                  </ul>
                )}
                {r.priorityRecalculated && <p className="mt-1 text-xs text-amber-800">{t('citizen.priorityRecalculated')}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-ink-500">{t('citizen.noRevisions')}</p>}
      </Card>
      {editing && <EditModal e={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast.success(t('citizen.updated')); void em.reload(); void revs.reload(); }} />}
    </div>
  );
}

function EditModal({ e, onClose, onSaved }: { e: Emergency; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ description: e.description, affectedCount: String(e.affectedCount), dangerToLife: e.dangerToLife });
  const [vul, setVul] = useState<string[]>(VULNERABLE.filter((v) => e.vulnerable?.[v]));
  const [changeLoc, setChangeLoc] = useState(false);
  const [loc, setLoc] = useState<Loc>(e.location ? { lat: e.location.lat, lng: e.location.lng, address: e.location.address ?? '' } : emptyLoc);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs = collect([['description', required(f.description) ?? minLen(f.description, 3)], ['affectedCount', intBetween(f.affectedCount, 1, 100000)], ['location.lat', changeLoc && !locValid(loc) ? 'invalid_coordinates' : undefined]]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError('');
    try {
      await patch(`/emergencies/${e.id}`, {
        description: f.description.trim(),
        affectedCount: Number(f.affectedCount),
        dangerToLife: f.dangerToLife,
        vulnerable: Object.fromEntries(VULNERABLE.map((v) => [v, vul.includes(v)])),
        ...(changeLoc ? { location: locPayload(loc) } : {}),
      });
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err, t));
      setServerError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={t('citizen.updateRequest')} onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} form="edit-form" type="submit">{t('common.save')}</Button></>}>
      <form id="edit-form" onSubmit={submit} noValidate className="space-y-4">
        <Alert tone="info">{t('citizen.updateNote')}</Alert>
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('citizen.description')} required error={errors.description}>{(id, d) => <TextArea id={id} aria-describedby={d} rows={4} value={f.description} error={errors.description} onChange={(x) => setF({ ...f, description: x.target.value })} />}</Field>
        <Field label={t('common.peopleAffected')} required error={errors.affectedCount}>{(id, d) => <TextInput id={id} aria-describedby={d} type="number" min={1} value={f.affectedCount} error={errors.affectedCount} onChange={(x) => setF({ ...f, affectedCount: x.target.value })} />}</Field>
        <Checkbox label={t('citizen.dangerToLife')} checked={f.dangerToLife} onChange={(v) => setF({ ...f, dangerToLife: v })} />
        <fieldset><legend className="label">{t('citizen.vulnerableTitle')}</legend><MultiCheck options={VULNERABLE} value={vul as (typeof VULNERABLE)[number][]} onChange={setVul} labelFor={(o) => t(`vulnerable.${o}`)} /></fieldset>
        <Checkbox label={t('citizen.changeLocation')} checked={changeLoc} onChange={setChangeLoc} />
        {changeLoc && <LocationPicker value={loc} onChange={setLoc} errors={errors} compact />}
      </form>
    </Modal>
  );
}
