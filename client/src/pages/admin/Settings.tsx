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
  const [f, setF] = useState({ ack: '', max: '', sms: '', radius: '', window: '', sim: '', crit: '', high: '', med: '', zRadius: '', zWindow: '', zMin: '', zSame: 'false', overload: '', teamKm: '', shKm: '', shFull: '', meals: '', days: '', fuEm: '', fuProg: '', fuSh: '', fuRepeat: '', fuMax: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setF({ ack: String(data.ackDeadlineSeconds), max: String(data.maxEscalationLevel), sms: data.smsEmergencyNumber, radius: String(data.duplicateRules.radiusMeters), window: String(data.duplicateRules.windowMinutes), sim: String(data.duplicateRules.similarityThreshold), crit: String(data.priority.thresholds.critical), high: String(data.priority.thresholds.high), med: String(data.priority.thresholds.medium), zRadius: String(data.automation.zones.radiusMeters), zWindow: String(data.automation.zones.windowMinutes), zMin: String(data.automation.zones.minReports), zSame: String(data.automation.zones.sameTypeOnly), overload: String(data.automation.workload.overloadedAt), teamKm: String(data.automation.teamFormation.maxDistanceKm), shKm: String(data.automation.shelter.maxDistanceKm), shFull: String(data.automation.shelter.nearFullPercent), meals: String(data.automation.food.mealsPerPersonPerDay), days: String(data.automation.food.days), fuEm: String(data.automation.followUp.emergencyIdleMinutes), fuProg: String(data.automation.followUp.progressIdleMinutes), fuSh: String(data.automation.followUp.shelterStaleMinutes), fuRepeat: String(data.automation.followUp.repeatMinutes), fuMax: String(data.automation.followUp.maxReminders) });
  }, [data]);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={errorMessage(error, t)} onRetry={() => void reload()} />;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([
      ['ack', intBetween(f.ack, 10, 86400)], ['max', intBetween(f.max, 1, 5)], ['sms', vPhone(f.sms)], ['radius', intBetween(f.radius, 10, 20000)], ['window', intBetween(f.window, 5, 10080)],
      ['sim', Number(f.sim) >= 0 && Number(f.sim) <= 1 ? undefined : 'too_large'], ['crit', intBetween(f.crit, 1, 500)], ['high', intBetween(f.high, 1, 500)], ['med', intBetween(f.med, 1, 500)],
      ['zRadius', intBetween(f.zRadius, 50, 50000)], ['zWindow', intBetween(f.zWindow, 5, 10080)], ['zMin', intBetween(f.zMin, 2, 100)], ['overload', intBetween(f.overload, 1, 50)], ['teamKm', intBetween(f.teamKm, 1, 2000)], ['shKm', intBetween(f.shKm, 1, 2000)], ['shFull', intBetween(f.shFull, 50, 100)],
      ['meals', intBetween(f.meals, 1, 10)], ['days', intBetween(f.days, 1, 30)], ['fuEm', intBetween(f.fuEm, 1, 10080)], ['fuProg', intBetween(f.fuProg, 1, 10080)], ['fuSh', intBetween(f.fuSh, 1, 20160)], ['fuRepeat', intBetween(f.fuRepeat, 1, 10080)], ['fuMax', intBetween(f.fuMax, 1, 50)],
      ['crit', Number(f.crit) > Number(f.high) && Number(f.high) > Number(f.med) ? undefined : 'thresholds_order'],
    ]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError('');
    try {
      await put('/admin/settings', { ackDeadlineSeconds: Number(f.ack), maxEscalationLevel: Number(f.max), smsEmergencyNumber: f.sms, duplicateRules: { radiusMeters: Number(f.radius), windowMinutes: Number(f.window), similarityThreshold: Number(f.sim) }, priority: { thresholds: { critical: Number(f.crit), high: Number(f.high), medium: Number(f.med) } },
        automation: { zones: { radiusMeters: Number(f.zRadius), windowMinutes: Number(f.zWindow), minReports: Number(f.zMin), sameTypeOnly: f.zSame === 'true' }, workload: { overloadedAt: Number(f.overload) }, teamFormation: { maxDistanceKm: Number(f.teamKm) }, shelter: { maxDistanceKm: Number(f.shKm), nearFullPercent: Number(f.shFull) }, food: { mealsPerPersonPerDay: Number(f.meals), days: Number(f.days) }, followUp: { emergencyIdleMinutes: Number(f.fuEm), progressIdleMinutes: Number(f.fuProg), shelterStaleMinutes: Number(f.fuSh), repeatMinutes: Number(f.fuRepeat), maxReminders: Number(f.fuMax) } } });
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
        <Card title={t('automation.settings.zones')}>
          <p className="mb-3 text-xs text-ink-500">{t('automation.settings.zonesHint')}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {num('zRadius', t('automation.settings.zoneRadius'))}{num('zWindow', t('automation.settings.zoneWindow'))}{num('zMin', t('automation.settings.zoneMin'))}
            <Field label={t('automation.settings.zoneSameType')}>{(id) => <select id={id} className="input" value={f.zSame} onChange={set('zSame')}><option value="false">{t('common.no')}</option><option value="true">{t('common.yes')}</option></select>}</Field>
          </div>
        </Card>
        <Card title={t('automation.settings.limits')}>
          <div className="grid gap-4 sm:grid-cols-3">
            {num('overload', t('automation.settings.overloadedAt'), t('automation.settings.overloadedAtHint'))}{num('teamKm', t('automation.settings.teamKm'))}{num('shKm', t('automation.settings.shelterKm'))}
            {num('shFull', t('automation.settings.nearFull'))}{num('meals', t('automation.settings.meals'), t('automation.settings.mealsHint'))}{num('days', t('automation.settings.days'))}
          </div>
        </Card>
        <Card title={t('automation.settings.followUps')}>
          <div className="grid gap-4 sm:grid-cols-3">
            {num('fuEm', t('automation.settings.fuEmergency'))}{num('fuProg', t('automation.settings.fuProgress'))}{num('fuSh', t('automation.settings.fuShelter'))}
            {num('fuRepeat', t('automation.settings.fuRepeat'))}{num('fuMax', t('automation.settings.fuMax'))}
          </div>
        </Card>
        <Button type="submit" loading={busy}>{t('common.save')}</Button>
      </form>
    </div>
  );
}
