import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { get, post, put } from '../../services/api';
import { useFetch } from '../../hooks/useFetch';
import { Alert, Button, Card, Field, PageHeader, Select, TextInput } from '../../components/ui';
import { TagInput } from '../../components/FormBits';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { collect, minLen, password as vPassword, phone as vPhone, required, translateErrors } from '../../utils/validate';

/** Volunteers share a base location so the admin's team recommendations can consider distance. */
function LocationCard() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const saved = useFetch(() => get<{ lat: number; lng: number; updatedAt?: string } | null>('/users/me/location'), []);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const store = async (la: number, ln: number) => {
    setBusy(true);
    setErr('');
    try {
      await put('/users/me/location', { lat: la, lng: ln });
      toast.success(t('common.saved'));
      await saved.reload();
    } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(false); }
  };
  const useGps = () => {
    if (!navigator.geolocation) return setErr(t('map.gpsUnavailable'));
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(5)); setLng(p.coords.longitude.toFixed(5)); void store(p.coords.latitude, p.coords.longitude); },
      () => { setBusy(false); setErr(t('map.gpsDenied')); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  const manual = () => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!lat || !lng || !Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return setErr(t('validation.invalid_coordinates'));
    void store(la, ln);
  };
  return (
    <Card title={t('profile.baseLocation')}>
      <p className="mb-3 text-sm text-ink-700">{t('profile.baseLocationHint')}</p>
      {err && <div className="mb-3"><Alert tone="danger">{err}</Alert></div>}
      {saved.data && <p className="mb-3 text-sm">{t('profile.locationSaved', { lat: saved.data.lat.toFixed(4), lng: saved.data.lng.toFixed(4) })}{saved.data.updatedAt ? ` · ${new Intl.DateTimeFormat(i18n.language.startsWith('ta') ? 'ta-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(saved.data.updatedAt))}` : ''}</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <Field label={t('common.latitude')}>{(id) => <TextInput id={id} inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />}</Field>
        <Field label={t('common.longitude')}>{(id) => <TextInput id={id} inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />}</Field>
        <Button variant="secondary" loading={busy} onClick={manual}>{t('common.save')}</Button>
        <Button variant="secondary" loading={busy} onClick={useGps}>📍 {t('map.useMyLocation')}</Button>
      </div>
    </Card>
  );
}

export default function Profile() {
  const { t } = useTranslation();
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const responder = user?.role === 'volunteer' || user?.role === 'team_leader';
  const [f, setF] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', lang: user?.preferredLanguage ?? 'en', availability: user?.availability ?? 'available' });
  const [skills, setSkills] = useState<string[]>(user?.skills ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwErr, setPwErr] = useState<Record<string, string>>({});
  const [pwBusy, setPwBusy] = useState(false);
  if (!user) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([['name', required(f.name) ?? minLen(f.name, 2)], ['phone', f.phone ? vPhone(f.phone) : undefined]]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError('');
    try {
      await updateProfile({ name: f.name.trim(), ...(f.phone ? { phone: f.phone } : {}), preferredLanguage: f.lang, ...(responder ? { skills, availability: f.availability } : {}) });
      toast.success(t('common.saved'));
    } catch (x) { setErrors(fieldErrors(x, t)); setServerError(errorMessage(x, t)); } finally { setBusy(false); }
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([['current', required(pw.current)], ['next', vPassword(pw.next)]]);
    setPwErr(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setPwBusy(true);
    try { await post('/auth/change-password', { currentPassword: pw.current, newPassword: pw.next }); setPw({ current: '', next: '' }); toast.success(t('profile.passwordChanged')); } catch (x) { setPwErr({ current: errorMessage(x, t) }); } finally { setPwBusy(false); }
  };
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={t('nav.profile')} subtitle={`${user.email} · ${t(`role.${user.role}`)}`} />
      <Card title={t('profile.details')}>
        <form onSubmit={save} noValidate className="space-y-4">
          {serverError && <Alert tone="danger">{serverError}</Alert>}
          <Field label={t('common.name')} required error={errors.name}>{(id) => <TextInput id={id} value={f.name} error={errors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label={t('common.phone')} error={errors.phone}>{(id) => <TextInput id={id} type="tel" value={f.phone} error={errors.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          <Field label={t('common.language')} required>{(id) => <Select id={id} value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value as 'en' | 'ta' })}><option value="en">English</option><option value="ta">தமிழ்</option></Select>}</Field>
          {responder && (
            <>
              <Field label={t('responder.availability')}>{(id) => <Select id={id} value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value as typeof f.availability })}>{['available', 'busy', 'unavailable'].map((a) => <option key={a} value={a}>{t(`availability.${a}`)}</option>)}</Select>}</Field>
              <Field label={t('common.skills')}>{() => <TagInput value={skills} onChange={setSkills} />}</Field>
            </>
          )}
          <Button type="submit" loading={busy}>{t('common.save')}</Button>
        </form>
      </Card>
      {responder && <LocationCard />}
      <Card title={t('profile.changePassword')}>
        <form onSubmit={changePw} noValidate className="space-y-4">
          <Field label={t('profile.currentPassword')} required error={pwErr.current}>{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={pw.current} error={pwErr.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
          <Field label={t('profile.newPassword')} required error={pwErr.next}>{(id) => <TextInput id={id} type="password" autoComplete="new-password" value={pw.next} error={pwErr.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}</Field>
          <Button type="submit" variant="secondary" loading={pwBusy}>{t('profile.changePassword')}</Button>
        </form>
      </Card>
    </div>
  );
}
