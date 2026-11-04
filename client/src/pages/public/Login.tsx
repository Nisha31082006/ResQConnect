import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { Alert, Button, Field, TextInput } from '../../components/ui';
import { errorMessage } from '../../utils/errors';
import { collect, email as vEmail, required, translateErrors } from '../../utils/validate';
import { homePathFor } from '../../utils/format';

const DEMO = [
  ['admin@resqconnect.test', 'admin'],
  ['citizen@resqconnect.test', 'citizen'],
  ['leader@resqconnect.test', 'team_leader'],
  ['volunteer@resqconnect.test', 'volunteer'],
  ['food@resqconnect.test', 'food_provider'],
  ['shelter@resqconnect.test', 'shelter_coordinator'],
] as const;

export default function Login() {
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([
      ['email', required(form.email) ?? vEmail(form.email)],
      ['password', required(form.password)],
    ]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError('');
    try {
      const u = await login(form.email.trim(), form.password);
      const from = (loc.state as { from?: string } | null)?.from;
      nav(from && from !== '/login' ? from : homePathFor(u.role), { replace: true });
    } catch (err) {
      setServerError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">{t('auth.loginTitle')}</h1>
      <form className="card space-y-4 p-5" onSubmit={submit} noValidate>
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('common.email')} required error={errors.email}>
          {(id, d) => <TextInput id={id} aria-describedby={d} type="email" autoComplete="username" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label={t('common.password')} required error={errors.password}>
          {(id, d) => <TextInput id={id} aria-describedby={d} type="password" autoComplete="current-password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <Button type="submit" loading={busy} className="w-full">{t('nav.login')}</Button>
        <p className="text-center text-sm">{t('auth.noAccount')} <Link className="font-semibold text-blue-700 underline" to="/register">{t('nav.register')}</Link></p>
      </form>
      <details className="card mt-4 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">{t('auth.demoTitle')}</summary>
        <p className="mt-2 text-ink-500">{t('auth.demoHint')}</p>
        <ul className="mt-2 space-y-1">
          {DEMO.map(([em, role]) => (
            <li key={em}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-ink-100" onClick={() => setForm({ email: em, password: 'Demo@1234' })}>
                <span className="font-semibold">{t(`role.${role}`)}</span> — {em}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
