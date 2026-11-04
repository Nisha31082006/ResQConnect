import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { Button, Field, TextInput } from './ui';
import { PlaceSearch } from './PlaceSearch';

export interface Loc { lat: number | ''; lng: number | ''; address: string }
export const emptyLoc: Loc = { lat: '', lng: '', address: '' };
export const DEFAULT_CENTER: [number, number] = [13.0827, 80.2707];

const pin = L.divIcon({ className: '', html: '<div style="font-size:30px;line-height:30px;transform:translate(-50%,-100%)">📍</div>', iconSize: [0, 0] });

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}
function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 14));
  }, [lat, lng, map]);
  return null;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Location input: map click, device GPS, place search, or manual coordinates (works even if tiles cannot load). */
export function LocationPicker({ value, onChange, errors, compact }: { value: Loc; onChange: (v: Loc) => void; errors?: Record<string, string>; compact?: boolean }) {
  const { t } = useTranslation();
  const [gps, setGps] = useState<'idle' | 'busy' | 'denied'>('idle');
  const hasPoint = value.lat !== '' && value.lng !== '' && !Number.isNaN(Number(value.lat)) && !Number.isNaN(Number(value.lng));

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) return setGps('denied');
    setGps('busy');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange({ ...value, lat: round(p.coords.latitude), lng: round(p.coords.longitude) });
        setGps('idle');
      },
      () => setGps('denied'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" loading={gps === 'busy'} onClick={useMyLocation}>📡 {t('map.useMyLocation')}</Button>
        {gps === 'denied' && <span className="text-xs text-amber-800" role="alert">{t('map.gpsDenied')}</span>}
      </div>
      {!compact && <PlaceSearch onPick={(p) => onChange({ lat: round(p.lat), lng: round(p.lng), address: value.address || p.label.slice(0, 200) })} />}
      <div className="h-56 overflow-hidden rounded-lg border border-ink-300">
        <MapContainer center={hasPoint ? [Number(value.lat), Number(value.lng)] : DEFAULT_CENTER} zoom={hasPoint ? 14 : 11} className="h-full w-full" scrollWheelZoom={false}>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickHandler onPick={(lat, lng) => onChange({ ...value, lat: round(lat), lng: round(lng) })} />
          {hasPoint && (
            <>
              <Marker position={[Number(value.lat), Number(value.lng)]} icon={pin} />
              <Recenter lat={Number(value.lat)} lng={Number(value.lng)} />
            </>
          )}
        </MapContainer>
      </div>
      <p className="text-xs text-ink-500">{t('map.clickToPick')}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('common.latitude')} required error={errors?.['location.lat']}>
          {(id, d) => <TextInput id={id} aria-describedby={d} type="number" step="any" inputMode="decimal" value={value.lat} error={errors?.['location.lat']} onChange={(e) => onChange({ ...value, lat: e.target.value === '' ? '' : Number(e.target.value) })} />}
        </Field>
        <Field label={t('common.longitude')} required error={errors?.['location.lng']}>
          {(id, d) => <TextInput id={id} aria-describedby={d} type="number" step="any" inputMode="decimal" value={value.lng} error={errors?.['location.lng']} onChange={(e) => onChange({ ...value, lng: e.target.value === '' ? '' : Number(e.target.value) })} />}
        </Field>
      </div>
      <Field label={t('common.addressLandmark')}>
        {(id) => <TextInput id={id} maxLength={300} value={value.address} onChange={(e) => onChange({ ...value, address: e.target.value })} />}
      </Field>
    </div>
  );
}

export const locPayload = (l: Loc) => ({ lat: Number(l.lat), lng: Number(l.lng), ...(l.address ? { address: l.address } : {}) });
export const locValid = (l: Loc) => l.lat !== '' && l.lng !== '' && Math.abs(Number(l.lat)) <= 90 && Math.abs(Number(l.lng)) <= 180;
