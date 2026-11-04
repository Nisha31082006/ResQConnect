import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get, post } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows, Table } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { usePagedList } from '../../hooks/usePagedList';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage } from '../../utils/errors';
import { formatDateTime, formatDuration } from '../../utils/format';
import type { EscalationItem } from '../../types';

interface Monitor { deadlineSeconds: number; maxLevel: number; pendingSos: { id: string; emergencyId: string; type: string; affectedCount: number; description: string; createdAt: string; waitedSeconds: number; overdue: boolean; escalationLevel: number; escalationIds: string[] }[] }

export default function AdminEscalations() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const mon = useFetch(() => get<Monitor>('/escalations/monitor'), []);
  const list = usePagedList<EscalationItem>('/escalations', {}, { searchable: false, events: ['escalation:triggered', 'escalation:updated'] });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState('');
  useEffect(() => { const i = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { const i = setInterval(() => void mon.reload(), 15000); return () => clearInterval(i); }, [mon]);
  useSocketEvents(['sos:created', 'sos:updated', 'emergency:status', 'escalation:triggered', 'escalation:updated'], () => { void mon.reload(); void list.reload(); });
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await Promise.all([mon.reload(), list.reload()]); toast.success(t('common.saved')); } catch (x) { toast.error(errorMessage(x, t)); } finally { setBusy(''); }
  };
  void tick;
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.escalations')} subtitle={mon.data ? t('admin.escalationSubtitle', { deadline: formatDuration(mon.data.deadlineSeconds, t), max: mon.data.maxLevel }) : undefined} actions={<Button variant="secondary" loading={busy === 'run'} onClick={() => void act('run', () => post('/escalations/run'))}>⟳ {t('admin.runCheck')}</Button>} />
      <Alert tone="info">{t('admin.schedulerNote')}</Alert>
      <Card title={t('admin.unacknowledgedSos')}>
        {mon.loading ? <SkeletonRows rows={3} /> : mon.error ? <ErrorState message={errorMessage(mon.error, t)} onRetry={() => void mon.reload()} /> : !mon.data?.pendingSos.length ? <EmptyState title={t('admin.noPendingSos')} /> : (
          <Table head={[t('common.id'), t('common.type'), t('admin.waiting'), t('admin.level'), '']}>
            {mon.data.pendingSos.map((s) => {
              const waited = s.waitedSeconds + 0 * tick;
              const live = Math.max(waited, Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 1000));
              return (
                <tr key={s.id} className={live >= (mon.data?.deadlineSeconds ?? 1e9) ? 'bg-red-50' : ''}>
                  <td className="td font-mono text-xs">{s.emergencyId}</td>
                  <td className="td">{t(`emergencyType.${s.type}`)} · {s.affectedCount}</td>
                  <td className="td font-semibold">{formatDuration(live, t)} {live >= (mon.data?.deadlineSeconds ?? 1e9) && <Badge tone="red">{t('admin.overdue')}</Badge>}</td>
                  <td className="td">{s.escalationLevel > 0 ? <Badge tone="red">L{s.escalationLevel}</Badge> : '—'}</td>
                  <td className="td"><Link className="font-semibold text-blue-700 underline" to={`/admin/emergencies/${s.id}`}>{t('admin.respond')}</Link></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Card title={t('admin.escalationLog')}>
        {list.loading ? <SkeletonRows rows={3} /> : list.error ? <ErrorState message={errorMessage(list.error, t)} /> : (
          <Table head={[t('common.id'), t('admin.level'), t('common.status'), t('admin.triggeredAt'), '']} empty={list.items.length === 0 ? <EmptyState title={t('common.noResults')} /> : undefined}>
            {list.items.map((x) => (
              <tr key={x.id}>
                <td className="td font-mono text-xs">{x.emergency ? <Link className="underline" to={`/admin/emergencies/${x.emergency.id}`}>{x.emergency.emergencyId}</Link> : '—'}</td>
                <td className="td"><Badge tone="red">L{x.level}</Badge></td>
                <td className="td"><Badge tone={x.status === 'open' ? 'red' : x.status === 'acknowledged' ? 'amber' : 'green'}>{t(`admin.escStatus.${x.status}`)}</Badge></td>
                <td className="td whitespace-nowrap">{formatDateTime(x.triggeredAt, i18n.language)} · {formatDuration(x.elapsedSeconds, t)}</td>
                <td className="td whitespace-nowrap">
                  {x.status === 'open' && <Button variant="secondary" loading={busy === `a${x.id}`} onClick={() => void act(`a${x.id}`, () => post(`/escalations/${x.id}/acknowledge`, {}))}>{t('admin.acknowledge')}</Button>}{' '}
                  {x.status !== 'resolved' && <Button variant="ghost" loading={busy === `r${x.id}`} onClick={() => void act(`r${x.id}`, () => post(`/escalations/${x.id}/resolve`, {}))}>{t('admin.resolve')}</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      </Card>
    </div>
  );
}
