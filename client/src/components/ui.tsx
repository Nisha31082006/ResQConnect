import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { EmergencyStatus, PriorityLevel } from '../types';

export function Spinner({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-ink-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" aria-hidden />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

export const Skeleton = ({ className = 'h-4 w-full' }: { className?: string }) => <div className={`animate-pulse rounded bg-ink-200 ${className}`} aria-hidden />;
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 p-4" role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <div className="text-3xl" aria-hidden>🗂️</div>
      <p className="font-semibold text-ink-700">{title}</p>
      {hint && <p className="max-w-md text-sm text-ink-500">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-4 flex flex-col items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert">
      <span>⚠ {message}</span>
      {onRetry && (
        <button className="btn-secondary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
          {title && <h2 className="font-semibold text-ink-900">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, tone = 'default', hint, to }: { label: string; value: ReactNode; tone?: 'default' | 'danger' | 'warn' | 'ok'; hint?: string; to?: string }) {
  const tones = { default: 'border-ink-200', danger: 'border-red-600 bg-red-50', warn: 'border-amber-500 bg-amber-50', ok: 'border-green-600 bg-green-50' };
  const inner = (
    <div className={`rounded-xl border-l-4 border bg-white p-4 shadow-sm ${tones[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-ink-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/* ---------- badges: always icon + text, never colour alone ---------- */
const PRIORITY_STYLE: Record<PriorityLevel, { cls: string; icon: string }> = {
  critical: { cls: 'bg-red-700 text-white', icon: '▲▲▲' },
  high: { cls: 'bg-orange-600 text-white', icon: '▲▲' },
  medium: { cls: 'bg-amber-300 text-ink-900', icon: '▲' },
  low: { cls: 'bg-slate-200 text-ink-900', icon: '▽' },
};
export function PriorityBadge({ level, confirmed }: { level: PriorityLevel; confirmed?: boolean }) {
  const { t } = useTranslation();
  const s = PRIORITY_STYLE[level];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold ${s.cls}`} title={confirmed === false ? t('priority.unconfirmedHint') : undefined}>
      <span aria-hidden className="text-[10px]">{s.icon}</span>
      {t(`priority.${level}`)}
      {confirmed === false && <span className="font-normal opacity-90">· {t('priority.recommendedShort')}</span>}
    </span>
  );
}

const STATUS_STYLE: Record<EmergencyStatus, string> = {
  pending: 'bg-red-100 text-red-900 border-red-300',
  acknowledged: 'bg-amber-100 text-amber-900 border-amber-300',
  assigned: 'bg-blue-100 text-blue-900 border-blue-300',
  in_progress: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  completion_submitted: 'bg-purple-100 text-purple-900 border-purple-300',
  admin_verification: 'bg-fuchsia-100 text-fuchsia-900 border-fuchsia-300',
  resolved: 'bg-green-100 text-green-900 border-green-300',
};
const STATUS_ICON: Record<EmergencyStatus, string> = { pending: '⏳', acknowledged: '👁', assigned: '👥', in_progress: '🚧', completion_submitted: '📝', admin_verification: '🔍', resolved: '✔' };
export function StatusBadge({ status }: { status: EmergencyStatus }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      <span aria-hidden>{STATUS_ICON[status]}</span>
      {t(`status.${status}`)}
    </span>
  );
}

export function KindBadge({ kind }: { kind: 'normal' | 'sos' }) {
  const { t } = useTranslation();
  return kind === 'sos' ? (
    <span className="inline-flex items-center gap-1 rounded bg-red-700 px-2 py-0.5 text-xs font-extrabold tracking-wider text-white">🆘 {t('kind.sos')}</span>
  ) : (
    <span className="inline-flex items-center rounded border border-ink-300 bg-white px-2 py-0.5 text-xs font-semibold text-ink-700">{t('kind.normal')}</span>
  );
}

const TONES = { gray: 'bg-slate-100 text-slate-800 border-slate-300', green: 'bg-green-100 text-green-900 border-green-300', red: 'bg-red-100 text-red-900 border-red-300', amber: 'bg-amber-100 text-amber-900 border-amber-300', blue: 'bg-blue-100 text-blue-900 border-blue-300' };
export const Badge = ({ tone = 'gray', children }: { tone?: keyof typeof TONES; children: ReactNode }) => (
  <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>
);

/* ---------- form controls ---------- */
interface FieldProps { label: string; error?: string; hint?: string; required?: boolean; children: (id: string, describedBy?: string) => ReactNode }
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const { t } = useTranslation();
  const desc = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required ? <span className="text-red-700" aria-hidden> *</span> : <span className="ml-1 text-xs font-normal text-ink-500">({t('common.optional')})</span>}
      </label>
      {children(id, desc)}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-red-700" role="alert">⚠ {error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}
export const TextInput = ({ error, className = '', ...p }: InputHTMLAttributes<HTMLInputElement> & { error?: string }) => (
  <input {...p} aria-invalid={!!error} className={`input ${error ? 'input-error' : ''} ${className}`} />
);
export const TextArea = ({ error, className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) => (
  <textarea {...p} aria-invalid={!!error} className={`input ${error ? 'input-error' : ''} ${className}`} />
);
export const Select = ({ error, className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) => (
  <select {...p} aria-invalid={!!error} className={`input ${error ? 'input-error' : ''} ${className}`}>
    {children}
  </select>
);

export function Checkbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-red-700" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Button({ variant = 'primary', loading, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean }) {
  const cls = { primary: 'btn-primary', secondary: 'btn-secondary', danger: 'btn-danger', ghost: 'btn-ghost' }[variant];
  return (
    <button {...p} disabled={p.disabled || loading} className={`${cls} ${p.className ?? ''}`}>
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- modal / confirm ---------- */
export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <header className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </header>
        <div className="p-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-ink-200 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel, loading, danger, children }: { open: boolean; title: string; message?: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; loading?: boolean; danger?: boolean; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel ?? t('common.confirm')}</Button>
        </>
      }
    >
      {message && <p className="mb-3 text-sm text-ink-700">{message}</p>}
      {children}
    </Modal>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  if (total === 0) return null;
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-200 px-4 py-3 text-sm" aria-label={t('common.pagination')}>
      <span className="text-ink-500">{t('common.resultsCount', { count: total })}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ {t('common.previous')}</Button>
        <span>{t('common.pageOf', { page, pages })}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('common.next')} ›</Button>
      </div>
    </nav>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  const cls = { info: 'border-blue-300 bg-blue-50 text-blue-900', warn: 'border-amber-400 bg-amber-50 text-amber-900', danger: 'border-red-400 bg-red-50 text-red-900', ok: 'border-green-400 bg-green-50 text-green-900' }[tone];
  const icon = { info: 'ℹ', warn: '⚠', danger: '⛔', ok: '✔' }[tone];
  return (
    <div className={`flex gap-2 rounded-lg border p-3 text-sm ${cls}`} role={tone === 'danger' ? 'alert' : 'note'}>
      <span aria-hidden>{icon}</span>
      <div>{children}</div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-ink-200">
        <thead className="bg-ink-50">
          <tr>{head.map((h, i) => <th key={i} scope="col" className="th">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100 bg-white">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}
