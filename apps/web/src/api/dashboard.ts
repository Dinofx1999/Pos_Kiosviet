import { useQuery } from '@tanstack/react-query';
import { http } from './client';
import type { DashboardOverview } from './types';

export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => http.get<DashboardOverview>('/dashboard/overview').then((r) => r.data), refetchInterval: 60_000 });
