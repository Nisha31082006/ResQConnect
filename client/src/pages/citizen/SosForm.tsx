import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Checkbox, Field, PageHeader, Select, TextArea, TextInput, Card } from '../../components/ui';
import { FileInput } from '../../components/FormBits';
import { emptyLoc, locPayload, locValid, LocationPicker, type Loc } from '../../components/LocationPicker';
import { SmsFallbackCard } from '../../components/SmsFallbackCard';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { useToast } from '../../context/ToastContext';
import { EMERGENCY_TYPES, VULNERABLE } from '../../utils/enums';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { collect, intBetween, minLen, phone as vPhone, required, translateErrors } from '../../utils/validate';

/** One-screen SOS form: everything optional except what rescuers need immediately. */
export default function SosForm() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { online, submitReport } = useOffline();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ type: 'medical', description: '', affectedCount: '1', dangerToLife: true, name: user?.name ?? '', phone: user?.phone ?? '' });
  const [vul, setVul] = useState<string[]>([]);
  const [loc, setLoc] = useState<Loc>(emptyLoc);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);

  const smsProps = { type: f.type, people: Number(f.affectedCount) || 1, lat: locValid(loc) ? Number(loc.lat) : undefined, lng: locValid(loc) ? Number(loc.lng) : undefined, text: f.description.slice(0, 60) };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([
      ['type', required(f.type)],
      ['description', required(f.description) ?? minLen(f.description, 3)],
      ['affectedCount', intBetween(f.affectedCount, 1, 100000)],
      ['phone', f.phone ? vPhone(f.phone) : undefined],
      ['location.lat', locValid(loc) ? undefined : 'invalid_coordinates'],
    ]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError('');
    try {
      const payload = {
        type: f.type,
        description: f.description.trim(),
        affectedCount: Number(f.affectedCount),
        dangerToLife: f.dangerToLife,
        vulnerable: Object.fromEntries(VULNERABLE.map((v) => [v, vul.includes(v)])),
        contact: { ...(f.name ? { name: f.name } : {}), ...(f.phone ? { phone: f.phone } : {}) },
        location: locPayload(loc),
      };
      const r = await submitReport('sos', payload, files);
      if (r.queued) {
        setQueued(true);
        toast.info(t('offline.queuedToast'));
      } else {
        toast.success(t('citizen.sosSent', { id: r.emergencyId }));
        nav(`/citizen/requests/${r.id}`);
      }
    } catch (err) {
      setErrors(fieldErrors(err, t));
      setServerError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (queued)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title={t('offline.queuedTitle')} />
        <Alert tone="warn">{t('offline.queuedBody')}</Alert>
        <SmsFallbackCard {...smsProps} />
        <Button variant="secondary" onClick={() => nav('/citizen/requests')}>{t('citizen.myRequests')}</Button>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={`🆘 ${t('citizen.sosTitle')}`} subtitle={t('citizen.sosSubtitle')} />
      {!online && (
        <>
          <Alert tone="warn">{t('offline.formWarning')}</Alert>
          <SmsFallbackCard {...smsProps} />
        </>
      )}
      <form onSubmit={submit} noValidate className="card space-y-4 border-2 border-red-600 p-5">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('common.type')} required error={errors.type}>
          {(id) => (
            <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {EMERGENCY_TYPES.map((x) => <option key={x} value={x}>{t(`emergencyType.${x}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.shortDescription')} required error={errors.description}>
          {(id, d) => <TextArea id={id} aria-describedby={d} rows={3} maxLength={1000} value={f.description} error={errors.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.peopleAffected')} required error={errors.affectedCount}>
            {(id, d) => <TextInput id={id} aria-describedby={d} type="number" min={1} inputMode="numeric" value={f.affectedCount} error={errors.affectedCount} onChange={(e) => setF({ ...f, affectedCount: e.target.value })} />}
          </Field>
          <div className="flex items-end pb-2"><Checkbox label={t('citizen.dangerToLife')} checked={f.dangerToLife} onChange={(v) => setF({ ...f, dangerToLife: v })} /></div>
        </div>
        <fieldset>
          <legend className="label">{t('citizen.vulnerableTitle')}</legend>
          <div className="flex flex-wrap gap-4">
            {VULNERABLE.map((v) => <Checkbox key={v} label={t(`vulnerable.${v}`)} checked={vul.includes(v)} onChange={(c) => setVul(c ? [...vul, v] : vul.filter((x) => x !== v))} />)}
          </div>
        </fieldset>
        <LocationPicker value={loc} onChange={setLoc} errors={errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.name')} error={errors['contact.name']}>{(id) => <TextInput id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label={t('common.phone')} error={errors.phone ?? errors['contact.phone']}>{(id, d) => <TextInput id={id} aria-describedby={d} type="tel" value={f.phone} error={errors.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        </div>
        <Field label={t('common.attachments')}>{() => <FileInput files={files} onChange={setFiles} max={3} />}</Field>
        {!online && files.length > 0 && <Alert tone="warn">{t('offline.noAttachments')}</Alert>}
        <Button type="submit" loading={busy} className="w-full !bg-red-700 py-3 text-lg">🆘 {online ? t('citizen.sendSos') : t('offline.saveSos')}</Button>
      </form>
      <Card><p className="text-sm text-ink-700">{t('citizen.sosFooter')}</p></Card>
    </div>
  );
}
