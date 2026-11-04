import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, PriorityBadge, Spinner, Table, TextArea } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage } from '../../utils/errors';
import { formatDateTime, formatDuration } from '../../utils/format';
import { ReasonList } from './automation/ReasonList';
import { ShelterConfirmModal } from './automation/ShelterConfirmModal';
import { TeamFormationModal } from './automation/TeamFormationModal';
import type { FollowUp, LoadState, Overview, ResourceAlert, Zone } from './automation/types';

const RISK_TONE = { critical: 'red', high: 'amber', medium: 'blue', low: 'gray' } as const;
const STATE_TONE: Record<LoadState, 'red' | 'amber' | 'green' | 'gray'> = { overloaded: 'red', busy: 'amber', available: 'green', unavailable: 'gray' };
const STATE_ICON: Record<LoadState, string> = { overloaded: '⛔', busy: '🟡', available: '🟢', unavailable: '⚪' };

const EVENTS = ['automation:updated', 'resource:alert', 'zone:detected', 'followup:created', 'followup:reminder', 'escalation:triggered', 'escalation:updated', 'emergency:created', 'sos:created', 'emergency:status', 'assignment:changed', 'shelter:updated'];

function Tile({ label, value, tone = 'default', target, hint }: { label: string; value: ReactNode; tone?: 'default' | 'danger' | 'warn' | 'ok'; target: string; hint?: string }) {
  const tones = { default: 'border-ink-200 bg-white', danger: 'border-red-600 bg-red-50', warn: 'border-amber-500 bg-amber-50', ok: 'border-green-600 bg-green-50' };
  return (
    <button type="button" onClick={() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className={`rounded-xl border border-l-4 p-3 text-left shadow-sm hover:opacity-90 ${tones[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink-900">{value}</div>
      {hint && <div className="text-xs text-ink-500">{hint}</div>}
    </button>
  );
}

function Filter<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return <select aria-label={label} className="input max-w-48" value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}

/** Smart Automation Dashboard: every card is read from MongoDB by backend rules; every action needs an admin click. */
export default function AdminAutomation() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => get<Overview>('/automation/overview'), []);
  useSocketEvents(EVENTS, () => void reload());
  const [teamFor, setTeamFor] = useState('');
  const [shelterFor, setShelterFor] = useState('');
  const [zoneFor, setZoneFor] = useState<Zone | null>(null);
  const [running, setRunning] = useState(false);
  const [wl, setWl] = useState<'all' | LoadState>('all');
  const [zoneFilter, setZoneFilter] = useState<'open' | 'detected' | 'reviewed'>('open');
  const [alertFilter, setAlertFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [fuFilter, setFuFilter] = useState<'all' | FollowUp['kind']>('all');
  const [busyId, setBusyId] = useState('');

  const act = async (id: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusyId(id);
    try { await fn(); toast.success(okMsg); await reload(); } catch (x) { toast.error(errorMessage(x, t)); } finally { setBusyId(''); }
  };
  const runNow = async () => {
    setRunning(true);
    try {
      const r = await post<{ errors: unknown[] }>('/automation/run');
      if (r.errors.length) toast.error(t('automation.runPartial')); else toast.success(t('automation.runDone'));
      await reload();
    } catch (x) { toast.error(errorMessage(x, t)); } finally { setRunning(false); }
  };

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} />;
  const s = data.summary;
  const zones = data.zones.filter((z) => zoneFilter === 'open' || z.status === zoneFilter);
  const alerts = data.resourceAlerts.filter((a) => alertFilter === 'all' || a.severity === alertFilter);
  const volunteers = data.workload.volunteers.filter((v) => wl === 'all' || v.state === wl);
  const followUps = data.followUps.filter((f) => fuFilter === 'all' || f.kind === fuFilter);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`🤖 ${t('automation.title')}`}
        subtitle={t('automation.subtitle')}
        actions={<><span className="self-center text-xs text-ink-500">{t('automation.updated', { time: formatDateTime(data.generatedAt, i18n.language) })}</span><Button variant="secondary" loading={running} onClick={() => void runNow()}>⟳ {t('automation.runNow')}</Button></>}
      />
      <Alert tone="info">{t('automation.rulesNote')}</Alert>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Tile label={t('automation.tiles.teams')} value={s.emergenciesNeedingTeams} tone={s.emergenciesNeedingTeams > 0 ? 'warn' : 'ok'} target="auto-teams" hint={t('automation.tiles.teamsHint', { count: s.teamsNeedingMembers })} />
        <Tile label={t('automation.tiles.workload')} value={`${s.overloadedVolunteers} / ${s.availableVolunteers}`} tone={s.overloadedVolunteers > 0 ? 'warn' : 'ok'} target="auto-workload" hint={t('automation.tiles.workloadHint')} />
        <Tile label={t('automation.tiles.zones')} value={s.zonesToReview} tone={s.zonesToReview > 0 ? 'warn' : 'ok'} target="auto-zones" />
        <Tile label={t('automation.tiles.shortages')} value={s.openShortages} tone={s.criticalShortages > 0 ? 'danger' : s.openShortages > 0 ? 'warn' : 'ok'} target="auto-resources" hint={t('automation.tiles.criticalHint', { count: s.criticalShortages })} />
        <Tile label={t('automation.tiles.shelters')} value={s.shelterRecommendations} tone={s.shelterRecommendations > 0 ? 'warn' : 'ok'} target="auto-shelters" />
        <Tile label={t('automation.tiles.sos')} value={s.unacknowledgedSos} tone={s.overdueSos > 0 ? 'danger' : s.unacknowledgedSos > 0 ? 'warn' : 'ok'} target="auto-sos" hint={t('automation.tiles.overdueHint', { count: s.overdueSos })} />
        <Tile label={t('automation.tiles.followUps')} value={s.pendingFollowUps} tone={s.pendingFollowUps > 0 ? 'warn' : 'ok'} target="auto-followups" />
      </div>

      {/* 1. rescue team formation */}
      <section id="auto-teams" className="scroll-mt-4 space-y-3">
        <Card title={`👥 ${t('automation.teams.title')}`}>
          <p className="mb-3 text-xs text-ink-500">{t('automation.teams.help')}</p>
          <Table head={[t('nav.emergencies'), t('automation.teams.staffing'), t('automation.teams.topVolunteers'), t('automation.teams.topTeam'), '']} empty={data.teamRecommendations.items.length === 0 ? <EmptyState title={t('automation.teams.none')} /> : undefined}>
            {data.teamRecommendations.items.map((r) => (
              <tr key={r.emergency.id}>
                <td className="td"><Link className="font-semibold underline" to={`/admin/emergencies/${r.emergency.id}`}>{r.emergency.emergencyId}</Link><div className="mt-1 flex flex-wrap items-center gap-1 text-xs">{t(`emergencyType.${r.emergency.type}`)} · <PriorityBadge level={r.emergency.priority} confirmed={r.emergency.priorityConfirmed} /></div></td>
                <td className="td text-xs">{t('admin.staffing', { assigned: r.staffing.assigned, required: r.staffing.required })} {r.staffing.gap > 0 && <Badge tone="red">{t('admin.gap', { count: r.staffing.gap })}</Badge>}{r.proposedFormation.missingSkills.length > 0 && <div className="text-amber-800">{t('automation.teams.missingSkills', { skills: r.proposedFormation.missingSkills.join(', ') })}</div>}</td>
                <td className="td text-xs">{r.topVolunteers.length === 0 ? '—' : r.topVolunteers.map((v) => <div key={v.id}><strong>{v.name}</strong> <span className="font-mono">{v.score}</span>{v.distanceKm !== null && ` · ${t('automation.km', { km: v.distanceKm })}`}</div>)}</td>
                <td className="td text-xs">{r.topTeam ? <><strong>{r.topTeam.name}</strong> <span className="font-mono">{r.topTeam.score}</span></> : '—'}</td>
                <td className="td"><Button onClick={() => setTeamFor(r.emergency.id)}>{t('automation.teams.review')}</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title={t('automation.teams.gapsTitle')}>
          {data.teamsNeedingMembers.length === 0 ? <p className="text-sm text-ink-500">{t('automation.teams.noGaps')}</p> : (
            <ul className="space-y-3">
              {data.teamsNeedingMembers.map((g) => (
                <li key={g.team.id} className="rounded border border-ink-200 p-3 text-sm">
                  <p className="font-semibold">{g.team.name} <span className="text-xs font-normal text-ink-500">({g.team.size}/{g.team.capacity})</span> {g.shortfall > 0 && <Badge tone="red">{t('admin.gap', { count: g.shortfall })}</Badge>} {g.missingSkills.map((k) => <Badge key={k} tone="amber">{t('automation.teams.lacks', { skill: k })}</Badge>)}</p>
                  <p className="text-xs text-ink-500">{g.emergencies.map((e) => e.emergencyId).join(', ')}</p>
                  {g.suggestions.length > 0 ? <ul className="mt-1 space-y-1">{g.suggestions.map((x) => <li key={x.id}><strong>{x.name}</strong> <span className="font-mono text-xs">{x.score}</span> <span className="text-xs text-ink-500">{x.skills.join(', ')}</span><ReasonList reasons={x.reasons} /></li>)}</ul> : <p className="text-xs text-ink-500">{t('automation.teams.noCandidates')}</p>}
                  {g.team.openSlots === 0 && <p className="text-xs text-amber-800">{t('automation.teams.teamFull')}</p>}
                  <p className="mt-1 text-xs"><Link className="underline" to="/admin/teams">{t('automation.teams.manage')}</Link></p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* 7. workload */}
      <section id="auto-workload" className="scroll-mt-4">
        <Card
          title={`⚖ ${t('automation.workload.title')}`}
          actions={<Filter label={t('automation.filter')} value={wl} onChange={setWl} options={[{ value: 'all', label: `${t('common.all')} (${data.workload.summary.total})` }, ...(['overloaded', 'busy', 'available', 'unavailable'] as const).map((k) => ({ value: k, label: `${t(`automation.workload.state.${k}`)} (${data.workload.summary[k]})` }))]} />}
        >
          <p className="mb-3 text-xs text-ink-500">{t('automation.workload.help', { count: data.workload.summary.overloadedAt })}</p>
          <Table head={[t('common.name'), t('automation.workload.state.title'), t('automation.workload.tasks'), t('common.skills'), t('automation.workload.alternatives')]} empty={volunteers.length === 0 ? <EmptyState title={t('automation.workload.none')} /> : undefined}>
            {volunteers.map((v) => (
              <tr key={v.id}>
                <td className="td font-semibold">{v.name}<div className="text-xs font-normal text-ink-500">{t(`role.${v.role}`)}{v.teamName ? ` · ${v.teamName}` : ''}</div></td>
                <td className="td"><Badge tone={STATE_TONE[v.state]}>{STATE_ICON[v.state]} {t(`automation.workload.state.${v.state}`)}</Badge></td>
                <td className="td text-xs"><span className="font-mono text-base font-bold">{v.activeTasks}</span>{v.tasks.map((k) => <div key={k.assignmentId}><Link className="underline" to={`/admin/emergencies/${k.emergencyId}`}>{k.emergencyRef}</Link> · {t(`status.${k.status}`)}</div>)}</td>
                <td className="td text-xs">{v.skills.join(', ') || '—'}</td>
                <td className="td text-xs">{v.state === 'overloaded' ? (v.alternatives.length ? v.alternatives.map((a) => <div key={a.id}><strong>{a.name}</strong> · {t('admin.workload', { count: a.activeTasks })}{a.sharedSkills.length > 0 && ` · ${a.sharedSkills.join(', ')}`}{a.distanceKm !== null && ` · ${t('automation.km', { km: a.distanceKm })}`}</div>) : t('automation.workload.noAlternatives')) : '—'}</td>
              </tr>
            ))}
          </Table>
          {data.workload.summary.overloaded > 0 && <p className="mt-2 text-xs text-ink-500">{t('automation.workload.noAutoReassign')} <Link className="underline" to="/admin/emergencies">{t('nav.emergencies')}</Link></p>}
        </Card>
      </section>

      {/* 3. zones */}
      <section id="auto-zones" className="scroll-mt-4">
        <Card
          title={`🔶 ${t('automation.zones.title')}`}
          actions={<><Filter label={t('automation.filter')} value={zoneFilter} onChange={setZoneFilter} options={[{ value: 'open', label: t('common.all') }, { value: 'detected', label: t('automation.zones.status.detected') }, { value: 'reviewed', label: t('automation.zones.status.reviewed') }]} /><Link className="btn-secondary" to="/admin/map">🗺 {t('automation.zones.viewMap')}</Link></>}
        >
          <p className="mb-3 text-xs text-ink-500">{t('automation.zones.help')} {t('automation.zones.neverMerge')}</p>
          <Table head={[t('automation.zones.area'), t('automation.zones.reports'), t('automation.zones.people'), t('automation.zones.risk'), t('common.status'), '']} empty={zones.length === 0 ? <EmptyState title={t('automation.zones.none')} /> : undefined}>
            {zones.map((z) => (
              <tr key={z.id}>
                <td className="td text-xs">{t(`emergencyType.${z.dominantType}`, { defaultValue: z.dominantType })}<div className="text-ink-500">{z.center ? `${z.center.lat.toFixed(4)}, ${z.center.lng.toFixed(4)} · ${t('automation.zones.radius', { m: z.radiusMeters })}` : ''}</div><div className="text-ink-500">{Object.entries(z.typeCounts).map(([k, n]) => `${t(`emergencyType.${k}`, { defaultValue: k })} ×${n}`).join(', ')}</div></td>
                <td className="td font-mono text-lg font-bold">{z.reportCount}{z.sosCount > 0 && <span className="ml-1 text-xs font-normal text-red-700">🆘 {z.sosCount}</span>}</td>
                <td className="td font-mono text-lg font-bold">{z.peopleCount}</td>
                <td className="td"><Badge tone={RISK_TONE[z.riskLevel]}>{t(`automation.risk.${z.riskLevel}`)}</Badge></td>
                <td className="td text-xs"><Badge tone={z.status === 'detected' ? 'amber' : 'green'}>{t(`automation.zones.status.${z.status}`)}</Badge><div className="mt-1 text-ink-500">{t('automation.zones.last', { time: formatDateTime(z.lastReportAt, i18n.language) })}</div></td>
                <td className="td"><Button variant="secondary" onClick={() => setZoneFor(z)}>{t('automation.zones.review')}</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
      </section>

      {/* 2. resources */}
      <section id="auto-resources" className="scroll-mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Card title={`🍲 ${t('automation.resources.food')}`}>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div><dt className="text-xs text-ink-500">{t('automation.resources.required')}</dt><dd className="text-2xl font-bold">{data.resources.food.required}</dd></div>
              <div><dt className="text-xs text-ink-500">{t('automation.resources.available')}</dt><dd className="text-2xl font-bold">{data.resources.food.available}</dd></div>
              <div><dt className="text-xs text-ink-500">{t('automation.resources.shortage')}</dt><dd className={`text-2xl font-bold ${data.resources.food.shortage > 0 ? 'text-red-700' : 'text-green-700'}`}>{data.resources.food.shortage}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-ink-500">{t('automation.resources.foodBasis', { n: data.resources.food.mealsPerPerson })}</p>
          </Card>
          <Card title={`⛺ ${t('automation.resources.shelter')}`}>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div><dt className="text-xs text-ink-500">{t('automation.resources.capacity')}</dt><dd className="text-2xl font-bold">{data.resources.shelter.capacity}</dd></div>
              <div><dt className="text-xs text-ink-500">{t('automation.resources.free')}</dt><dd className="text-2xl font-bold">{data.resources.shelter.freeSpaces}</dd></div>
              <div><dt className="text-xs text-ink-500">{t('automation.resources.seeking')}</dt><dd className={`text-2xl font-bold ${data.resources.shelter.peopleSeekingShelter > data.resources.shelter.freeSpaces ? 'text-red-700' : ''}`}>{data.resources.shelter.peopleSeekingShelter}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-ink-500">{t('automation.resources.shelterBasis', { occupied: data.resources.shelter.occupancy })}</p>
          </Card>
        </div>
        <Card title={`🚨 ${t('automation.resources.alerts')}`} actions={<Filter label={t('automation.filter')} value={alertFilter} onChange={setAlertFilter} options={[{ value: 'all', label: t('common.all') }, { value: 'critical', label: t('automation.severity.critical') }, { value: 'warning', label: t('automation.severity.warning') }]} />}>
          <Table head={[t('automation.resources.kind'), t('automation.resources.required'), t('automation.resources.available'), t('automation.resources.shortage'), t('automation.resources.where'), '']} empty={alerts.length === 0 ? <EmptyState title={t('automation.resources.none')} /> : undefined}>
            {alerts.map((a: ResourceAlert) => (
              <tr key={a.id}>
                <td className="td"><Badge tone={a.severity === 'critical' ? 'red' : 'amber'}>{a.severity === 'critical' ? '⛔' : '⚠'} {t(`automation.severity.${a.severity}`)}</Badge><div className="mt-1 text-sm font-semibold">{t(`automation.resources.kinds.${a.kind}`)}</div><div className="text-xs text-ink-500">{t('automation.resources.since', { time: formatDateTime(a.lastDetectedAt, i18n.language) })}</div></td>
                <td className="td font-mono">{a.required} <span className="text-xs text-ink-500">{t(`automation.unit.${a.unit}`, { defaultValue: a.unit })}</span></td>
                <td className="td font-mono">{a.available}</td>
                <td className="td font-mono font-bold text-red-700">{a.kind === 'shelter_near_capacity' ? `${a.locations[0]?.free ?? 0} ${t('automation.resources.free').toLowerCase()}` : a.shortage}</td>
                <td className="td text-xs">{a.locations.slice(0, 4).map((l, i) => <div key={i}>{l.kind === 'emergency' ? <Link className="underline" to={`/admin/emergencies/${l.refId}`}>{l.name}</Link> : l.name} · {t('common.peopleCount', { count: l.people })}{l.required ? ` · ${l.required}` : ''}</div>)}{a.locations.length > 4 && <div className="text-ink-500">+{a.locations.length - 4}</div>}</td>
                <td className="td"><Button variant="secondary" disabled={Boolean(a.acknowledgedAt)} loading={busyId === a.id} onClick={() => void act(a.id, () => post(`/automation/resource-alerts/${a.id}/acknowledge`), t('common.saved'))}>{a.acknowledgedAt ? `✔ ${t('automation.resources.acknowledged')}` : t('automation.resources.acknowledge')}</Button></td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-ink-500"><Link className="underline" to="/admin/food/supplies">{t('nav.inventory')}</Link> · <Link className="underline" to="/admin/shelters">{t('nav.shelters')}</Link></p>
        </Card>
      </section>

      {/* 4. shelters */}
      <section id="auto-shelters" className="scroll-mt-4">
        <Card title={`🏠 ${t('automation.shelters.title')}`}>
          <p className="mb-3 text-xs text-ink-500">{t('automation.shelters.help')}</p>
          <Table head={[t('nav.emergencies'), t('automation.shelters.people'), t('automation.shelters.best'), t('automation.shelters.distance'), t('automation.shelters.available'), '']} empty={data.shelterRecommendations.items.length === 0 ? <EmptyState title={t('automation.shelters.none2')} /> : undefined}>
            {data.shelterRecommendations.items.map((r) => (
              <tr key={r.emergency.id}>
                <td className="td"><Link className="font-semibold underline" to={`/admin/emergencies/${r.emergency.id}`}>{r.emergency.emergencyId}</Link><div className="text-xs text-ink-500">{t(`emergencyType.${r.emergency.type}`)}</div></td>
                <td className="td font-mono">{r.people}</td>
                <td className="td text-sm">{r.best ? <><strong>{r.best.name}</strong><div className="text-xs text-ink-500">{r.best.facilities.map((f) => t(`facility.${f}`)).join(', ') || '—'}</div></> : <span className="text-amber-800">{t('automation.shelters.noneSuitable')}</span>}</td>
                <td className="td whitespace-nowrap">{r.best ? t('automation.km', { km: r.best.distanceKm }) : '—'}</td>
                <td className="td whitespace-nowrap">{r.best ? t('shelter.availability', { available: r.best.availableSpaces, capacity: r.best.capacity }) : '—'}</td>
                <td className="td"><Button onClick={() => setShelterFor(r.emergency.id)}>{t('automation.shelters.review')}{r.alternatives > 0 ? ` (+${r.alternatives})` : ''}</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
      </section>

      {/* 6. SOS */}
      <section id="auto-sos" className="scroll-mt-4">
        <Card title={`🆘 ${t('automation.sos.title')}`} actions={<Link className="btn-secondary" to="/admin/escalations">{t('nav.escalations')}</Link>}>
          <p className="mb-3 text-xs text-ink-500">{t('automation.sos.help', { time: formatDuration(data.unacknowledgedSos.deadlineSeconds, t) })}</p>
          <Table head={[t('nav.sos'), t('automation.sos.waiting'), t('automation.sos.level'), t('common.peopleAffected'), '']} empty={data.unacknowledgedSos.items.length === 0 ? <EmptyState title={t('automation.sos.none')} /> : undefined}>
            {data.unacknowledgedSos.items.map((x) => (
              <tr key={x.id}>
                <td className="td"><Link className="font-semibold underline" to={`/admin/emergencies/${x.id}`}>{x.emergencyId}</Link><div className="text-xs text-ink-500">{t(`emergencyType.${x.type}`)}{x.address ? ` · ${x.address}` : ''}</div></td>
                <td className="td"><Badge tone={x.overdue ? 'red' : 'amber'}>{x.overdue ? '⛔' : '⏳'} {formatDuration(x.waitedSeconds, t)}</Badge></td>
                <td className="td">{x.escalationLevel > 0 ? <Badge tone="red">{t('automation.sos.levelN', { n: x.escalationLevel })}</Badge> : '—'}</td>
                <td className="td font-mono">{x.affectedCount}</td>
                <td className="td"><Button loading={busyId === x.id} onClick={() => void act(x.id, () => post(`/emergencies/${x.id}/status`, { to: 'acknowledged' }), t('common.saved'))}>👁 {t('admin.acknowledgeRequest')}</Button></td>
              </tr>
            ))}
          </Table>
        </Card>
      </section>

      {/* 8. follow-ups */}
      <section id="auto-followups" className="scroll-mt-4">
        <Card title={`🔔 ${t('automation.followUps.title')}`} actions={<Filter label={t('automation.filter')} value={fuFilter} onChange={setFuFilter} options={[{ value: 'all', label: t('common.all') }, ...(['emergency_update', 'rescue_progress', 'shelter_occupancy'] as const).map((k) => ({ value: k, label: t(`automation.followUps.kinds.${k}`) }))]} />}>
          <p className="mb-3 text-xs text-ink-500">{t('automation.followUps.help')}</p>
          <Table head={[t('automation.followUps.item'), t('automation.followUps.idle'), t('automation.followUps.remindee'), t('automation.followUps.reminders'), '']} empty={followUps.length === 0 ? <EmptyState title={t('automation.followUps.none')} /> : undefined}>
            {followUps.map((f) => (
              <tr key={f.id}>
                <td className="td"><Badge tone="blue">{t(`automation.followUps.kinds.${f.kind}`)}</Badge><div className="mt-1 text-sm font-semibold">{f.emergencyId ? <Link className="underline" to={`/admin/emergencies/${f.emergencyId}`}>{f.label}</Link> : f.shelterId ? <Link className="underline" to="/admin/shelters">{f.label}</Link> : f.label}</div></td>
                <td className="td whitespace-nowrap font-mono">{formatDuration(f.idleMinutes * 60, t)}</td>
                <td className="td text-xs">{f.assignees.length ? f.assignees.join(', ') : t('automation.followUps.admins')}</td>
                <td className="td text-xs">{f.reminderCount}{f.lastRemindedAt ? ` · ${formatDateTime(f.lastRemindedAt, i18n.language)}` : ''}</td>
                <td className="td"><div className="flex flex-wrap gap-1"><Button variant="secondary" loading={busyId === f.id} onClick={() => void act(f.id, () => post(`/automation/follow-ups/${f.id}/remind`), t('automation.followUps.reminded'))}>🔔 {t('automation.followUps.remindNow')}</Button><Button variant="ghost" onClick={() => void act(f.id, () => post(`/automation/follow-ups/${f.id}/dismiss`), t('common.saved'))}>{t('automation.followUps.dismiss')}</Button></div></td>
              </tr>
            ))}
          </Table>
        </Card>
      </section>

      {teamFor && <TeamFormationModal emergencyId={teamFor} onClose={() => setTeamFor('')} onDone={() => void reload()} />}
      {shelterFor && <ShelterConfirmModal emergencyId={shelterFor} onClose={() => setShelterFor('')} onDone={() => void reload()} />}
      {zoneFor && <ZoneModal zone={zoneFor} onClose={() => setZoneFor(null)} onDone={() => void reload()} />}
    </div>
  );
}

function ZoneModal({ zone, onClose, onDone }: { zone: Zone; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const detail = useFetch(() => get<Zone>(`/automation/zones/${zone.id}`), [zone.id]);
  const [note, setNote] = useState(zone.reviewNote ?? '');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const decide = async (decision: 'reviewed' | 'dismissed') => {
    setBusy(decision);
    setErr('');
    try { await post(`/automation/zones/${zone.id}/review`, { decision, ...(note.trim() ? { note: note.trim() } : {}) }); toast.success(t('common.saved')); onDone(); onClose(); } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(''); }
  };
  return (
    <Modal open wide title={t('automation.zones.reviewTitle')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button variant="ghost" loading={busy === 'dismissed'} onClick={() => void decide('dismissed')}>{t('automation.zones.dismiss')}</Button><Button loading={busy === 'reviewed'} onClick={() => void decide('reviewed')}>✔ {t('automation.zones.markReviewed')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="danger">{err}</Alert>}
        <Alert tone="info">{t('automation.zones.neverMerge')}</Alert>
        <p className="text-sm">{t('automation.zones.counts', { reports: zone.reportCount, people: zone.peopleCount })} · <Badge tone={RISK_TONE[zone.riskLevel]}>{t(`automation.risk.${zone.riskLevel}`)}</Badge></p>
        {detail.data?.emergencies ? (
          <ul className="space-y-1 text-sm">
            {detail.data.emergencies.map((e) => <li key={e.id} className="rounded border border-ink-200 p-2"><Link className="font-semibold underline" to={`/admin/emergencies/${e.id}`}>{e.emergencyId}</Link> · {t(`emergencyType.${e.type}`)} · {t('common.peopleCount', { count: e.affectedCount })} · {t(`status.${e.status}`)}</li>)}
          </ul>
        ) : <Spinner />}
        <label className="block text-sm font-medium">{t('automation.zones.note')}<TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Modal>
  );
}
