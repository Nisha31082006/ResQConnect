import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { post } from '../../services/api';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows } from '../../components/ui';
import { usePagedList } from '../../hooks/usePagedList';
import { errorMessage } from '../../utils/errors';
import { formatDateTime } from '../../utils/format';
import { notificationText } from '../../utils/notifications';
import type { AppNotification } from '../../types';

export default function Notifications() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const list = usePagedList<AppNotification>('/notifications', {}, { searchable: false, events: ['notification:new'] });
  const open = async (n: AppNotification) => {
    if (!n.read) await post(`/notifications/${n.id}/read`).catch(() => undefined);
    if (n.link) nav(n.link); else void list.reload();
  };
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.notifications')} actions={<Button variant="secondary" onClick={() => void post('/notifications/read-all').then(() => list.reload())}>{t('notifications.markAll')}</Button>} />
      <Card>
        {list.loading ? <SkeletonRows /> : list.error ? <ErrorState message={errorMessage(list.error, t)} onRetry={() => void list.reload()} /> : list.items.length === 0 ? <EmptyState title={t('notifications.empty')} /> : (
          <ul className="divide-y divide-ink-100">
            {list.items.map((n) => (
              <li key={n.id}>
                <button className={`flex w-full items-start gap-3 px-2 py-3 text-left hover:bg-ink-50 ${n.read ? '' : 'font-semibold'}`} onClick={() => void open(n)}>
                  <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand-600'}`} />
                  <span className="flex-1"><span className="block text-sm">{notificationText(n, t)}</span><span className="text-xs font-normal text-ink-500">{formatDateTime(n.createdAt, i18n.language)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={list.meta.page} pages={list.meta.pages} total={list.meta.total} onPage={list.setPage} />
      </Card>
    </div>
  );
}
