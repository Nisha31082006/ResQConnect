import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { patch, post } from '../../services/api';
import { Alert, Badge, Button, Card, ErrorState, Field, Modal, PageHeader, Pagination, Select, SkeletonRows, Table, TextInput } from '../../components/ui';
import { TagInput } from '../../components/FormBits';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { usePagedList } from '../../hooks/usePagedList';
import { ROLES } from '../../utils/enums';
import { errorMessage, fieldErrors } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import { collect, email as vEmail, password as vPassword, phone as vPhone, required, translateErrors } from '../../utils/validate';
import type { User } from '../../types';

export default function AdminUsers() {
  const { t, i18n } = useTranslation();
  const { user: me } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const list = usePagedList<User>('/users', { ...(role ? { role } : {}), ...(status ? { status } : {}) });
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState('');
  const update = async (u: User, body: Record<string, unknown>) => {
    setBusy(u.id);
    try { await patch(`/users/${u.id}`, body); toast.success(t('common.saved')); await list.reload(); } catch (x) { toast.error(errorMessage(x, t)); } finally { setBusy(''); }
  };
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.users')} subtitle={t('admin.usersSubtitle')} actions={<Button onClick={() => setCreate(true)}>＋ {t('admin.createUser')}</Button>} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-3">
          <TextInput aria-label={t('common.search')} placeholder={t('admin.searchUsers')} className="max-w-xs" value={list.search} onChange={(e) => list.setSearch(e.target.value)} />
          <Select aria-label={t('common.role')} className="max-w-48" value={role} onChange={(e) => setRole(e.target.value)}><option value="">{t('common.role')}</option>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</Select>
          <Select aria-label={t('common.status')} className="max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('common.status')}</option>{['active', 'pending', 'suspended'].map((s) => <option key={s} value={s}>{t(`admin.userStatus.${s}`)}</option>)}</Select>
        </div>
        {list.loading ? <SkeletonRows /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : (
          <Table head={[t('common.name'), t('common.email'), t('common.role'), t('common.status'), t('admin.joined'), '']}>
            {list.items.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.name}</td>
                <td className="td text-xs">{u.email}</td>
                <td className="td">
                  <Select aria-label={t('common.role')} className="!py-1 text-xs" value={u.role} disabled={u.id === me?.id || busy === u.id} onChange={(e) => void update(u, { role: e.target.value })}>
                    {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                  </Select>
                </td>
                <td className="td"><Badge tone={u.status === 'active' ? 'green' : u.status === 'pending' ? 'amber' : 'red'}>{t(`admin.userStatus.${u.status}`)}</Badge></td>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(u.createdAt, i18n.language)}</td>
                <td className="td whitespace-nowrap">
                  {u.status === 'pending' && <Button loading={busy === u.id} onClick={() => void update(u, { status: 'active' })}>{t('admin.approve')}</Button>}
                  {u.status === 'active' && u.id !== me?.id && <Button variant="danger" loading={busy === u.id} onClick={() => void update(u, { status: 'suspended' })}>{t('admin.suspend')}</Button>}
                  {u.status === 'suspended' && <Button variant="secondary" loading={busy === u.id} onClick={() => void update(u, { status: 'active' })}>{t('admin.reactivate')}</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      </Card>
      {create && <CreateUser onClose={() => setCreate(false)} onDone={() => { setCreate(false); toast.success(t('common.saved')); void list.reload(); }} />}
    </div>
  );
}

function CreateUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', role: 'volunteer' });
  const [skills, setSkills] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = collect([['name', required(f.name)], ['email', required(f.email) ?? vEmail(f.email)], ['password', vPassword(f.password)], ['phone', f.phone ? vPhone(f.phone) : undefined]]);
    setErrors(translateErrors(errs, t));
    if (Object.keys(errs).length) return;
    setBusy(true);
    try { await post('/users', { ...f, name: f.name.trim(), email: f.email.trim(), phone: f.phone || undefined, skills }); onDone(); } catch (x) { setErrors(fieldErrors(x, t)); setServerError(errorMessage(x, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open title={t('admin.createUser')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="user-form" loading={busy}>{t('common.save')}</Button></>}>
      <form id="user-form" onSubmit={submit} noValidate className="space-y-3">
        {serverError && <Alert tone="danger">{serverError}</Alert>}
        <Field label={t('common.name')} required error={errors.name}>{(id) => <TextInput id={id} value={f.name} error={errors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label={t('common.email')} required error={errors.email}>{(id) => <TextInput id={id} type="email" value={f.email} error={errors.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label={t('common.password')} required error={errors.password}>{(id) => <TextInput id={id} type="password" autoComplete="new-password" value={f.password} error={errors.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        <Field label={t('common.phone')} error={errors.phone}>{(id) => <TextInput id={id} type="tel" value={f.phone} error={errors.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label={t('common.role')} required>{(id) => <Select id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</Select>}</Field>
        <Field label={t('common.skills')}>{() => <TagInput value={skills} onChange={setSkills} />}</Field>
      </form>
    </Modal>
  );
}
