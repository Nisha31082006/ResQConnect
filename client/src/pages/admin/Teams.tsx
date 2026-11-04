import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { del, get, patch, post } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Select, SkeletonRows, TextArea, TextInput } from '../../components/ui';
import { TagInput } from '../../components/FormBits';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { collect, intBetween, minLen, required, translateErrors } from '../../utils/validate';
import type { Team, User } from '../../types';

type Vol = User & { teams: { id: string; name: string }[]; workload: number };

/** Admin creates teams and manages membership. Teams are never auto-generated. */
export default function AdminTeams() {
  const { t } = useTranslation();
  const toast = useToast();
  const teams = useFetch(() => get<Team[]>('/teams'), []);
  const vols = useFetch(() => get<Vol[]>('/volunteers'), []);
  const [edit, setEdit] = useState<Team | 'new' | null>(null);
  const [addTo, setAddTo] = useState<Team | null>(null);
  useSocketEvents(['team:changed', 'assignment:changed'], () => { void teams.reload(); void vols.reload(); });
  const reloadAll = () => { void teams.reload(); void vols.reload(); };
  const removeMember = async (team: Team, userId: string) => {
    try { await del(`/teams/${team.id}/members/${userId}`); toast.success(t('common.saved')); reloadAll(); } catch (x) { toast.error(errorMessage(x, t)); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.teams')} subtitle={t('admin.teamsSubtitle')} actions={<Button onClick={() => setEdit('new')}>＋ {t('admin.createTeam')}</Button>} />
      {teams.loading ? <SkeletonRows /> : teams.error ? <ErrorState message={errorMessage(teams.error, t)} onRetry={() => void teams.reload()} /> : !teams.data?.length ? <EmptyState title={t('admin.noTeams')} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {teams.data.map((team) => (
            <Card key={team.id} title={team.name} actions={<><Button variant="secondary" onClick={() => setEdit(team)}>{t('common.edit')}</Button><Button variant="secondary" onClick={() => setAddTo(team)}>＋ {t('admin.addMembers')}</Button></>}>
              <div className="mb-2 flex flex-wrap gap-2 text-sm">
                <Badge tone="blue">{t('responder.leader')}: {team.leader.name}</Badge>
                <Badge tone={team.availability === 'available' ? 'green' : 'amber'}>{t(`availability.${team.availability}`)}</Badge>
                <Badge>{team.memberCount}/{team.capacity}</Badge>
                <Badge tone={team.workload > 0 ? 'amber' : 'gray'}>{t('admin.workload', { count: team.workload })}</Badge>
                {!team.active && <Badge tone="red">{t('common.inactive')}</Badge>}
              </div>
              {team.skills.length > 0 && <p className="mb-2 text-xs">{team.skills.join(' · ')}</p>}
              <ul className="divide-y divide-ink-100 text-sm">
                {team.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-1.5">
                    <span>{m.name} {m.role === 'leader' && <Badge tone="blue">{t('responder.leader')}</Badge>} <span className="text-xs text-ink-500">{m.skills.join(', ')}</span></span>
                    {m.role !== 'leader' && <Button variant="ghost" onClick={() => void removeMember(team, m.id)} aria-label={`${t('common.remove')} ${m.name}`}>✕</Button>}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {edit && <TeamModal team={edit === 'new' ? null : edit} vols={vols.data ?? []} onClose={() => setEdit(null)} onDone={() => { setEdit(null); toast.success(t('common.saved')); reloadAll(); }} />}
      {addTo && <AddMembers team={addTo} vols={(vols.data ?? []).filter((v) => !addTo.members.some((m) => m.id === v.id))} onClose={() => setAddTo(null)} onDone={() => { setAddTo(null); toast.success(t('common.saved')); reloadAll(); }} />}
    </div>
  );
}

function TeamModal({ team, vols, onClose, onDone }: { team: Team | null; vols: Vol[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: team?.name ?? '', leaderId: team?.leader.id ?? '', capacity: String(team?.capacity ?? 5), availability: team?.availability ?? 'available', notes: team?.notes ?? '', active: team?.active ?? true });
  const [skills, setSkills] = useState<string[]>(team?.skills ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const leaders = vols.filter((v) => v.role === 'team_leader');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([['name', required(f.name) ?? minLen(f.name, 2)], ['leaderId', required(f.leaderId)], ['capacity', intBetween(f.capacity, 1, 200)]]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = { name: f.name.trim(), leaderId: f.leaderId, capacity: Number(f.capacity), availability: f.availability, skills, ...(f.notes.trim() ? { notes: f.notes.trim() } : {}) };
      if (team) await patch(`/teams/${team.id}`, { ...body, active: f.active });
      else await post('/teams', body);
      onDone();
    } catch (x) { setErrors(fieldErrors(x, t)); setServerError(errorMessage(x, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open wide title={team ? t('admin.editTeam') : t('admin.createTeam')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="team-form" loading={busy}>{t('common.save')}</Button></>}>
      <form id="team-form" onSubmit={submit} noValidate className="space-y-4">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('common.name')} required error={errors.name}>{(id, d) => <TextInput id={id} aria-describedby={d} value={f.name} error={errors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label={t('responder.leader')} required error={errors.leaderId} hint={t('admin.leaderHint')}>
          {(id) => <Select id={id} value={f.leaderId} error={errors.leaderId} onChange={(e) => setF({ ...f, leaderId: e.target.value })}><option value="">—</option>{leaders.map((l) => <option key={l.id} value={l.id}>{l.name}{l.teams.length ? ` (${l.teams.map((x) => x.name).join(', ')})` : ''}</option>)}</Select>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.capacity')} required error={errors.capacity}>{(id) => <TextInput id={id} type="number" min={1} value={f.capacity} error={errors.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />}</Field>
          <Field label={t('responder.availability')}>{(id) => <Select id={id} value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })}>{['available', 'busy', 'offline'].map((a) => <option key={a} value={a}>{t(`availability.${a}`)}</option>)}</Select>}</Field>
        </div>
        <Field label={t('common.skills')}>{() => <TagInput value={skills} onChange={setSkills} placeholder={t('admin.skillPlaceholder')} />}</Field>
        <Field label={t('common.notes')}>{(id) => <TextArea id={id} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        {team && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('common.active')}</label>}
      </form>
    </Modal>
  );
}

function AddMembers({ team, vols, onClose, onDone }: { team: Team; vols: Vol[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [sel, setSel] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await post(`/teams/${team.id}/members`, { userIds: sel }); onDone(); } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`${t('admin.addMembers')} — ${team.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={!sel.length} onClick={() => void go()}>{t('common.add')}</Button></>}>
      {err && <Alert tone="danger">{err}</Alert>}
      <p className="mb-2 text-xs text-ink-500">{t('admin.oneTeamRule')}</p>
      {vols.length === 0 ? <p className="text-sm">{t('common.noResults')}</p> : (
        <ul className="space-y-1">
          {vols.map((v) => (
            <li key={v.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={v.teams.length > 0} checked={sel.includes(v.id)} onChange={(e) => setSel(e.target.checked ? [...sel, v.id] : sel.filter((x) => x !== v.id))} /> {v.name} <span className="text-xs text-ink-500">{v.skills.join(', ')}{v.teams.length ? ` · ${v.teams[0].name}` : ''}</span></label></li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
