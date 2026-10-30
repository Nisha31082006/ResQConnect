import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getPaged } from '../../services/api';
import { Alert, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui';
import { EmergencyTable } from '../../components/EmergencyTable';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { removeItem } from '../../services/offlineQueue';
import { errorMessage } from '../../utils/errors';
import type { Emergency } from '../../types';

export default function CitizenDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { queue, syncNow, syncing, online } = useOffline();
  const { data, loading, error, reload } = useFetch(() => getPaged<Emergency>('/emergencies', { mine: true, limit: 5 }), []);
  useSocketEvents(['emergency:updated', 'emergency:status', 'assignment:changed', 'sos:updated'], () => void reload());
  const waiting = queue.filter((q) => q.status !== 'synced');
  return (
    <div className="space-y-5">
      <PageHeader title={t('citizen.welcome', { name: user?.name })} subtitle={t('citizen.dashboardSubtitle')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/citizen/sos" className="sos-pulse flex flex-col items-center justify-center rounded-2xl bg-red-700 p-8 text-center text-white shadow-lg hover:bg-red-800">
          <span className="text-5xl" aria-hidden>🆘</span>
          <span className="mt-2 text-2xl font-extrabold">{t('citizen.sosTitle')}</span>
          <span className="text-sm opacity-90">{t('citizen.sosCardHint')}</span>
        </Link>
        <Link to="/citizen/report" className="card flex flex-col items-center justify-center p-8 text-center hover:bg-ink-50">
          <span className="text-5xl" aria-hidden>📝</span>
          <span className="mt-2 text-xl font-bold">{t('citizen.reportTitle')}</span>
          <span className="text-sm text-ink-500">{t('citizen.reportCardHint')}</span>
        </Link>
      </div>
      {!online && <Alert tone="warn">{t('offline.banner')} <Link className="font-semibold underline" to="/emergency-sms">{t('offline.smsOpenPage')}</Link></Alert>}
      {waiting.length > 0 && (
        <Card title={t('offline.queueTitle')} actions={<Button variant="secondary" onClick={() => void syncNow()} loading={syncing} disabled={!online}>{t('offline.syncNow')}</Button>}>
          <ul className="divide-y divide-ink-100 text-sm">
            {waiting.map((q) => (
              <li key={q.clientRequestId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><strong>{q.kind === 'sos' ? t('kind.sos') : t('kind.normal')}</strong> · {t(`emergencyType.${String(q.payload.type)}`)} · {t(`offline.status.${q.status}`)}</span>
                {q.error && <span className="text-xs text-red-700">{q.error}</span>}
                {q.status === 'failed' && <Button variant="ghost" onClick={() => void removeItem(q.clientRequestId)}>{t('common.remove')}</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={t('citizen.recentRequests')} actions={<Link className="text-sm font-semibold text-blue-700 underline" to="/citizen/requests">{t('common.viewAll')}</Link>}>
        {loading ? <SkeletonRows rows={3} /> : error ? <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} /> : data && data.data.length ? <EmergencyTable items={data.data} basePath="/citizen/requests" /> : <EmptyState title={t('citizen.noRequests')} hint={t('citizen.noRequestsHint')} />}
      </Card>
    </div>
  );
}
