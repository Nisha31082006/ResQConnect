import axios, { AxiosError } from 'axios';
import type { Paged } from '../types';

const TOKEN_KEY = 'rq_token';
export const HASH_MODE = import.meta.env.VITE_HASH_ROUTER === 'true';
// "Portable" mode: the app may live under a path prefix such as /proxy/5000/ (cloud IDE previews).
// The API/socket root is then the folder the page was loaded from.
export const apiRoot = (): string =>
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (HASH_MODE ? new URL('.', window.location.href).pathname.replace(/\/$/, '') : '');
const base = apiRoot();

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export interface FieldIssue { path: string; code: string; message?: string }

/** Normalised error thrown by every API helper. `code` is a stable machine code (translated by the UI). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: FieldIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export const http = axios.create({ baseURL: `${base}/api`, timeout: 20000 });

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const UNAUTHORIZED_EVENT = 'rq:unauthorized';

http.interceptors.response.use(
  (r) => r,
  (err: AxiosError<{ error?: { code: string; message: string; details?: FieldIssue[] } }>) => {
    if (!err.response) return Promise.reject(new ApiError(0, 'NETWORK_ERROR', err.message));
    const e = err.response.data?.error;
    const apiErr = new ApiError(err.response.status, e?.code ?? 'UNKNOWN_ERROR', e?.message ?? err.message, Array.isArray(e?.details) ? e!.details : []);
    if (err.response.status === 401 && apiErr.code !== 'AUTH_INVALID_CREDENTIALS') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    return Promise.reject(apiErr);
  },
);

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return (await http.get(url, { params })).data.data as T;
}
export async function getPaged<T>(url: string, params?: Record<string, unknown>): Promise<Paged<T>> {
  const res = (await http.get(url, { params })).data;
  return { data: res.data as T[], meta: res.meta };
}
export async function post<T>(url: string, body?: unknown): Promise<T> {
  return (await http.post(url, body)).data.data as T;
}
export async function postFull<T>(url: string, body?: unknown): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const r = (await http.post(url, body)).data;
  return { data: r.data as T, meta: r.meta };
}
export async function put<T>(url: string, body?: unknown): Promise<T> {
  return (await http.put(url, body)).data.data as T;
}
export async function patch<T>(url: string, body?: unknown): Promise<T> {
  return (await http.patch(url, body)).data.data as T;
}
export async function del<T>(url: string): Promise<T> {
  return (await http.delete(url)).data.data as T;
}

/** Multipart helper: JSON goes in the `data` field, files in `evidence` (server convention). */
export function multipart(data: unknown, files: File[]): FormData {
  const fd = new FormData();
  fd.append('data', JSON.stringify(data));
  files.forEach((f) => fd.append('evidence', f));
  return fd;
}

/** Evidence files are protected, so images are fetched with the auth header and shown from a blob URL. */
export async function fetchBlobUrl(url: string): Promise<string> {
  const res = await http.get(url.replace(/^\/api/, ''), { responseType: 'blob' });
  return URL.createObjectURL(res.data as Blob);
}
