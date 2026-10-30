import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getPaged, post } from '../services/api';
import { useSocketEvents } from '../hooks/useSocketEvents';
import { useToast } from '../context/ToastContext';
import { formatDateTime } from '../utils/format';
import type { AppNotification } from '../types';
import { notificationText } from '../utils/notifications';

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const nav = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    getPaged<AppNotification>('/notifications', { limit: 8 }).then((r) => setItems(r.data)).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  useSocketEvents(['notification:new'], (_e, p) => {
    const n = p as AppNotification;
    setItems((cur) => [n, ...cur.filter((x) => x.id !== n.id)].slice(0, 8));
    toast.info(notificationText(n, t));
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;
  const openItem = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      void post(`/notifications/${n.id}/read`).catch(() => undefined);
    }
    if (n.link) nav(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost relative" aria-label={t('notifications.title', { count: unread })} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden>🔔</span>
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-700 px-1 text-xs font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-[1300] mt-2 w-80 max-w-[90vw] rounded-xl border border-ink-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
            <strong className="text-sm">{t('notifications.heading')}</strong>
            <button className="text-xs font-semibold text-blue-700 underline" onClick={() => { void post('/notifications/read-all').then(load); }}>{t('notifications.markAll')}</button>
          </div>
          <ul className="max-h-80 overflow-auto">
            {items.length === 0 && <li className="p-4 text-center text-sm text-ink-500">{t('notifications.empty')}</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button className={`block w-full px-3 py-2 text-left text-sm hover:bg-ink-100 ${n.read ? '' : 'bg-blue-50 font-semibold'}`} onClick={() => void openItem(n)}>
                  {!n.read && <span className="mr-1 text-blue-700" aria-label={t('notifications.unread')}>●</span>}
                  {notificationText(n, t)}
                  <div className="text-xs font-normal text-ink-500">{formatDateTime(n.createdAt, i18n.language)}</div>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notifications" className="block border-t border-ink-200 px-3 py-2 text-center text-sm font-semibold text-blue-700" onClick={() => setOpen(false)}>{t('notifications.viewAll')}</Link>
        </div>
      )}
    </div>
  );
}
