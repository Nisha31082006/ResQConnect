import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Checkbox, Field, PageHeader, Select, TextArea, TextInput } from '../../components/ui';
import { FileInput, MultiCheck } from '../../components/FormBits';
import { emptyLoc, locPayload, locValid, LocationPicker, type Loc } from '../../components/LocationPicker';
import { SmsFallbackCard } from '../../components/SmsFallbackCard';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { useToast } from '../../context/ToastContext';
import { ASSISTANCE, EMERGENCY_TYPES, SEVERITIES, VULNERABLE } from '../../utils/enums';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { toLocalInput } from '../../utils/format';
import { collect, intBetween, minLen, phone as vPhone, required, translateErrors } from '../../utils/validate';

export default function ReportForm() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { online, submitReport } = useOffline();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ type: 'flood', description: '', affectedCount: '1', severity: 'medium', dangerToLife: false, name: user?.name ?? '', phone: user?.phone ?? '', occurredAt: toLocalInput() });
  const [vul, setVul] = useState<string[]>([]);
  const [needs, setNeeds] = useState<string[]>([]);
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
      ['description', required(f.description) ?? minLen(f.description, 10)],
      ['affectedCount', intBetween(f.affectedCount, 1, 100000)],
      ['phone', f.phone ? vPhone(f.phone) : !f.name.trim() ? 'contact_required' : undefined],
      ['occurredAt', new Date(f.occurredAt).getTime() > Date.now() + 5 * 60000 ? 'date_in_future' : undefined],
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
        severity: f.severity,
        dangerToLife: f.dangerToLife,
        vulnerable: Object.fromEntries(VULNERABLE.map((v) => [v, vul.includes(v)])),
        assistanceNeeds: needs,
        contact: { ...(f.name ? { name: f.name } : {}), ...(f.phone ? { phone: f.phone } : {}) },
        location: locPayload(loc),
        occurredAt: new Date(f.occurredAt).toISOString(),
      };
      const r = await submitReport('report', payload, files);
      if (r.queued) {
        setQueued(true);
        toast.info(t('offline.queuedToast'));
      } else {
        toast.success(t('citizen.reportSent', { id: r.emergencyId }));
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
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t('citizen.reportTitle')} subtitle={t('citizen.reportSubtitle')} />
      {!online && (
        <>
          <Alert tone="warn">{t('offline.formWarning')}</Alert>
          <SmsFallbackCard {...smsProps} />
        </>
      )}
      <form onSubmit={submit} noValidate className="card space-y-4 p-5">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.type')} required error={errors.type}>
            {(id) => <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{EMERGENCY_TYPES.map((x) => <option key={x} value={x}>{t(`emergencyType.${x}`)}</option>)}</Select>}
          </Field>
          <Field label={t('citizen.severity')} required>
            {(id) => <Select id={id} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{SEVERITIES.map((x) => <option key={x} value={x}>{t(`severity.${x}`)}</option>)}</Select>}
          </Field>
        </div>
        <Field label={t('citizen.description')} required error={errors.description} hint={t('citizen.descriptionHint')}>
          {(id, d) => <TextArea id={id} aria-describedby={d} rows={4} maxLength={4000} value={f.description} error={errors.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.peopleAffected')} required error={errors.affectedCount}>
            {(id, d) => <TextInput id={id} aria-describedby={d} type="number" min={1} inputMode="numeric" value={f.affectedCount} error={errors.affectedCount} onChange={(e) => setF({ ...f, affectedCount: e.target.value })} />}
          </Field>
          <Field label={t('citizen.occurredAt')} error={errors.occurredAt}>
            {(id, d) => <TextInput id={id} aria-describedby={d} type="datetime-local" max={toLocalInput()} value={f.occurredAt} error={errors.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} />}
          </Field>
        </div>
        <Checkbox label={t('citizen.dangerToLife')} checked={f.dangerToLife} onChange={(v) => setF({ ...f, dangerToLife: v })} />
        <fieldset><legend className="label">{t('citizen.vulnerableTitle')}</legend><MultiCheck options={VULNERABLE} value={vul as (typeof VULNERABLE)[number][]} onChange={setVul} labelFor={(o) => t(`vulnerable.${o}`)} /></fieldset>
        <fieldset><legend className="label">{t('citizen.assistanceTitle')}</legend><MultiCheck options={ASSISTANCE} value={needs as (typeof ASSISTANCE)[number][]} onChange={setNeeds} labelFor={(o) => t(`assistance.${o}`)} /></fieldset>
        <LocationPicker value={loc} onChange={setLoc} errors={errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('common.name')}>{(id) => <TextInput id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label={t('common.phone')} error={errors.phone ?? errors['contact.phone']}>{(id, d) => <TextInput id={id} aria-describedby={d} type="tel" value={f.phone} error={errors.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        </div>
        <Field label={t('common.attachments')}>{() => <FileInput files={files} onChange={setFiles} />}</Field>
        {!online && files.length > 0 && <Alert tone="warn">{t('offline.noAttachments')}</Alert>}
        <Button type="submit" loading={busy} className="w-full">{online ? t('citizen.submitReport') : t('offline.saveReport')}</Button>
      </form>
    </div>
  );
}
