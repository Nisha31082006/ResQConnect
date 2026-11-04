import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../../services/api';
import { Alert, Badge, Button, Field, Modal, PriorityBadge, Spinner, TextArea } from '../../../components/ui';
import { useToast } from '../../../context/ToastContext';
import { errorMessage } from '../../../utils/errors';
import { ReasonList } from './ReasonList';
import type { TeamRecommendation } from './types';

/**
 * Review a recommended formation. Nothing is created until the admin presses "Approve and assign".
 * The admin can untick people, tick extra ones, choose an existing team and optionally add the approved people to it.
 */
export function TeamFormationBody({ emergencyId, onDone, onCancel, embedded = false }: { emergencyId: string; onDone: () => void; onCancel?: () => void; embedded?: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [rec, setRec] = useState<TeamRecommendation | null>(null);
  const [err, setErr] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [teamId, setTeamId] = useState('');
  const [addToTeam, setAddToTeam] = useState(false);
  const [instr, setInstr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    get<TeamRecommendation>(`/automation/emergencies/${emergencyId}/team-recommendation`)
      .then((r) => { if (live) { setRec(r); setChosen(r.proposedFormation.volunteerIds); } })
      .catch((x) => live && setErr(errorMessage(x, t)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emergencyId]);

  const approve = async () => {
    setBusy(true);
    setErr('');
    try {
      await post('/automation/team-formation/approve', { emergencyId, volunteerIds: chosen, ...(teamId ? { teamId } : {}), addToTeam: Boolean(teamId && addToTeam), ...(instr.trim() ? { instructions: instr.trim() } : {}) });
      toast.success(t('automation.teams.approved'));
      onDone();
    } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(false); }
  };

  if (!rec) return err ? <Alert tone="danger">{err}</Alert> : <Spinner />;
  const blocked = !rec.emergency.priorityConfirmed ? t('automation.teams.needPriority') : !rec.canApprove ? t('automation.teams.needAcknowledge') : '';
  const canSubmit = !blocked && (chosen.length > 0 || Boolean(teamId));
  return (
    <div className="space-y-3">
      {err && <Alert tone="danger">{err}</Alert>}
      <Alert tone="info">{t('automation.teams.advisory')}</Alert>
      {blocked && <Alert tone="warn">{blocked}</Alert>}
      <p className="text-sm">
        {rec.emergency.emergencyId} · {t(`emergencyType.${rec.emergency.type}`)} · <PriorityBadge level={rec.emergency.priority} confirmed={rec.emergency.priorityConfirmed} />{' '}
        {t('admin.staffing', { assigned: rec.staffing.assigned, required: rec.staffing.required })} {rec.staffing.gap > 0 && <Badge tone="red">{t('admin.gap', { count: rec.staffing.gap })}</Badge>}
        {rec.emergency.requiredSkills.length > 0 && <span className="ml-1 text-ink-500">({t('admin.requiredSkills')}: {rec.emergency.requiredSkills.join(', ')})</span>}
      </p>
      {rec.proposedFormation.missingSkills.length > 0 && <Alert tone="warn">{t('automation.teams.missingSkills', { skills: rec.proposedFormation.missingSkills.join(', ') })}</Alert>}
      <h3 className="text-sm font-bold">{t('automation.teams.recommendedVolunteers')}</h3>
      <ul className="space-y-2">
        {rec.volunteers.map((v) => (
          <li key={v.id} className={`rounded border p-2 text-sm ${chosen.includes(v.id) ? 'border-brand-600 bg-brand-50' : 'border-ink-200'}`}>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-1" checked={chosen.includes(v.id)} onChange={(c) => setChosen(c.target.checked ? [...chosen, v.id] : chosen.filter((x) => x !== v.id))} />
              <span className="flex-1">
                <strong>{v.name}</strong> <span className="font-mono text-xs">({t('automation.teams.score', { score: v.score })})</span>
                <span className="ml-1 text-xs text-ink-500">{v.skills.join(', ') || '—'} · {t('admin.workload', { count: v.activeTasks })}{v.distanceKm !== null ? ` · ${t('automation.km', { km: v.distanceKm })}` : ''}{v.teamName ? ` · ${v.teamName}` : ''}</span>
                <ReasonList reasons={v.reasons} />
              </span>
            </label>
          </li>
        ))}
        {rec.volunteers.length === 0 && <p className="text-sm text-ink-500">{t('automation.teams.noCandidates')}</p>}
      </ul>
      {(rec.excluded.overloaded > 0 || rec.excluded.unavailable > 0) && <p className="text-xs text-ink-500">{t('automation.teams.excluded', rec.excluded)}</p>}
      {rec.teams.length > 0 && (
        <Field label={t('automation.teams.optionalTeam')} hint={t('automation.teams.optionalTeamHint')}>
          {(id) => (
            <select id={id} className="input" value={teamId} onChange={(e) => { setTeamId(e.target.value); if (!e.target.value) setAddToTeam(false); }}>
              <option value="">—</option>
              {rec.teams.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.size}/{x.capacity}) · {t('automation.teams.score', { score: x.score })}</option>)}
            </select>
          )}
        </Field>
      )}
      {teamId && chosen.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={addToTeam} onChange={(e) => setAddToTeam(e.target.checked)} />{t('automation.teams.addToTeam')}</label>}
      <Field label={t('responder.instructions')}>{(id) => <TextArea id={id} rows={2} value={instr} onChange={(e) => setInstr(e.target.value)} />}</Field>
      <div className={embedded ? '' : 'flex justify-end gap-2'}>
        {onCancel && <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>}{' '}
        <Button disabled={!canSubmit} loading={busy} onClick={() => void approve()}>✔ {t('automation.teams.approve')}</Button>
      </div>
    </div>
  );
}

export function TeamFormationModal({ emergencyId, onClose, onDone }: { emergencyId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open wide title={t('automation.teams.reviewTitle')} onClose={onClose}>
      <TeamFormationBody emergencyId={emergencyId} onCancel={onClose} onDone={() => { onDone(); onClose(); }} />
    </Modal>
  );
}
