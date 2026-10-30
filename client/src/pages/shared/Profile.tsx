import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { post } from '../../services/api';
import { Alert, Button, Card, Field, PageHeader, Select, TextInput } from '../../components/ui';
import { TagInput } from '../../components/FormBits';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { collect, minLen, password as vPassword, phone as vPhone, required, translateErrors } from '../../utils/validate';

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
