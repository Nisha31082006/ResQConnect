import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox } from './ui';

export function FileInput({ files, onChange, max = 5, label }: { files: File[]; onChange: (f: File[]) => void; max?: number; label?: string }) {
  const { t } = useTranslation();
  const [err, setErr] = useState('');
  const pick = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, max);
    const bad = next.find((f) => !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type) || f.size > 5 * 1024 * 1024);
    if (bad) return setErr(t('validation.file_invalid', { name: bad.name }));
    setErr('');
    onChange(next);
  };
  return (
    <div>
      <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple aria-label={label ?? t('common.attachments')} onChange={(e) => { pick(e.target.files); e.target.value = ''; }} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:font-semibold" />
      <p className="mt-1 text-xs text-ink-500">{t('common.fileHint', { max })}</p>
      {err && <p className="mt-1 text-xs font-medium text-red-700" role="alert">⚠ {err}</p>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between rounded bg-ink-100 px-2 py-1">
              <span className="truncate">{f.name}</span>
              <Button type="button" variant="ghost" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={t('common.remove')}>✕</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MultiCheck<T extends string>({ options, value, onChange, labelFor }: { options: readonly T[]; value: T[]; onChange: (v: T[]) => void; labelFor: (o: T) => string }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <Checkbox key={o} label={labelFor(o)} checked={value.includes(o)} onChange={(c) => onChange(c ? [...value, o] : value.filter((x) => x !== o))} />
      ))}
    </div>
  );
}

export function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim().toLowerCase();
    if (v && !value.includes(v)) onChange([...value, v]);
    setText('');
  };
  return (
    <div>
      <div className="flex gap-2">
        <input className="input" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button type="button" variant="secondary" onClick={add}>{t('common.add')}</Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs">
            {v}
            <button type="button" aria-label={`${t('common.remove')} ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}
