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
  latitude?: number | null; longitude?: number | null; accuracy?: number | string | null; distanceMeters?: number | null; outDistanceMeters?: number | null; deviceId?: string | null; flags?: string[]; editedById?: string | null; user?: { id: string; fullName: string; username?: string };
}
export interface AttendancePolicy { gpsRequired: boolean; deviceLock: boolean; radius: number; maxAccuracy: number }
export interface AttendanceBranchGeo { id: string; name: string; hasGeo: boolean; radius: number }
export interface AttendanceDeviceInfo { id: string; status: 'TRUSTED' | 'PENDING' | 'BLOCKED' | 'OTHER_USER' | string; name?: string | null }
export interface AttendanceCurrent { open: Attendance | null; monthMinutes: number; monthDays: number; policy?: AttendancePolicy; device?: AttendanceDeviceInfo | null; branches?: AttendanceBranchGeo[] }
export interface AttendanceDevice { id: string; userId: string; deviceId: string; name?: string | null; status: 'TRUSTED' | 'PENDING' | 'BLOCKED' | string; firstSeenAt: string; lastSeenAt: string; user?: { id: string; fullName: string; username?: string } }
/** Nhãn cờ nghi vấn trên một lượt chấm công. */
export const ATTENDANCE_FLAG_LABEL: Record<string, string> = { NO_GPS: 'Không có vị trí', GPS_INACCURATE: 'GPS sai số lớn', OUT_OF_RANGE: 'Ngoài bán kính chi nhánh', NO_DEVICE: 'Không nhận diện thiết bị', NEW_DEVICE: 'Thiết bị mới', DEVICE_SHARED: 'Thiết bị của người khác', OUT_NO_GPS: 'Ra: không có vị trí', OUT_GPS_INACCURATE: 'Ra: GPS sai số lớn', OUT_OF_RANGE_OUT: 'Ra: ngoài bán kính', OUT_OUT_OF_RANGE: 'Ra: ngoài bán kính', DEVICE_CHANGED: 'Ra bằng thiết bị khác' };
export const DEVICE_STATUS_LABEL: Record<string, string> = { TRUSTED: 'Tin cậy', PENDING: 'Chờ duyệt', BLOCKED: 'Đã khóa', OTHER_USER: 'Của nhân viên khác' };
/** Mã thiết bị chấm công: sinh một lần và lưu trên trình duyệt (một thiết bị ↔ một nhân viên). */
export function attendanceDeviceId(): string | undefined {
  try {
    let id = localStorage.getItem('att.deviceId');
    if (!id) { id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`); localStorage.setItem('att.deviceId', id); }
    return id;
  } catch { return undefined; }
}
export function attendanceDeviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (ua.match(/Android[^;]*;\s*([^;)]+)/)?.[1]?.trim() ?? 'Android') : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Thiết bị';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Trình duyệt';
  return `${os} · ${br}`.slice(0, 200);
}
export interface AttendanceQuery { page?: number; pageSize?: number; from?: string; to?: string; userId?: string; branchId?: string; open?: 'true' | 'false' }
export interface AttendanceSummary { userId: string; name: string; sessions: number; minutes: number; hours: number }
export interface AttendanceList extends Paginated<Attendance> { summary: AttendanceSummary[] }
export interface CheckInInput { branchId?: string; note?: string; latitude?: number; longitude?: number; accuracy?: number; deviceId?: string; deviceName?: string }
export interface CheckOutInput { note?: string; latitude?: number; longitude?: number; accuracy?: number; deviceId?: string }
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
  checkOut: (b: CheckOutInput) => http.post<Attendance>('/employees/attendance/check-out', b).then((r) => r.data),
  current: (deviceId?: string) => http.get<AttendanceCurrent>('/employees/attendance/current', { params: clean({ deviceId }) }).then((r) => r.data),
  devices: (q: { userId?: string; status?: string } = {}) => http.get<AttendanceDevice[]>('/employees/attendance/devices', { params: clean({ ...q }) }).then((r) => r.data),
  patchDevice: (id: string, status: 'TRUSTED' | 'BLOCKED') => http.patch<AttendanceDevice>(`/employees/attendance/devices/${id}`, { status }).then((r) => r.data),
  removeDevice: (id: string) => http.delete(`/employees/attendance/devices/${id}`),
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
export const useAttendanceCurrent = (enabled = true, deviceId?: string) => useQuery({ queryKey: ['attendance-current', deviceId], queryFn: () => employeesApi.current(deviceId), enabled, refetchInterval: 60_000 });
export const useAttendanceDevices = (q: { userId?: string; status?: string } = {}, enabled = true) => useQuery({ queryKey: ['attendance-devices', q], queryFn: () => employeesApi.devices(q), enabled });
export const useMyAttendance = (q: AttendanceQuery, enabled = true) => useQuery({ queryKey: ['attendance-me', q], queryFn: () => employeesApi.myAttendance(q), placeholderData: keepPreviousData, enabled });
export const useAttendance = (q: AttendanceQuery, enabled = true) => useQuery({ queryKey: ['attendance', q], queryFn: () => employeesApi.attendance(q), placeholderData: keepPreviousData, enabled });
export const usePerformance = (q: PeriodQuery, enabled = true) => useQuery({ queryKey: ['performance', q], queryFn: () => employeesApi.performance(q), placeholderData: keepPreviousData, enabled });

/** Query keys touched by employee mutations – invalidate them all after a write. */
export const EMPLOYEE_KEYS = ['employees', 'commission-rules', 'commissions', 'commissions-me', 'attendance-current', 'attendance-me', 'attendance', 'attendance-devices', 'performance', 'users'];

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
