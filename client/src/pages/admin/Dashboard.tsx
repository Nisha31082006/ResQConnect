import { useTranslation } from 'react-i18next';
import { get } from '../../services/api';
import { Link } from 'react-router-dom';
import { Card, ErrorState, PageHeader, PriorityBadge, SkeletonRows, StatCard } from '../../components/ui';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage } from '../../utils/errors';
import { STATUSES, PRIORITIES } from '../../utils/enums';
import type { PriorityLevel } from '../../types';
import type { Overview } from './automation/types';

interface Stats {
  byStatus: Record<string, number>; byPriority: Record<string, number>; activeSos: number; pendingSos: number; escalationsOpen: number; pendingCompletions: number;
  pendingRoads: number; pendingFood: number; pendingUsers: number; duplicates: number; staffingGaps: number; shelters: { capacity: number; occupancy: number };
}

/** Compact "Smart Automation" section; the full dashboard (tables, filters, actions) lives at /admin/automation. */
function AutomationSection() {
  const { t } = useTranslation();
  const { data, reload } = useFetch(() => get<Overview>('/automation/overview'), []);
  useSocketEvents(['automation:updated', 'resource:alert', 'zone:detected', 'followup:created', 'escalation:triggered', 'escalation:updated'], () => void reload());
  const s = data?.summary;
  return (
    <Card title={`🤖 ${t('automation.title')}`} actions={<Link className="btn-secondary" to="/admin/automation">{t('automation.openFull')} ›</Link>}>
      <p className="mb-3 text-xs text-ink-500">{t('automation.rulesNote')}</p>
      {!s ? <SkeletonRows rows={2} /> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label={t('automation.tiles.teams')} value={s.emergenciesNeedingTeams} tone={s.emergenciesNeedingTeams > 0 ? 'warn' : 'ok'} to="/admin/automation" />
          <StatCard label={t('automation.tiles.workload')} value={`${s.overloadedVolunteers} / ${s.availableVolunteers}`} tone={s.overloadedVolunteers > 0 ? 'warn' : 'ok'} to="/admin/automation" hint={t('automation.tiles.workloadHint')} />
          <StatCard label={t('automation.tiles.zones')} value={s.zonesToReview} tone={s.zonesToReview > 0 ? 'warn' : 'ok'} to="/admin/automation" />
          <StatCard label={t('automation.tiles.shortages')} value={s.openShortages} tone={s.criticalShortages > 0 ? 'danger' : s.openShortages > 0 ? 'warn' : 'ok'} to="/admin/automation" />
          <StatCard label={t('automation.tiles.shelters')} value={s.shelterRecommendations} tone={s.shelterRecommendations > 0 ? 'warn' : 'ok'} to="/admin/automation" />
          <StatCard label={t('automation.tiles.sos')} value={s.unacknowledgedSos} tone={s.overdueSos > 0 ? 'danger' : s.unacknowledgedSos > 0 ? 'warn' : 'ok'} to="/admin/automation" />
          <StatCard label={t('automation.tiles.followUps')} value={s.pendingFollowUps} tone={s.pendingFollowUps > 0 ? 'warn' : 'ok'} to="/admin/automation" />
        </div>
      )}
    </Card>
  );
}

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useFetch(() => get<Stats>('/admin/stats'), []);
  useSocketEvents(['emergency:created', 'sos:created', 'sos:updated', 'emergency:updated', 'emergency:status', 'escalation:triggered', 'escalation:updated', 'assignment:changed', 'road:updated', 'shelter:updated', 'completion:submitted', 'completion:verified'], () => void reload());
  if (loading) return <SkeletonRows rows={6} />;
  if (error || !data) return <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} />;
  const free = Math.max(0, data.shelters.capacity - data.shelters.occupancy);
  const max = Math.max(1, ...Object.values(data.byStatus));
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.dashboard')} subtitle={t('admin.dashboardSubtitle')} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('admin.pendingSos')} value={data.pendingSos} tone={data.pendingSos > 0 ? 'danger' : 'ok'} to="/admin/escalations" />
        <StatCard label={t('admin.openEscalations')} value={data.escalationsOpen} tone={data.escalationsOpen > 0 ? 'danger' : 'ok'} to="/admin/escalations" />
        <StatCard label={t('admin.activeSos')} value={data.activeSos} to="/admin/emergencies" />
        <StatCard label={t('admin.staffingGaps')} value={data.staffingGaps} tone={data.staffingGaps > 0 ? 'warn' : 'ok'} to="/admin/emergencies" />
        <StatCard label={t('admin.pendingVerification')} value={data.pendingCompletions} tone={data.pendingCompletions > 0 ? 'warn' : 'default'} to="/admin/verification" />
        <StatCard label={t('admin.pendingRoads')} value={data.pendingRoads} tone={data.pendingRoads > 0 ? 'warn' : 'default'} to="/admin/roads" />
        <StatCard label={t('admin.pendingFood')} value={data.pendingFood} tone={data.pendingFood > 0 ? 'warn' : 'default'} to="/admin/food" />
        <StatCard label={t('admin.duplicatesToReview')} value={data.duplicates} tone={data.duplicates > 0 ? 'warn' : 'default'} to="/admin/duplicates" />
        <StatCard label={t('admin.pendingUsers')} value={data.pendingUsers} tone={data.pendingUsers > 0 ? 'warn' : 'default'} to="/admin/users" />
        <StatCard label={t('admin.shelterFree')} value={`${free} / ${data.shelters.capacity}`} to="/admin/shelters" hint={t('admin.shelterFreeHint')} />
      </div>
      <AutomationSection />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('admin.byStatus')}>
          <ul className="space-y-2">
            {STATUSES.map((s) => (
              <li key={s} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0">{t(`status.${s}`)}</span>
                <div className="h-3 flex-1 overflow-hidden rounded bg-ink-100" aria-hidden><div className="h-full bg-brand-600" style={{ width: `${((data.byStatus[s] ?? 0) / max) * 100}%` }} /></div>
                <span className="w-8 text-right font-mono">{data.byStatus[s] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('admin.byPriority')}>
          <ul className="space-y-2">
            {PRIORITIES.map((p) => <li key={p} className="flex items-center justify-between text-sm"><PriorityBadge level={p as PriorityLevel} /><span className="font-mono text-lg font-bold">{data.byPriority[p] ?? 0}</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-ink-500">{t('admin.priorityNote')}</p>
        </Card>
      </div>
    </div>
  );
}
