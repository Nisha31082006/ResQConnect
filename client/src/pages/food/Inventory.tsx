import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { get, patch, post } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Select, SkeletonRows, Table, TextInput } from '../../components/ui';
import { emptyLoc, locPayload, locValid, LocationPicker, type Loc } from '../../components/LocationPicker';
import { useToast } from '../../context/ToastContext';
import { useFetch } from '../../hooks/useFetch';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { formatDateTime, toLocalInput } from '../../utils/format';
import { collect, intBetween, minLen, required, translateErrors } from '../../utils/validate';
import type { FoodProvider, FoodSupply } from '../../types';

/** Provider profile + supply inventory. Quantity can never be lowered below what has already been allocated (API-enforced). */
export default function FoodInventory({ admin = false }: { admin?: boolean }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const prov = useFetch(() => (admin ? get<FoodProvider[]>('/food/providers').then((p) => p[0] ?? null) : get<FoodProvider | null>('/food/providers/me')), [admin]);
  const supplies = useFetch(() => get<(FoodSupply & { providerName?: string })[]>('/food/supplies'), []);
  const [editProv, setEditProv] = useState(false);
  const [editSupply, setEditSupply] = useState<FoodSupply | 'new' | null>(null);
  const reload = () => { void prov.reload(); void supplies.reload(); };
  return (
    <div className="space-y-4">
      <PageHeader title={admin ? t('nav.food') : t('nav.inventory')} actions={prov.data || admin ? <Button onClick={() => setEditSupply('new')}>＋ {t('food.addSupply')}</Button> : undefined} />
      {!admin && (
        <Card title={t('food.profile')} actions={<Button variant="secondary" onClick={() => setEditProv(true)}>{prov.data ? t('common.edit') : t('food.createProfile')}</Button>}>
          {prov.loading ? <SkeletonRows rows={2} /> : prov.data ? <div className="text-sm"><p className="font-semibold">{prov.data.name}</p><p>{prov.data.location?.address}</p><p className="text-ink-500">{prov.data.operatingHours}</p></div> : <Alert tone="warn">{t('food.noProfile')}</Alert>}
        </Card>
      )}
      <Card title={t('food.supplies')}>
        {supplies.loading ? <SkeletonRows /> : supplies.error ? <ErrorState message={errorMessage(supplies.error, t)} onRetry={() => void supplies.reload()} /> : !supplies.data?.length ? <EmptyState title={t('food.noSupplies')} /> : (
          <Table head={[...(admin ? [t('food.provider')] : []), t('food.foodType'), t('food.total'), t('food.availableLabel'), t('food.until'), t('common.status'), '']}>
            {supplies.data.map((s) => (
              <tr key={s.id}>
                {admin && <td className="td">{s.providerName}</td>}
                <td className="td font-medium">{s.foodType}</td>
                <td className="td">{s.quantityTotal} {t(`food.unit.${s.unit}`)}</td>
                <td className="td"><strong>{s.quantityAvailable}</strong> <span className="text-xs text-ink-500">({t('food.allocated', { count: s.quantityTotal - s.quantityAvailable })})</span></td>
                <td className="td text-xs">{s.availableUntil ? formatDateTime(s.availableUntil, i18n.language) : '—'}</td>
                <td className="td"><Badge tone={s.active ? 'green' : 'gray'}>{s.active ? t('common.active') : t('common.inactive')}</Badge></td>
                <td className="td"><Button variant="secondary" onClick={() => setEditSupply(s)}>{t('common.edit')}</Button></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editProv && <ProviderForm p={prov.data} onClose={() => setEditProv(false)} onDone={() => { setEditProv(false); toast.success(t('common.saved')); reload(); }} />}
      {editSupply && <SupplyForm s={editSupply === 'new' ? null : editSupply} onClose={() => setEditSupply(null)} onDone={() => { setEditSupply(null); toast.success(t('common.saved')); reload(); }} />}
    </div>
  );
}

function ProviderForm({ p, onClose, onDone }: { p: FoodProvider | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: p?.name ?? '', description: p?.description ?? '', hours: p?.operatingHours ?? '', cname: p?.contact.name ?? '', cphone: p?.contact.phone ?? '' });
  const [loc, setLoc] = useState<Loc>(p?.location ? { lat: p.location.lat, lng: p.location.lng, address: p.location.address ?? '' } : emptyLoc);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([['name', required(f.name) ?? minLen(f.name, 2)], ['hours', required(f.hours)], ['location.lat', locValid(loc) ? undefined : 'invalid_coordinates']]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = { name: f.name.trim(), operatingHours: f.hours.trim(), location: locPayload(loc), ...(f.description.trim() ? { description: f.description.trim() } : {}), contact: { ...(f.cname ? { name: f.cname } : {}), ...(f.cphone ? { phone: f.cphone } : {}) } };
      if (p) await patch(`/food/providers/${p.id}`, body); else await post('/food/providers', body);
      onDone();
    } catch (x) { setErrors(fieldErrors(x, t)); setServerError(errorMessage(x, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open wide title={t('food.profile')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="pf" loading={busy}>{t('common.save')}</Button></>}>
      <form id="pf" onSubmit={submit} noValidate className="space-y-4">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('common.name')} required error={errors.name}>{(id) => <TextInput id={id} value={f.name} error={errors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label={t('food.hours')} required error={errors.hours}>{(id) => <TextInput id={id} value={f.hours} error={errors.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />}</Field>
        <Field label={t('citizen.description')}>{(id) => <TextInput id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <LocationPicker value={loc} onChange={setLoc} errors={errors} compact />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('shelter.contactName')}>{(id) => <TextInput id={id} value={f.cname} onChange={(e) => setF({ ...f, cname: e.target.value })} />}</Field>
          <Field label={t('common.phone')}>{(id) => <TextInput id={id} type="tel" value={f.cphone} onChange={(e) => setF({ ...f, cphone: e.target.value })} />}</Field>
        </div>
      </form>
    </Modal>
  );
}

function SupplyForm({ s, onClose, onDone }: { s: FoodSupply | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ foodType: s?.foodType ?? '', unit: s?.unit ?? 'meals', total: String(s?.quantityTotal ?? ''), until: s?.availableUntil ? toLocalInput(new Date(s.availableUntil)) : '', active: s?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([['foodType', required(f.foodType) ?? minLen(f.foodType, 2)], ['total', intBetween(f.total, 0, 10000000)]]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const until = f.until ? { availableUntil: new Date(f.until).toISOString() } : {};
      if (s) await patch(`/food/supplies/${s.id}`, { foodType: f.foodType.trim(), quantityTotal: Number(f.total), active: f.active, ...until });
      else await post('/food/supplies', { foodType: f.foodType.trim(), unit: f.unit, quantityTotal: Number(f.total), ...until });
      onDone();
    } catch (x) { setErrors(fieldErrors(x, t)); setServerError(errorMessage(x, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={s ? t('food.editSupply') : t('food.addSupply')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="sf" loading={busy}>{t('common.save')}</Button></>}>
      <form id="sf" onSubmit={submit} noValidate className="space-y-3">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('food.foodType')} required error={errors.foodType}>{(id) => <TextInput id={id} value={f.foodType} error={errors.foodType} onChange={(e) => setF({ ...f, foodType: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('food.total')} required error={errors.total}>{(id) => <TextInput id={id} type="number" min={0} value={f.total} error={errors.total} onChange={(e) => setF({ ...f, total: e.target.value })} />}</Field>
          <Field label={t('food.unitLabel')}>{(id) => <Select id={id} disabled={!!s} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as 'meals' | 'packages' })}>{['meals', 'packages'].map((u) => <option key={u} value={u}>{t(`food.unit.${u}`)}</option>)}</Select>}</Field>
        </div>
        <Field label={t('food.until')}>{(id) => <TextInput id={id} type="datetime-local" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} />}</Field>
        {s && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t('common.active')}</label>}
      </form>
    </Modal>
  );
}
