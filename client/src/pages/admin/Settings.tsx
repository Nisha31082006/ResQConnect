import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { get, put } from '../../services/api';
import { Alert, Button, Card, ErrorState, Field, PageHeader, Spinner, TextInput } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { collect, intBetween, phone as vPhone, translateErrors } from '../../utils/validate';
import type { AppSettings } from '../../types';

export default function AdminSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch(() => get<AppSettings>('/admin/settings'), []);
  const [f, setF] = useState({ ack: '', max: '', sms: '', radius: '', window: '', sim: '', crit: '', high: '', med: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setF({ ack: String(data.ackDeadlineSeconds), max: String(data.maxEscalationLevel), sms: data.smsEmergencyNumber, radius: String(data.duplicateRules.radiusMeters), window: String(data.duplicateRules.windowMinutes), sim: String(data.duplicateRules.similarityThreshold), crit: String(data.priority.thresholds.critical), high: String(data.priority.thresholds.high), med: String(data.priority.thresholds.medium) });
  }, [data]);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([
      ['ack', intBetween(f.ack, 10, 86400)], ['max', intBetween(f.max, 1, 5)], ['sms', vPhone(f.sms)], ['radius', intBetween(f.radius, 10, 20000)], ['window', intBetween(f.window, 5, 10080)],
      ['sim', Number(f.sim) >= 0 && Number(f.sim) <= 1 ? undefined : 'too_large'], ['crit', intBetween(f.crit, 1, 500)], ['high', intBetween(f.high, 1, 500)], ['med', intBetween(f.med, 1, 500)],
      ['crit', Number(f.crit) > Number(f.high) && Number(f.high) > Number(f.med) ? undefined : 'thresholds_order'],
    ]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError('');
    try {
      await put('/admin/settings', { ackDeadlineSeconds: Number(f.ack), maxEscalationLevel: Number(f.max), smsEmergencyNumber: f.sms, duplicateRules: { radiusMeters: Number(f.radius), windowMinutes: Number(f.window), similarityThreshold: Number(f.sim) }, priority: { thresholds: { critical: Number(f.crit), high: Number(f.high), medium: Number(f.med) } } });
      toast.success(t('common.saved'));
      await reload();
    } catch (x) { setErrors(fieldErrors(x, t)); setServerError(errorMessage(x, t)); } finally { setBusy(false); }
  };
  const num = (k: keyof typeof f, label: string, hint?: string) => <Field label={label} hint={hint} error={errors[k]} required>{(id, d) => <TextInput id={id} aria-describedby={d} inputMode="decimal" value={f[k]} error={errors[k]} onChange={set(k)} />}</Field>;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t('nav.settings')} subtitle={t('admin.settingsSubtitle')} />
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <form onSubmit={submit} noValidate className="space-y-4">
        <Card title={t('admin.settingsEscalation')}>
          <div className="grid gap-4 sm:grid-cols-2">{num('ack', t('admin.ackDeadline'), t('admin.ackDeadlineHint'))}{num('max', t('admin.maxLevel'))}</div>
        </Card>
        <Card title={t('admin.settingsSms')}>
          <Field label={t('admin.smsNumber')} required error={errors.sms} hint={t('admin.smsNumberHint')}>{(id, d) => <TextInput id={id} aria-describedby={d} type="tel" value={f.sms} error={errors.sms} onChange={set('sms')} />}</Field>
        </Card>
        <Card title={t('admin.settingsDuplicates')}>
          <div className="grid gap-4 sm:grid-cols-3">{num('radius', t('admin.dupRadius'))}{num('window', t('admin.dupWindow'))}{num('sim', t('admin.dupSimilarity'), t('admin.dupSimilarityHint'))}</div>
        </Card>
        <Card title={t('admin.settingsPriority')}>
          <p className="mb-3 text-xs text-ink-500">{t('admin.priorityThresholdHint')}</p>
          <div className="grid gap-4 sm:grid-cols-3">{num('crit', t('priority.critical'))}{num('high', t('priority.high'))}{num('med', t('priority.medium'))}</div>
        </Card>
        <Button type="submit" loading={busy}>{t('common.save')}</Button>
      </form>
    </div>
  );
}
