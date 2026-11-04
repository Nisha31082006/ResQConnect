import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post, put } from '../../../services/api';
import { Alert, Badge, Button, Card, Field, Modal, TextArea, TextInput, Select } from '../../../components/ui';
import { TagInput } from '../../../components/FormBits';
import { Reasons } from '../../../components/Reasons';
import { useToast } from '../../../context/ToastContext';
import { useFetch } from '../../../hooks/useFetch';
import { errorMessage } from '../../../utils/errors';
import type { Emergency } from '../../../types';

interface Suggestions {
  teams: { id: string; name: string; skills: string[]; availability: string; members: number; capacity: number; workload: number; score: number; reasons: { code: string; params?: Record<string, unknown> }[] }[];
  volunteers: { id: string; name: string; skills: string[]; availability: string; workload: number; inTeam: boolean; score: number; reasons: { code: string; params?: Record<string, unknown> }[] }[];
}

/** Requirements, staffing gap, suggestions (advisory only) and MANUAL allocation / reassignment with a recorded reason. */
export function AssignPanel({ e, onChanged }: { e: Emergency; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [req, setReq] = useState({ n: String(e.requiredVolunteers), skills: e.requiredSkills });
  const sugg = useFetch(() => get<Suggestions>(`/emergencies/${e.id}/suggestions`), [e.id, e.requiredSkills.join(','), e.requiredVolunteers]);
  const [teamId, setTeamId] = useState('');
  const [vols, setVols] = useState<string[]>([]);
  const [instr, setInstr] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [reassign, setReassign] = useState(false);
  const active = e.assignments?.find((a) => a.status === 'active');
  const closed = e.status === 'resolved';
  const confirmed = !!e.finalPriority;

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      toast.success(okMsg);
      onChanged();
    } catch (x) {
      setErr(errorMessage(x, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('admin.assignTitle')}>
      {err && <div className="mb-3"><Alert tone="danger">{err}</Alert></div>}
      <div className="mb-4 grid gap-3 rounded border border-ink-200 p-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <Field label={t('admin.requiredVolunteers')}>{(id) => <TextInput id={id} type="number" min={0} value={req.n} onChange={(x) => setReq({ ...req, n: x.target.value })} />}</Field>
        <Field label={t('admin.requiredSkills')}>{() => <TagInput value={req.skills} onChange={(s) => setReq({ ...req, skills: s })} placeholder={t('admin.skillPlaceholder')} />}</Field>
        <Button variant="secondary" loading={busy} onClick={() => void run(() => put(`/emergencies/${e.id}/requirements`, { requiredVolunteers: Number(req.n) || 0, requiredSkills: req.skills }), t('common.saved'))}>{t('common.save')}</Button>
      </div>
      {e.staffing && (
        <p className="mb-3 text-sm" aria-live="polite">
          {t('admin.staffing', { assigned: e.staffing.assigned, required: e.staffing.required })}{' '}
          {e.staffing.gap > 0 ? <Badge tone="red">{t('admin.gap', { count: e.staffing.gap })}</Badge> : e.staffing.required > 0 ? <Badge tone="green">{t('admin.noGap')}</Badge> : null}
        </p>
      )}
      {active && (
        <div className="mb-4 rounded border border-blue-300 bg-blue-50 p-3 text-sm">
          <p className="font-semibold">{t('admin.currentAssignment')}: {active.team?.name ?? t('responder.directVolunteers')} {active.volunteers.length > 0 && `+ ${active.volunteers.map((v) => v.name).join(', ')}`}</p>
          {active.instructions && <p className="mt-1">{active.instructions}</p>}
          {active.reassignReason && <p className="mt-1 text-xs text-ink-700">{t('admin.lastReassignReason')}: {active.reassignReason}</p>}
          {!closed && <Button className="mt-2" variant="secondary" onClick={() => { setTeamId(active.team?.id ?? ''); setVols(active.volunteers.map((v) => v.id)); setReassign(true); }}>🔁 {t('admin.reassign')}</Button>}
        </div>
      )}
      {!closed && !active && (
        <>
          {!confirmed && <Alert tone="warn">{t('admin.confirmPriorityFirst')}</Alert>}
          {e.status === 'pending' && <div className="mt-2"><Alert tone="warn">{t('admin.acknowledgeFirst')}</Alert></div>}
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-bold">{t('admin.suggestedTeams')}</h3>
              <p className="mb-2 text-xs text-ink-500">{t('admin.suggestionsAdvisory')}</p>
              <ul className="space-y-2">
                {sugg.data?.teams.map((x) => (
                  <li key={x.id} className={`rounded border p-2 text-sm ${teamId === x.id ? 'border-brand-600 bg-brand-50' : 'border-ink-200'}`}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input type="radio" name="team" checked={teamId === x.id} onChange={() => setTeamId(x.id)} className="mt-1" />
                      <span className="flex-1"><strong>{x.name}</strong> <span className="text-xs text-ink-500">({x.members}/{x.capacity} · {t(`availability.${x.availability}`)} · {t('admin.workload', { count: x.workload })})</span>
                        <Reasons reasons={x.reasons} showPoints={false} /></span>
                    </label>
                  </li>
                ))}
                {sugg.data && sugg.data.teams.length === 0 && <p className="text-sm text-ink-500">{t('admin.noTeams')}</p>}
              </ul>
              {teamId && <Button variant="ghost" onClick={() => setTeamId('')}>{t('common.clear')}</Button>}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-bold">{t('admin.suggestedVolunteers')}</h3>
              <ul className="space-y-2">
                {sugg.data?.volunteers.map((x) => (
                  <li key={x.id} className="rounded border border-ink-200 p-2 text-sm">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input type="checkbox" checked={vols.includes(x.id)} onChange={(c) => setVols(c.target.checked ? [...vols, x.id] : vols.filter((v) => v !== x.id))} className="mt-1" />
                      <span className="flex-1"><strong>{x.name}</strong> <span className="text-xs text-ink-500">({t(`availability.${x.availability}`)}{x.inTeam ? ` · ${t('admin.inTeam')}` : ''})</span>
                        <Reasons reasons={x.reasons} showPoints={false} /></span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <Field label={t('responder.instructions')}>{(id) => <TextArea id={id} rows={2} value={instr} onChange={(x) => setInstr(x.target.value)} />}</Field>
            <Button
              disabled={!confirmed || (!teamId && vols.length === 0)}
              loading={busy}
              onClick={() => void run(() => post('/assignments', { emergencyId: e.id, ...(teamId ? { teamId } : {}), volunteerIds: vols, ...(instr.trim() ? { instructions: instr.trim() } : {}) }), t('admin.assigned'))}
            >
              {t('admin.assign')}
            </Button>
          </div>
        </>
      )}
      {reassign && active && (
        <ReassignModal
          e={e}
          assignmentId={active.id}
          teams={sugg.data?.teams ?? []}
          volunteers={sugg.data?.volunteers ?? []}
          initial={{ teamId, vols }}
          onClose={() => setReassign(false)}
          onDone={() => { setReassign(false); toast.success(t('admin.reassigned')); onChanged(); }}
        />
      )}
    </Card>
  );
}

function ReassignModal({ assignmentId, teams, volunteers, initial, onClose, onDone }: { e: Emergency; assignmentId: string; teams: Suggestions['teams']; volunteers: Suggestions['volunteers']; initial: { teamId: string; vols: string[] }; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [teamId, setTeamId] = useState(initial.teamId);
  const [vols, setVols] = useState<string[]>(initial.vols);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (reason.trim().length < 3) return setErr(t('validation.reason_required'));
    setBusy(true);
    try {
      await post(`/assignments/${assignmentId}/reassign`, { ...(teamId ? { teamId } : {}), volunteerIds: vols, reason: reason.trim() });
      onDone();
    } catch (x) {
      setErr(errorMessage(x, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open wide title={t('admin.reassign')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={() => void go()}>{t('common.confirm')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="danger">{err}</Alert>}
        <Alert tone="info">{t('admin.reassignNote')}</Alert>
        <Field label={t('responder.team')}>{(id) => <Select id={id} value={teamId} onChange={(x) => setTeamId(x.target.value)}><option value="">—</option>{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
        <fieldset><legend className="label">{t('responder.volunteers')}</legend>
          <div className="grid gap-1 sm:grid-cols-2">{volunteers.map((v) => <label key={v.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vols.includes(v.id)} onChange={(c) => setVols(c.target.checked ? [...vols, v.id] : vols.filter((x) => x !== v.id))} />{v.name}</label>)}</div>
        </fieldset>
        <Field label={t('admin.reassignReason')} required>{(id) => <TextArea id={id} rows={3} value={reason} onChange={(x) => setReason(x.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
