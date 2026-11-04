import { useMemo } from 'react';
import { Circle, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MapData } from '../types';
import { DEFAULT_CENTER } from './LocationPicker';
import { PriorityBadge, StatusBadge } from './ui';
import type { EmergencyStatus } from '../types';

export interface MapLayers { emergencies: boolean; shelters: boolean; food: boolean; roads: boolean; teams: boolean; zones: boolean }
export const ALL_LAYERS: MapLayers = { emergencies: true, shelters: true, food: true, roads: true, teams: true, zones: true };
const ZONE_COLOR: Record<string, string> = { critical: '#b91c1c', high: '#ea580c', medium: '#d97706', low: '#64748b' };

const PRI_COLOR = { critical: '#b91c1c', high: '#ea580c', medium: '#f59e0b', low: '#64748b' } as const;
const TYPE_ICON: Record<string, string> = { flood: '🌊', fire: '🔥', earthquake: '🏚', cyclone: '🌀', landslide: '⛰', medical: '⚕', trapped: '🆘', food_water: '🥫', shelter_needed: '⛺', road_hazard: '🚧', other: '❗' };

const html = (inner: string, bg: string, border = '#fff', extra = '') =>
  L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16], html: `<div style="width:34px;height:34px;border-radius:50%;background:${bg};border:3px ${border};display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;font-weight:800;box-shadow:0 1px 4px rgba(0,0,0,.5);${extra}">${inner}</div>` });

export function emergencyIcon(e: MapData['emergencies'][number]) {
  const bg = PRI_COLOR[e.priority];
  const dim = e.status === 'resolved' ? 'opacity:.5;' : '';
  if (e.kind === 'sos') return html('SOS', bg, '#fff solid', `font-size:11px;box-shadow:0 0 0 4px rgba(185,28,28,.35);${dim}`);
  // Unconfirmed priority = dashed outline (recommendation only)
  return html(TYPE_ICON[e.type] ?? '❗', bg, e.priorityConfirmed ? '#fff solid' : '#111 dashed', dim);
}
export const shelterIcon = (s: { status: string }) => html('🏠', s.status === 'full' ? '#475569' : '#15803d');
export const foodIcon = () => html('🍲', '#c2410c');
export const teamIcon = () => html('🚑', '#1d4ed8');
export function roadIcon(r: MapData['roads'][number]) {
  if (r.status === 'cleared') return html('✓', '#15803d');
  if (r.clearancePending) return html('⏳', '#7c3aed', '#fff dashed');
  return r.verified ? html('🚧', '#111827') : html('?', '#9ca3af', '#111 dashed');
}

interface Props {
  data: MapData | null;
  layers?: MapLayers;
  filters?: { type?: string; priority?: string; status?: string };
  detailPath?: (id: string) => string | null;
  height?: string;
  center?: [number, number];
}

export function MapView({ data, layers = ALL_LAYERS, filters = {}, detailPath, height = '70vh', center }: Props) {
  const { t } = useTranslation();
  const ems = useMemo(
    () => (data?.emergencies ?? []).filter((e) => (!filters.type || e.type === filters.type) && (!filters.priority || e.priority === filters.priority) && (!filters.status || e.status === filters.status)),
    [data, filters.type, filters.priority, filters.status],
  );
  const c: [number, number] = center ?? (ems[0] ? [ems[0].lat, ems[0].lng] : data?.shelters[0] ? [data.shelters[0].lat, data.shelters[0].lng] : DEFAULT_CENTER);
  return (
    <div style={{ height }} className="overflow-hidden rounded-xl border border-ink-200" data-testid="map">
      <MapContainer center={c} zoom={12} className="h-full w-full" scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {layers.emergencies &&
          ems.map((e) => (
            <Marker key={`e${e.id}`} position={[e.lat, e.lng]} icon={emergencyIcon(e)} zIndexOffset={e.kind === 'sos' ? 1000 : 0}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-bold">{e.kind === 'sos' ? '🆘 ' : ''}{e.emergencyId}</div>
                  <div>{t(`emergencyType.${e.type}`)} · {t('common.peopleCount', { count: e.affectedCount })}</div>
                  <div className="flex flex-wrap gap-1"><PriorityBadge level={e.priority} confirmed={e.priorityConfirmed} /><StatusBadge status={e.status as EmergencyStatus} /></div>
                  {e.description && <div className="text-ink-700">{e.description}</div>}
                  {detailPath?.(e.id) && <Link className="font-semibold text-blue-700 underline" to={detailPath(e.id)!}>{t('common.viewDetails')}</Link>}
                </div>
              </Popup>
            </Marker>
          ))}
        {layers.shelters &&
          data?.shelters.map((s) => (
            <Marker key={`s${s.id}`} position={[s.lat, s.lng]} icon={shelterIcon(s)}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-bold">🏠 {s.name}</div>
                  <div>{t('shelter.availability', { available: s.available, capacity: s.capacity })}</div>
                  <div>{t(`shelterStatus.${s.status}`)}</div>
                  {s.facilities.length > 0 && <div className="text-xs">{s.facilities.map((f) => t(`facility.${f}`)).join(', ')}</div>}
                  {s.phone && <a className="text-blue-700 underline" href={`tel:${s.phone}`}>{s.phone}</a>}
                </div>
              </Popup>
            </Marker>
          ))}
        {layers.food &&
          data?.food.map((f) => (
            <Marker key={`f${f.id}`} position={[f.lat, f.lng]} icon={foodIcon()}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-bold">🍲 {f.name}</div>
                  <div>{t('food.availableNow', { count: f.available })}</div>
                  <div>{f.operatingHours}</div>
                </div>
              </Popup>
            </Marker>
          ))}
        {layers.roads &&
          data?.roads.map((r) => (
            <Marker key={`r${r.id}`} position={[r.lat, r.lng]} icon={roadIcon(r)}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-bold">{t(`blockageType.${r.type}`)} · {t(`severity.${r.severity}`)}</div>
                  <div className={r.verified ? 'font-semibold text-green-800' : 'font-semibold text-amber-800'}>{r.verified ? `✔ ${t('roads.verified')}` : `? ${t('roads.unverified')}`}</div>
                  {r.status === 'cleared' && <div className="text-green-800">✓ {t('roads.cleared')}</div>}
                  {r.clearancePending && <div className="text-purple-800">⏳ {t('roads.clearancePending')}</div>}
                  <div>{r.description}</div>
                </div>
              </Popup>
            </Marker>
          ))}
        {layers.zones &&
          data?.zones?.map((z) => (
            <Circle key={`z${z.id}`} center={[z.lat, z.lng]} radius={Math.max(z.radiusMeters, 150)} pathOptions={{ color: ZONE_COLOR[z.riskLevel] ?? '#d97706', fillOpacity: 0.15, dashArray: '6 6' }}>
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-bold">🔶 {t('automation.zones.possibleZone')}</div>
                  <div>{t('automation.zones.counts', { reports: z.reportCount, people: z.peopleCount })}</div>
                  <div>{t(`emergencyType.${z.dominantType}`, { defaultValue: z.dominantType })} · {t(`automation.risk.${z.riskLevel}`)}</div>
                  <div className="text-xs text-ink-500">{t('automation.zones.mapNote')}</div>
                </div>
              </Popup>
            </Circle>
          ))}
        {layers.teams &&
          data?.teams.map((tm) => (
            <Marker key={`t${tm.id}`} position={[tm.lat, tm.lng]} icon={teamIcon()}>
              <Popup><div className="text-sm font-bold">🚑 {tm.name}</div></Popup>
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}

export function MapLegend() {
  const { t } = useTranslation();
  const items: [string, string][] = [
    ['SOS', t('map.legend.sos')],
    ['🌊', t('map.legend.emergency')],
    ['┅', t('map.legend.unconfirmed')],
    ['🏠', t('map.legend.shelter')],
    ['🍲', t('map.legend.food')],
    ['🚧', t('map.legend.roadVerified')],
    ['?', t('map.legend.roadUnverified')],
    ['🚑', t('map.legend.team')],
    ['🔶', t('map.legend.zone')],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700" aria-label={t('map.legend.title')}>
      {items.map(([i, l]) => (
        <li key={l} className="flex items-center gap-1"><span aria-hidden className="inline-block min-w-5 rounded bg-ink-100 px-1 text-center">{i}</span>{l}</li>
      ))}
    </ul>
  );
}
