import { useCallback, useEffect, useState } from 'react';
import { getPaged } from '../services/api';
import type { Paged } from '../types';
import { useDebounced } from './useDebounced';
import { useFetch } from './useFetch';
import { useSocketEvents } from './useSocketEvents';

/** Server-side pagination + debounced search + optional live refresh on socket events. */
export function usePagedList<T>(url: string, filters: Record<string, unknown> = {}, opts: { limit?: number; events?: string[]; searchable?: boolean } = {}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 350);
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [q, filterKey]);
  const fetcher = useCallback(
    () => getPaged<T>(url, { ...filters, page, limit: opts.limit ?? 10, ...(opts.searchable !== false && q ? { search: q } : {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, filterKey, page, q, opts.limit],
  );
  const f = useFetch<Paged<T>>(fetcher, [url, filterKey, page, q]);
  useSocketEvents(opts.events ?? [], () => void f.reload());
  return { items: f.data?.data ?? [], meta: f.data?.meta ?? { page: 1, limit: 10, total: 0, pages: 1 }, page, setPage, search, setSearch, loading: f.loading, error: f.error, reload: f.reload };
}
