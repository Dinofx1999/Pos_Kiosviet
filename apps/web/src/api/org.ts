import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { AuditLog, Branch, LoginHistory, Paginated, PermissionGroup, Role, SequenceRow, UserRow, Warehouse } from './types';

export const orgApi = {
  branches: (includeInactive = true) => http.get<Branch[]>('/branches', { params: { includeInactive } }).then((r) => r.data),
  createBranch: (b: any) => http.post<Branch>('/branches', b).then((r) => r.data),
  updateBranch: (id: string, b: any) => http.patch<Branch>(`/branches/${id}`, b).then((r) => r.data),
  warehouses: (branchId?: string, includeInactive = true) => http.get<Warehouse[]>('/warehouses', { params: clean({ branchId, includeInactive }) }).then((r) => r.data),
  createWarehouse: (b: any) => http.post<Warehouse>('/warehouses', b).then((r) => r.data),
  updateWarehouse: (id: string, b: any) => http.patch<Warehouse>(`/warehouses/${id}`, b).then((r) => r.data),
  users: (q: any) => http.get<Paginated<UserRow>>('/users', { params: clean(q) }).then((r) => r.data),
  createUser: (b: any) => http.post<UserRow>('/users', b).then((r) => r.data),
  updateUser: (id: string, b: any) => http.patch<UserRow>(`/users/${id}`, b).then((r) => r.data),
  resetPassword: (id: string, newPassword: string) => http.post(`/users/${id}/reset-password`, { newPassword }),
  roles: () => http.get<Role[]>('/roles').then((r) => r.data),
  permissions: () => http.get<PermissionGroup[]>('/roles/permissions').then((r) => r.data),
  createRole: (b: any) => http.post<Role>('/roles', b).then((r) => r.data),
  updateRole: (id: string, b: any) => http.patch<Role>(`/roles/${id}`, b).then((r) => r.data),
  deleteRole: (id: string) => http.delete(`/roles/${id}`),
  settings: () => http.get<Record<string, unknown>>('/settings').then((r) => r.data),
  updateSettings: (settings: Record<string, unknown>) => http.put<Record<string, unknown>>('/settings', { settings }).then((r) => r.data),
  sequences: () => http.get<SequenceRow[]>('/settings/sequences').then((r) => r.data),
  updateSequences: (items: Omit<SequenceRow, 'nextNumber'>[]) => http.put<SequenceRow[]>('/settings/sequences', { items }).then((r) => r.data),
  auditLogs: (q: any) => http.get<Paginated<AuditLog>>('/audit-logs', { params: clean(q) }).then((r) => r.data),
  loginHistory: (q: any) => http.get<Paginated<LoginHistory>>('/login-history', { params: clean(q) }).then((r) => r.data),
};

export const useBranches = () => useQuery({ queryKey: ['branches'], queryFn: () => orgApi.branches(true) });
export const useWarehouses = (branchId?: string) => useQuery({ queryKey: ['warehouses', branchId], queryFn: () => orgApi.warehouses(branchId, true) });
export const useRoles = (enabled = true) => useQuery({ queryKey: ['roles'], queryFn: orgApi.roles, enabled });
export const useUsers = (q: any) => useQuery({ queryKey: ['users', q], queryFn: () => orgApi.users(q), placeholderData: keepPreviousData });
