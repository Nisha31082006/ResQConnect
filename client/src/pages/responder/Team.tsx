import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get, put } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Table } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import type { Team } from '../../types';

export default function ResponderTeam() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => get<Team[]>('/teams'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const share = (team: Team) => {
    if (!('geolocation' in navigator)) return setErr(t('map.gpsUnavailable'));
    setBusy(team.id);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          await put(`/teams/${team.id}/location`, { lat: p.coords.latitude, lng: p.coords.longitude });
          toast.success(t('responder.locationShared'));
          await reload();
        } catch (x) {
          setErr(errorMessage(x, t));
        } finally {
          setBusy(null);
        }
      },
      () => { setErr(t('map.gpsDenied')); setBusy(null); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('responder.myTeam')} />
      {err && <Alert tone="danger">{err}</Alert>}
      {loading ? <SkeletonRows /> : error ? <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} /> : !data?.length ? <EmptyState title={t('responder.noTeam')} hint={t('responder.noTeamHint')} /> : data.map((team) => (
        <Card key={team.id} title={team.name} actions={user?.role === 'team_leader' && team.leader.id === user.id ? <Button variant="secondary" loading={busy === team.id} onClick={() => share(team)}>📍 {t('responder.shareLocation')}</Button> : undefined}>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="blue">{t('responder.leader')}: {team.leader.name}</Badge>
            <Badge tone={team.availability === 'available' ? 'green' : 'amber'}>{t(`availability.${team.availability}`)}</Badge>
            <Badge>{t('responder.capacity', { count: team.capacity })}</Badge>
            {team.skills.map((s) => <Badge key={s}>{s}</Badge>)}
          </div>
          {team.lastLocation?.at && <p className="mb-2 text-xs text-ink-500">{t('responder.lastLocation', { at: formatDateTime(team.lastLocation.at, i18n.language) })}</p>}
          <Table head={[t('common.name'), t('common.skills'), t('responder.availability')]}>
            {team.members.map((m) => <tr key={m.id}><td className="td">{m.name}</td><td className="td">{m.skills.join(', ') || '—'}</td><td className="td">{t(`availability.${m.availability}`)}</td></tr>)}
          </Table>
        </Card>
      ))}
    </div>
  );
}
