import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { Alert, Button, Field, Select, TextInput } from '../../components/ui';
import { TagInput } from '../../components/FormBits';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { collect, email as vEmail, minLen, password as vPassword, phone as vPhone, required, translateErrors } from '../../utils/validate';
import { homePathFor } from '../../utils/format';
import i18n from '../../i18n';

const ROLES = ['citizen', 'volunteer', 'food_provider', 'shelter_coordinator'] as const;

export default function Register() {
  const { t } = useTranslation();
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', role: 'citizen' as (typeof ROLES)[number], skills: [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePathFor(user.role)} replace />;
  if (pending)
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <Alert tone="ok">{t('auth.pendingApproval')}</Alert>
        <Link to="/login" className="btn-primary mt-4">{t('nav.login')}</Link>
      </div>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([
      ['name', required(f.name) ?? minLen(f.name, 2)],
      ['email', required(f.email) ?? vEmail(f.email)],
      ['phone', f.phone ? vPhone(f.phone) : undefined],
      ['password', required(f.password) ?? vPassword(f.password)],
    ]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError('');
    try {
      const r = await register({ name: f.name, email: f.email, phone: f.phone || undefined, password: f.password, role: f.role, preferredLanguage: i18n.language.startsWith('ta') ? 'ta' : 'en', skills: f.role === 'volunteer' ? f.skills : undefined });
      if (r.pendingApproval) setPending(true);
      else nav(homePathFor(r.user.role), { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err, t));
      setServerError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">{t('auth.registerTitle')}</h1>
      <form className="card space-y-4 p-5" onSubmit={submit} noValidate>
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('common.name')} required error={errors.name}>{(id, d) => <TextInput id={id} aria-describedby={d} autoComplete="name" value={f.name} error={errors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label={t('common.email')} required error={errors.email}>{(id, d) => <TextInput id={id} aria-describedby={d} type="email" autoComplete="email" value={f.email} error={errors.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label={t('common.phone')} error={errors.phone}>{(id, d) => <TextInput id={id} aria-describedby={d} type="tel" autoComplete="tel" value={f.phone} error={errors.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label={t('common.password')} required error={errors.password} hint={t('auth.passwordHint')}>{(id, d) => <TextInput id={id} aria-describedby={d} type="password" autoComplete="new-password" value={f.password} error={errors.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        <Field label={t('auth.registerAs')} required hint={f.role === 'citizen' ? undefined : t('auth.approvalNeeded')}>
          {(id) => (
            <Select id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as (typeof ROLES)[number] })}>
              {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
            </Select>
          )}
        </Field>
        {f.role === 'volunteer' && <Field label={t('common.skills')} hint={t('auth.skillsHint')}>{() => <TagInput value={f.skills} onChange={(skills) => setF({ ...f, skills })} />}</Field>}
        <Button type="submit" loading={busy} className="w-full">{t('nav.register')}</Button>
        <p className="text-center text-sm">{t('auth.haveAccount')} <Link className="font-semibold text-blue-700 underline" to="/login">{t('nav.login')}</Link></p>
      </form>
    </div>
  );
}
