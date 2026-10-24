import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { clean, http } from './client';
import type { Paginated } from './types';

// ---------------------------------------------------------------- Module 11 – nhân viên (BR-150..BR-153)
// Money / quantity / points come back as decimal strings; dates as ISO strings.

export type CommissionBasis = 'REVENUE' | 'GROSS_PROFIT' | 'QUANTITY';
export type EmployeeStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED';

export interface EmployeeRoleBrief { id: string; code: string; name: string }
export interface Employee {
  id: string; username: string; fullName: string; email?: string | null; phone?: string | null; status: EmployeeStatus | string; isOwner: boolean; allBranches?: boolean;
  position?: string | null; hiredAt?: string | null; baseSalary?: string | null; employeeNote?: string | null; lastLoginAt?: string | null;
  roles: EmployeeRoleBrief[]; branches: { id: string; name: string }[];
}
export interface EmployeeQuery { page?: number; pageSize?: number; search?: string; status?: string; branchId?: string }
/** Employee profile fields that live on the user account (BR-153). */
export interface EmployeeProfile { position?: string | null; hiredAt?: string | null; baseSalary?: string | null; employeeNote?: string | null }

export interface CommissionRule {
  id: string; name: string; userId?: string | null; user?: { id: string; fullName: string } | null; categoryId?: string | null; variantId?: string | null;
  basis: CommissionBasis; rate: string; minRevenue: string; priority: number; isActive: boolean; startsAt?: string | null; endsAt?: string | null; createdAt?: string;
}
export interface CommissionRuleInput { name: string; userId?: string | null; categoryId?: string | null; variantId?: string | null; basis?: CommissionBasis; rate: string; minRevenue?: string; priority?: number; startsAt?: string | null; endsAt?: string | null; isActive?: boolean }

export interface PeriodQuery { from?: string; to?: string; branchId?: string; userId?: string }
export interface CommissionByRule { ruleId: string; name: string; basis: CommissionBasis; rate: string; base: string; commission: string; eligible: boolean; minRevenue: string; lines: number }
export interface CommissionRow { sellerId: string; name: string; invoices: number; revenue: string; cost: string; grossProfit: string; quantity: string; commission: string; byRule: CommissionByRule[] }
export interface CommissionReport { from: string; to: string; rules: number; data: CommissionRow[]; totals: { sellers: number; revenue: string; commission: string } }

export interface Attendance {
  id: string; userId: string; branchId?: string | null; checkInAt: string; checkOutAt?: string | null; minutes?: number | null; source: 'APP' | 'MANUAL' | string; note?: string | null;
  latitude?: number | null; longitude?: number | null; editedById?: string | null; user?: { id: string; fullName: string; username?: string };
}
export interface AttendanceCurrent { open: Attendance | null; monthMinutes: number; monthDays: number }
export interface AttendanceQuery { page?: number; pageSize?: number; from?: string; to?: string; userId?: string; branchId?: string; open?: 'true' | 'false' }
export interface AttendanceSummary { userId: string; name: string; sessions: number; minutes: number; hours: number }
export interface AttendanceList extends Paginated<Attendance> { summary: AttendanceSummary[] }
export interface CheckInInput { branchId?: string; note?: string; latitude?: number; longitude?: number }
export interface ManualAttendanceInput { userId: string; branchId?: string; checkInAt: string; checkOutAt?: string; note?: string }
export interface EditAttendanceInput { checkInAt?: string; checkOutAt?: string | null; note?: string }

export interface PerformanceRow {
  sellerId: string; name: string; invoices: number; revenue: string; returned: string; netRevenue: string; grossProfit: string; items: string; customers: number; avgBasket: string;
  shifts: number; cashDifference: string; attendanceSessions: number; attendanceMinutes: number; commission: string;
}
export interface PerformanceReport { from: string; to: string; data: PerformanceRow[]; totals: { sellers: number; revenue: string; netRevenue: string; commission: string } }

export const employeesApi = {
  list: (q: EmployeeQuery) => http.get<Paginated<Employee>>('/employees', { params: clean({ ...q }) }).then((r) => r.data),
  // hoa hồng
  rules: (includeInactive = true) => http.get<CommissionRule[]>('/employees/commission-rules', { params: { includeInactive } }).then((r) => r.data),
  createRule: (b: CommissionRuleInput) => http.post<CommissionRule>('/employees/commission-rules', b).then((r) => r.data),
  updateRule: (id: string, b: Partial<CommissionRuleInput>) => http.patch<CommissionRule>(`/employees/commission-rules/${id}`, b).then((r) => r.data),
  deleteRule: (id: string) => http.delete(`/employees/commission-rules/${id}`),
  commissions: (q: PeriodQuery) => http.get<CommissionReport>('/employees/commissions', { params: clean({ ...q }) }).then((r) => r.data),
  myCommission: (q: PeriodQuery) => http.get<CommissionReport>('/employees/commissions/me', { params: clean({ ...q }) }).then((r) => r.data),
  // chấm công
  checkIn: (b: CheckInInput) => http.post<Attendance>('/employees/attendance/check-in', b).then((r) => r.data),
  checkOut: (b: { note?: string }) => http.post<Attendance>('/employees/attendance/check-out', b).then((r) => r.data),
  current: () => http.get<AttendanceCurrent>('/employees/attendance/current').then((r) => r.data),
  myAttendance: (q: AttendanceQuery) => http.get<AttendanceList>('/employees/attendance/me', { params: clean({ ...q }) }).then((r) => r.data),
  attendance: (q: AttendanceQuery) => http.get<AttendanceList>('/employees/attendance', { params: clean({ ...q }) }).then((r) => r.data),
  manualAttendance: (b: ManualAttendanceInput) => http.post<Attendance>('/employees/attendance', b).then((r) => r.data),
  editAttendance: (id: string, b: EditAttendanceInput) => http.patch<Attendance>(`/employees/attendance/${id}`, b).then((r) => r.data),
  // hiệu suất
  performance: (q: PeriodQuery) => http.get<PerformanceReport>('/employees/performance', { params: clean({ ...q }) }).then((r) => r.data),
};

export const useEmployees = (q: EmployeeQuery, enabled = true) => useQuery({ queryKey: ['employees', q], queryFn: () => employeesApi.list(q), placeholderData: keepPreviousData, enabled });
export const useCommissionRules = (enabled = true, includeInactive = true) => useQuery({ queryKey: ['commission-rules', includeInactive], queryFn: () => employeesApi.rules(includeInactive), enabled });
export const useCommissions = (q: PeriodQuery, enabled = true) => useQuery({ queryKey: ['commissions', q], queryFn: () => employeesApi.commissions(q), placeholderData: keepPreviousData, enabled });
export const useMyCommission = (q: PeriodQuery, enabled = true) => useQuery({ queryKey: ['commissions-me', q], queryFn: () => employeesApi.myCommission(q), placeholderData: keepPreviousData, enabled });
export const useAttendanceCurrent = (enabled = true) => useQuery({ queryKey: ['attendance-current'], queryFn: employeesApi.current, enabled, refetchInterval: 60_000 });
export const useMyAttendance = (q: AttendanceQuery, enabled = true) => useQuery({ queryKey: ['attendance-me', q], queryFn: () => employeesApi.myAttendance(q), placeholderData: keepPreviousData, enabled });
export const useAttendance = (q: AttendanceQuery, enabled = true) => useQuery({ queryKey: ['attendance', q], queryFn: () => employeesApi.attendance(q), placeholderData: keepPreviousData, enabled });
export const usePerformance = (q: PeriodQuery, enabled = true) => useQuery({ queryKey: ['performance', q], queryFn: () => employeesApi.performance(q), placeholderData: keepPreviousData, enabled });

/** Query keys touched by employee mutations – invalidate them all after a write. */
export const EMPLOYEE_KEYS = ['employees', 'commission-rules', 'commissions', 'commissions-me', 'attendance-current', 'attendance-me', 'attendance', 'performance', 'users'];

export const COMMISSION_BASIS_LABEL: Record<CommissionBasis, string> = { REVENUE: 'Doanh thu', GROSS_PROFIT: 'Lợi nhuận gộp', QUANTITY: 'Số lượng' };
export const COMMISSION_BASIS_HINT: Record<CommissionBasis, string> = { REVENUE: '% trên doanh thu thuần của dòng bán', GROSS_PROFIT: '% trên (doanh thu − giá vốn), không âm', QUANTITY: 'tiền thưởng cho mỗi đơn vị bán ra' };
export const ATTENDANCE_SOURCE_LABEL: Record<string, string> = { APP: 'Tự chấm', MANUAL: 'Quản lý nhập' };

/** 510 → "8g30"; 0 → "0p". */
export const fmtMinutes = (min?: number | null) => {
  const m = Math.max(0, Math.round(min ?? 0));
  const h = Math.floor(m / 60); const r = m % 60;
  return h ? `${h}g${r ? String(r).padStart(2, '0') : ''}` : `${r}p`;
};
/** 510 → "8,5 giờ" */
export const fmtHours = (min?: number | null) => `${(Math.max(0, min ?? 0) / 60).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} giờ`;
