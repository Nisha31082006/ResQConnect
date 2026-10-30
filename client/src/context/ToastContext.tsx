import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; kind: ToastKind; message: string }
interface ToastApi { push: (kind: ToastKind, message: string) => void; success: (m: string) => void; error: (m: string) => void; info: (m: string) => void }

const Ctx = createContext<ToastApi | null>(null);
const ICON: Record<ToastKind, string> = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
const STYLE: Record<ToastKind, string> = {
  success: 'border-green-700 bg-green-50 text-green-900',
  error: 'border-red-700 bg-red-50 text-red-900',
  info: 'border-blue-700 bg-blue-50 text-blue-900',
  warning: 'border-amber-700 bg-amber-50 text-amber-900',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 5000);
  }, []);
  const api = useMemo<ToastApi>(() => ({ push, success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[2000] flex flex-col items-center gap-2 p-4 sm:items-end" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border-l-4 px-4 py-3 text-sm shadow-lg ${STYLE[t.kind]}`}>
            <span aria-hidden className="font-bold">{ICON[t.kind]}</span>
            <span className="flex-1">{t.message}</span>
            <button className="font-bold" aria-label="Close" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('ToastProvider missing');
  return c;
};
