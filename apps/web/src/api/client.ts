import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/auth';
import type { ApiError } from './types';

export const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export const http = axios.create({ baseURL: API_URL, timeout: 60_000 });

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

/** Tokens persisted by another tab (zustand persist key) — adopted before we spend our own refresh token. */
function tokensFromStorage(): { accessToken: string | null; refreshToken: string | null } | null {
  try {
    const raw = localStorage.getItem('erp-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { accessToken?: string | null; refreshToken?: string | null } };
    return { accessToken: parsed.state?.accessToken ?? null, refreshToken: parsed.state?.refreshToken ?? null };
  } catch { return null; }
}

async function refreshAccessToken(): Promise<string | null> {
  const current = useAuthStore.getState();
  // another tab may already have rotated the pair (multi-tab POS): use its tokens instead of racing it
  const stored = tokensFromStorage();
  if (stored?.accessToken && stored.refreshToken && stored.accessToken !== current.accessToken) {
    useAuthStore.getState().setTokens(stored.accessToken, stored.refreshToken);
    return stored.accessToken;
  }
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
    useAuthStore.getState().setTokens(res.data.accessToken, res.data.refreshToken);
    return res.data.accessToken as string;
  } catch {
    // the other tab may have won the race in the meantime
    const again = tokensFromStorage();
    if (again?.accessToken && again.accessToken !== useAuthStore.getState().accessToken && again.refreshToken) { useAuthStore.getState().setTokens(again.accessToken, again.refreshToken); return again.accessToken; }
    return null;
  }
}

// keep every tab on the latest tokens / login state
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== 'erp-auth') return;
    const stored = tokensFromStorage();
    const cur = useAuthStore.getState();
    if (!stored?.accessToken && cur.accessToken) { cur.logout(); if (!window.location.pathname.startsWith('/login')) window.location.assign('/login'); return; }
    if (stored?.accessToken && stored.refreshToken && stored.accessToken !== cur.accessToken) cur.setTokens(stored.accessToken, stored.refreshToken);
  });
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<any>) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const url = original?.url ?? '';
    if (status === 401 && original && !original._retry && !url.includes('/auth/login') && !url.includes('/auth/refresh')) {
      original._retry = true;
      refreshing = refreshing ?? refreshAccessToken().finally(() => { refreshing = null; });
      const token = await refreshing;
      if (token) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${token}` };
        return http(original);
      }
      useAuthStore.getState().logout();
      if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
    }
    return Promise.reject(normalizeError(error));
  },
);

export function normalizeError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data;
    if (data && typeof data === 'object') {
      return { code: data.code ?? 'ERROR', message: data.message ?? err.message, statusCode: data.statusCode ?? err.response?.status, details: data.details };
    }
    if (!err.response) return { code: 'NETWORK_ERROR', message: 'Không kết nối được máy chủ. Vui lòng thử lại.' };
    return { code: 'ERROR', message: err.message, statusCode: err.response.status };
  }
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) return err as ApiError;
  return { code: 'ERROR', message: err instanceof Error ? err.message : String(err) };
}

export const errMsg = (e: unknown) => normalizeError(e).message;
export const clean = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;
