import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Field, Select, TextArea, TextInput } from '../../components/ui';
import { SmsFallbackCard } from '../../components/SmsFallbackCard';
import { EMERGENCY_TYPES } from '../../utils/enums';
import { useOffline } from '../../context/OfflineContext';

/** Works without signing in and without internet (only needs the page to be cached by the service worker). */
export default function SmsFallback() {
  const { t } = useTranslation();
  const { online } = useOffline();
  const [type, setType] = useState('trapped');
  const [people, setPeople] = useState(1);
  const [text, setText] = useState('');
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [gps, setGps] = useState('');

  const locate = () => {
    setGps(t('map.locating'));
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude);
        setLng(p.coords.longitude);
        setGps(t('map.located'));
      },
      () => setGps(t('map.gpsDenied')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-bold">{t('offline.smsPageTitle')}</h1>
      <Alert tone={online ? 'info' : 'warn'}>{online ? t('offline.smsPageOnline') : t('offline.banner')}</Alert>
      <div className="card space-y-4 p-4">
        <Field label={t('common.type')} required>
          {(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>{EMERGENCY_TYPES.map((x) => <option key={x} value={x}>{t(`emergencyType.${x}`)}</option>)}</Select>}
        </Field>
        <Field label={t('common.peopleAffected')} required>
          {(id) => <TextInput id={id} type="number" min={1} value={people} onChange={(e) => setPeople(Math.max(1, Number(e.target.value) || 1))} />}
        </Field>
        <Field label={t('common.shortDescription')}>{(id) => <TextArea id={id} rows={2} maxLength={120} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        <div>
          <button type="button" className="btn-secondary" onClick={locate}>📡 {t('map.useMyLocation')}</button>
          {gps && <span className="ml-2 text-sm">{gps}</span>}
          {lat !== undefined && lng !== undefined && <p className="mt-1 text-xs text-ink-500">{lat.toFixed(5)}, {lng.toFixed(5)}</p>}
        </div>
      </div>
      <SmsFallbackCard type={type} people={people} lat={lat} lng={lng} text={text} />
    </div>
  );
}
