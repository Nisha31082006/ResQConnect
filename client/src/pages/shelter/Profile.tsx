import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { get, getPaged, patch, post } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Select, SkeletonRows, TextArea, TextInput } from '../../components/ui';
import { MultiCheck } from '../../components/FormBits';
import { emptyLoc, locPayload, locValid, LocationPicker, type Loc } from '../../components/LocationPicker';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { FACILITIES } from '../../utils/enums';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { collect, intBetween, minLen, phone as vPhone, required, translateErrors } from '../../utils/validate';
import type { Emergency, Shelter } from '../../types';

/** Shelter details. Coordinators edit their own shelters; admins also create shelters and refer people to them. */
export default function ShelterProfile({ admin = false }: { admin?: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => getPaged<Shelter>('/shelters', admin ? { limit: 100 } : { mine: true, limit: 100 }), [admin]);
  const [edit, setEdit] = useState<Shelter | 'new' | null>(null);
  const [refer, setRefer] = useState<Shelter | null>(null);
  const shelters = data?.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title={admin ? t('nav.shelters') : t('shelter.myShelters')} actions={admin ? <Button onClick={() => setEdit('new')}>＋ {t('shelter.create')}</Button> : undefined} />
      {loading ? <SkeletonRows /> : error ? <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} /> : shelters.length === 0 ? <EmptyState title={t('shelter.none')} hint={admin ? undefined : t('shelter.noneHint')} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shelters.map((s) => (
            <Card key={s.id} title={s.name} actions={<><Button variant="secondary" onClick={() => setEdit(s)}>{t('common.edit')}</Button>{admin && <Button variant="secondary" onClick={() => setRefer(s)}>➜ {t('shelter.refer')}</Button>}</>}>
              <div className="mb-2 flex flex-wrap gap-2"><Badge tone={s.status === 'open' ? 'green' : 'red'}>{t(`shelterStatus.${s.status}`)}</Badge><Badge>{t('shelter.availability', { available: s.available, capacity: s.capacity })}</Badge></div>
              <p className="text-sm">{s.location?.address ?? '—'}</p>
              <p className="mt-1 text-xs">{s.facilities.map((f) => t(`facility.${f}`)).join(' · ')}</p>
              {s.accessibilityNotes && <p className="mt-1 text-xs text-ink-500">♿ {s.accessibilityNotes}</p>}
            </Card>
          ))}
        </div>
      )}
      {edit && <ShelterForm shelter={edit === 'new' ? null : edit} admin={admin} onClose={() => setEdit(null)} onDone={() => { setEdit(null); toast.success(t('common.saved')); void reload(); }} />}
      {refer && <ReferModal shelter={refer} onClose={() => setRefer(null)} onDone={() => { setRefer(null); toast.success(t('shelter.referred')); }} />}
    </div>
  );
}

function ShelterForm({ shelter, admin, onClose, onDone }: { shelter: Shelter | null; admin: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: shelter?.name ?? '', capacity: String(shelter?.capacity ?? 50), occupancy: String(shelter?.occupancy ?? 0), status: shelter?.status ?? 'open', notes: shelter?.accessibilityNotes ?? '', cname: shelter?.contact.name ?? '', cphone: shelter?.contact.phone ?? '' });
  const [fac, setFac] = useState<string[]>(shelter?.facilities ?? []);
  const [loc, setLoc] = useState<Loc>(shelter?.location ? { lat: shelter.location.lat, lng: shelter.location.lng, address: shelter.location.address ?? '' } : emptyLoc);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([['name', required(f.name) ?? minLen(f.name, 2)], ['capacity', intBetween(f.capacity, 1, 100000)], ['occupancy', !shelter ? intBetween(f.occupancy, 0, 100000) : undefined], ['cphone', f.cphone ? vPhone(f.cphone) : undefined], ['location.lat', locValid(loc) ? undefined : 'invalid_coordinates']]);
    if (!shelter && !errs.capacity && !errs.occupancy && Number(f.occupancy) > Number(f.capacity)) errs.occupancy = 'occupancy_exceeds_capacity';
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = { name: f.name.trim(), capacity: Number(f.capacity), status: f.status, facilities: fac, location: locPayload(loc), ...(f.notes.trim() ? { accessibilityNotes: f.notes.trim() } : {}), contact: { ...(f.cname ? { name: f.cname } : {}), ...(f.cphone ? { phone: f.cphone } : {}) } };
      if (shelter) await patch(`/shelters/${shelter.id}`, body);
      else await post('/shelters', { ...body, occupancy: Number(f.occupancy) });
      onDone();
    } catch (x) { setErrors(fieldErrors(x, t)); setServerError(errorMessage(x, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open wide title={shelter ? t('shelter.edit') : t('shelter.create')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="sh-form" loading={busy}>{t('common.save')}</Button></>}>
      <form id="sh-form" onSubmit={submit} noValidate className="space-y-4">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('common.name')} required error={errors.name}>{(id) => <TextInput id={id} value={f.name} error={errors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('shelter.capacity')} required error={errors.capacity}>{(id) => <TextInput id={id} type="number" min={1} value={f.capacity} error={errors.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />}</Field>
          {!shelter && <Field label={t('shelter.occupancy')} error={errors.occupancy}>{(id) => <TextInput id={id} type="number" min={0} value={f.occupancy} error={errors.occupancy} onChange={(e) => setF({ ...f, occupancy: e.target.value })} />}</Field>}
          <Field label={t('common.status')}>{(id) => <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Shelter['status'] })}>{['open', 'full', 'closed'].map((s) => <option key={s} value={s}>{t(`shelterStatus.${s}`)}</option>)}</Select>}</Field>
        </div>
        {shelter && <Alert tone="info">{t('shelter.capacityNote')}</Alert>}
        <fieldset><legend className="label">{t('shelter.facilities')}</legend><MultiCheck options={FACILITIES} value={fac as (typeof FACILITIES)[number][]} onChange={setFac} labelFor={(o) => t(`facility.${o}`)} /></fieldset>
        <Field label={t('shelter.accessibility')}>{(id) => <TextArea id={id} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        <LocationPicker value={loc} onChange={setLoc} errors={errors} compact />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('shelter.contactName')}>{(id) => <TextInput id={id} value={f.cname} onChange={(e) => setF({ ...f, cname: e.target.value })} />}</Field>
          <Field label={t('common.phone')} error={errors.cphone}>{(id) => <TextInput id={id} type="tel" value={f.cphone} error={errors.cphone} onChange={(e) => setF({ ...f, cphone: e.target.value })} />}</Field>
        </div>
      </form>
    </Modal>
  );
}

function ReferModal({ shelter, onClose, onDone }: { shelter: Shelter; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const ems = useFetch(() => getPaged<Emergency>('/emergencies', { limit: 50 }), []);
  const [emId, setEmId] = useState('');
  const [people, setPeople] = useState('1');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const n = Number(people);
    if (!Number.isInteger(n) || n < 1) return setErr(t('validation.invalid_number'));
    setBusy(true);
    try { await post(`/shelters/${shelter.id}/referrals`, { people: n, ...(emId ? { emergencyId: emId } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); onDone(); } catch (x) { setErr(errorMessage(x, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`${t('shelter.refer')} — ${shelter.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={() => void go()}>{t('common.confirm')}</Button></>}>
      <div className="space-y-3">
        {err && <Alert tone="danger">{err}</Alert>}
        <Alert tone="info">{t('shelter.referNote', { available: shelter.available })}</Alert>
        <Field label={t('shelter.relatedEmergency')}>{(id) => <Select id={id} value={emId} onChange={(e) => setEmId(e.target.value)}><option value="">—</option>{ems.data?.data.map((e) => <option key={e.id} value={e.id}>{e.emergencyId} · {t(`emergencyType.${e.type}`)}</option>)}</Select>}</Field>
        <Field label={t('common.peopleCount')} required>{(id) => <TextInput id={id} type="number" min={1} value={people} onChange={(e) => setPeople(e.target.value)} />}</Field>
        <Field label={t('common.note')}>{(id) => <TextInput id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
