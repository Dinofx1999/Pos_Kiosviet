import { useQuery } from '@tanstack/react-query';
import { http } from './client';
import type { Me, Tokens } from './types';
import { useAuthStore } from '../store/auth';

export const authApi = {
  login: (body: { tenantCode: string; username: string; password: string }) => http.post<Tokens & { user: any; tenant: any }>('/auth/login', body).then((r) => r.data),
  register: (body: { tenantCode: string; tenantName: string; ownerUsername: string; ownerPassword: string; ownerFullName: string; email?: string; phone?: string; industry?: string }) => http.post<Tokens & { tenant: any; user: any }>('/auth/register-tenant', body).then((r) => r.data),
  me: () => http.get<Me>('/auth/me').then((r) => r.data),
  logout: (refreshToken: string) => http.post('/auth/logout', { refreshToken }),
  changePassword: (body: { currentPassword: string; newPassword: string }) => http.post('/auth/change-password', body),
};

export function useMeQuery(enabled = true) {
  const setMe = useAuthStore((s) => s.setMe);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => { const me = await authApi.me(); setMe(me); return me; },
    enabled,
    staleTime: 60_000,
  });
}
