import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { get, post } from '../../services/api';
import { Alert, Button, Card, ErrorState, KindBadge, PageHeader, PriorityBadge, Spinner, StatusBadge } from '../../components/ui';
import { EvidenceList } from '../../components/Evidence';
import { Timeline } from '../../components/Reasons';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import { AssignPanel } from './parts/AssignPanel';
import { PriorityPanel } from './parts/PriorityPanel';
import { TeamFormationBody } from './automation/TeamFormationModal';
import { ShelterConfirmBody } from './automation/ShelterConfirmModal';
import type { Emergency } from '../../types';

interface Revision { revision: number; at: string; editedBy: { name: string | null; role: string }; changes: Record<string, { from: unknown; to: unknown }>; priorityRecalculated: boolean }
const fmt = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function AdminEmergencyDetail() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const em = useFetch(() => get<Emergency>(`/emergencies/${id}`), [id]);
  const revs = useFetch(() => get<Revision[]>(`/emergencies/${id}/revisions`), [id]);
  const toast = useToast();
  const [acking, setAcking] = useState(false);
  const reload = () => { void em.reload(); void revs.reload(); };
  const acknowledge = async () => {
    setAcking(true);
    try { await post(`/emergencies/${id}/status`, { to: 'acknowledged' }); toast.success(t('common.saved')); reload(); } catch (x) { toast.error(errorMessage(x, t)); } finally { setAcking(false); }
  };
  useSocketEvents(['emergency:updated', 'emergency:status', 'assignment:changed', 'priority:confirmed', 'escalation:triggered', 'escalation:updated'], reload);
  if (em.loading) return <Spinner />;
  if (em.error || !em.data) return <ErrorState message={errorMessage(em.error, t)} onRetry={reload} />;
  const e = em.data;
  const history = e.statusHistory.map((h) => ({ at: h.at, title: `${h.from ? t(`status.${h.from}`) + ' → ' : ''}${t(`status.${h.to}`)}${h.byRole ? ` (${t(`role.${h.byRole}`, { defaultValue: h.byRole })})` : ''}`, note: h.note }));
  return (
    <div className="space-y-4">
      <PageHeader title={`${e.emergencyId} · ${t(`emergencyType.${e.type}`)}`} subtitle={formatDateTime(e.createdAt, i18n.language)} actions={<>{e.status === 'pending' && <Button loading={acking} onClick={() => void acknowledge()}>👁 {t('admin.acknowledgeRequest')}</Button>}<Link className="btn-secondary" to="/admin/emergencies">‹ {t('nav.emergencies')}</Link></>} />
      <div className="flex flex-wrap gap-2"><KindBadge kind={e.kind} /> <StatusBadge status={e.status} /> <PriorityBadge level={e.effectivePriority.level} confirmed={e.effectivePriority.confirmed} /></div>
      {e.duplicateOf && <Alert tone="warn">{t('admin.flaggedDuplicate')} <Link className="underline" to={`/admin/emergencies/${e.duplicateOf}`}>{t('common.viewDetails')}</Link></Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('citizen.details')} className="lg:col-span-2">
          <p className="whitespace-pre-wrap text-sm">{e.description}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-ink-500">{t('common.peopleAffected')}</dt><dd className="font-semibold">{e.affectedCount}</dd></div>
            <div><dt className="text-ink-500">{t('citizen.severity')}</dt><dd className="font-semibold">{t(`severity.${e.severity}`)}</dd></div>
            <div><dt className="text-ink-500">{t('citizen.trappedCount')}</dt><dd className="font-semibold">{e.trappedCount ?? 0}</dd></div>
            <div><dt className="text-ink-500">{t('priority.citizenSelected')}</dt><dd className="font-semibold">{e.citizenPriority ? t(`priority.${e.citizenPriority}`) : t('priority.citizenNone')}</dd></div>
            <div><dt className="text-ink-500">{t('citizen.dangerToLife')}</dt><dd className="font-semibold">{e.dangerToLife ? t('common.yes') : t('common.no')}</dd></div>
            <div><dt className="text-ink-500">{t('common.reporter')}</dt><dd className="font-semibold">{e.reporter?.name ?? '—'}</dd></div>
            <div><dt className="text-ink-500">{t('common.phone')}</dt><dd className="font-semibold">{e.contact.phone ?? e.reporter?.phone ?? '—'}</dd></div>
            <div><dt className="text-ink-500">{t('admin.source')}</dt><dd className="font-semibold">{e.source}</dd></div>
            <div className="col-span-full"><dt className="text-ink-500">{t('common.addressLandmark')}</dt><dd className="font-semibold">{e.location?.address ?? '—'} {e.location && `(${e.location.lat.toFixed(4)}, ${e.location.lng.toFixed(4)})`}</dd></div>
          </dl>
          {Object.entries(e.vulnerable ?? {}).some(([, v]) => v) && <p className="mt-3 text-sm"><strong>{t('citizen.vulnerableTitle')}:</strong> {Object.entries(e.vulnerable).filter(([, v]) => v).map(([k]) => t(`vulnerable.${k}`)).join(', ')}</p>}
          {e.assistanceNeeds.length > 0 && <p className="mt-1 text-sm"><strong>{t('citizen.assistanceTitle')}:</strong> {e.assistanceNeeds.map((n) => t(`assistance.${n}`, { defaultValue: n })).join(', ')}</p>}
          {e.sms.prepared && <p className="mt-2 text-xs text-ink-500">📱 {t('admin.smsPrepared')}</p>}
          {e.evidence.length > 0 && <div className="mt-4"><EvidenceList items={e.evidence} /></div>}
        </Card>
        <Card title={t('citizen.progress')}><Timeline items={history} /></Card>
      </div>
      <PriorityPanel e={e} onChanged={reload} />
      <AssignPanel e={e} onChanged={reload} />
      {e.status !== 'resolved' && (
        <Card title={`🤖 ${t('automation.teams.panelTitle')}`}>
          <TeamFormationBody key={`${e.assignments?.length ?? 0}-${e.status}`} emergencyId={e.id} embedded onDone={reload} />
        </Card>
      )}
      {e.status !== 'resolved' && (
        <Card title={`🏠 ${t('automation.shelters.panelTitle')}`}>
          <ShelterConfirmBody key={e.shelterPlan?.shelter ?? "none"} emergencyId={e.id} onDone={reload} />
        </Card>
      )}
      {e.duplicateDetails && e.duplicateDetails.length > 0 && (
        <Card title={t('duplicates.title')} actions={<Link className="text-sm font-semibold underline" to="/admin/duplicates">{t('duplicates.reviewAll')}</Link>}>
          <p className="mb-2 text-xs text-ink-500">{t('duplicates.neverDeleted')}</p>
          <ul className="space-y-2 text-sm">
            {e.duplicateDetails.map((d) => {
              const c = e.duplicateCandidates?.find((x) => x.emergency === d.id);
              return <li key={d.id} className="rounded border border-ink-200 p-2"><Link className="font-semibold underline" to={`/admin/emergencies/${d.id}`}>{d.emergencyId}</Link> · {t(`emergencyType.${d.type}`)} · {t(`status.${d.status}`)} {c && <span className="text-xs text-ink-500">({t('duplicates.score', { score: c.score })} · {Math.round(c.distanceMeters)} m · {t(`duplicates.review.${c.reviewStatus}`)})</span>}</li>;
            })}
          </ul>
        </Card>
      )}
      <Card title={t('citizen.revisionHistory')}>
        {revs.data && revs.data.length > 0 ? (
          <ol className="space-y-2 text-sm">
            {revs.data.map((r) => (
              <li key={r.revision} className="rounded border border-ink-200 p-2">
                <p className="font-semibold">{t('citizen.revision', { n: r.revision })} · <span className="font-normal text-ink-500">{formatDateTime(r.at, i18n.language)} · {r.editedBy.name}</span></p>
                <ul>{Object.entries(r.changes).map(([k, c]) => <li key={k}>{t(`fields.${k}`, { defaultValue: k })}: <s>{fmt(c.from)}</s> → <strong>{fmt(c.to)}</strong></li>)}</ul>
                {r.priorityRecalculated && <p className="text-xs text-amber-800">{t('citizen.priorityRecalculated')}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-ink-500">{t('citizen.noRevisions')}</p>}
      </Card>
    </div>
  );
}
