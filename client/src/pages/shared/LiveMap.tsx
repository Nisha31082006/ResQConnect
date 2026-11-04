import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get } from '../../services/api';
import { ALL_LAYERS, MapLegend, MapView, type MapLayers } from '../../components/MapView';
import { Alert, Checkbox, ErrorState, PageHeader, Spinner } from '../../components/ui';
import { useFetch } from '../../hooks/useFetch';
import { useSocketEvents } from '../../hooks/useSocketEvents';
import { errorMessage } from '../../utils/errors';
import type { MapData } from '../../types';

/** Shared live map for every role. The API decides what each role may see; the checkboxes only toggle layers. */
export default function LiveMap({ title, emergencyPath }: { title?: string; emergencyPath?: string }) {
  const { t } = useTranslation();
  const [layers, setLayers] = useState<MapLayers>(ALL_LAYERS);
  const [filters, setFilters] = useState<{ type?: string; priority?: string; status?: string }>({});
  const { data, loading, error, reload } = useFetch(() => get<MapData>('/map'), []);
  useSocketEvents(['map:refresh'], () => void reload());
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} />;
  const available: (keyof MapLayers)[] = (['emergencies', 'shelters', 'food', 'roads', 'teams', 'zones'] as const).filter((k) => (data[k]?.length ?? 0) > 0);
  return (
    <div className="space-y-3">
      <PageHeader title={title ?? t('nav.map')} subtitle={t('map.subtitle')} />
      <div className="flex flex-wrap gap-4" role="group" aria-label={t('map.layers')}>
        {available.map((k) => <Checkbox key={k} label={`${t(`map.layer.${k}`)} (${data[k]?.length ?? 0})`} checked={layers[k]} onChange={(v) => setLayers({ ...layers, [k]: v })} />)}
      </div>
      {data.emergencies.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <select aria-label={t('priority.title')} className="input max-w-44" value={filters.priority ?? ''} onChange={(e) => setFilters({ ...filters, priority: e.target.value || undefined })}>
            <option value="">{t('common.allPriorities')}</option>
            {(['critical', 'high', 'medium', 'low'] as const).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
          </select>
        </div>
      )}
      {data.emergencies.length === 0 && data.shelters.length === 0 && data.roads.length === 0 && <Alert tone="info">{t('map.empty')}</Alert>}
      <MapView data={data} layers={layers} filters={filters} detailPath={emergencyPath ? (id) => `${emergencyPath}/${id}` : undefined} />
      <MapLegend />
    </div>
  );
}
