import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get } from '../../services/api';
import { Card, EmptyState, ErrorState, KindBadge, PageHeader, SkeletonRows, StatusBadge } from '../../components/ui';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import type { Assignment, EmergencyStatus } from '../../types';

export default function ResponderAssigned() {
  const { t, i18n } = useTranslation();
  const { data, loading, error, reload } = useFetch(() => get<Assignment[]>('/assignments'), []);
  useSocketEvents(['assignment:changed', 'emergency:status', 'emergency:updated'], () => void reload());
  return (
    <div className="space-y-4">
      <PageHeader title={t('responder.assigned')} subtitle={t('responder.assignedSubtitle')} />
      {loading ? <SkeletonRows /> : error ? <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} /> : !data?.length ? <EmptyState title={t('responder.noAssignments')} hint={t('responder.noAssignmentsHint')} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((a) => (
            <Card key={a.id} title={`${a.emergency.emergencyId ?? ''} · ${a.emergency.type ? t(`emergencyType.${a.emergency.type}`) : ''}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {a.emergency.kind && <KindBadge kind={a.emergency.kind as 'sos' | 'normal'} />}
                {a.emergency.status && <StatusBadge status={a.emergency.status as EmergencyStatus} />}
              </div>
              <p className="text-sm">{t('responder.team')}: <strong>{a.team?.name ?? t('responder.directVolunteers')}</strong></p>
              {a.instructions && <p className="mt-2 rounded bg-amber-50 p-2 text-sm"><strong>{t('responder.instructions')}:</strong> {a.instructions}</p>}
              <p className="mt-2 text-xs text-ink-500">{t('responder.assignedAt', { at: formatDateTime(a.assignedAt, i18n.language) })}</p>
              <Link className="btn-primary mt-3" to={`/responder/emergencies/${a.emergency.id}`}>{t('common.viewDetails')}</Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
