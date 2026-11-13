import { Alert, App, Button, Card, Drawer, Empty, Form, Input, Modal, Select, Skeleton, Switch, Tabs, Tag, Tooltip } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ClockCircleOutlined, DeleteOutlined, EditOutlined, EnvironmentOutlined, LoginOutlined, LogoutOutlined, MobileOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, ScheduleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_FLAG_LABEL, ATTENDANCE_SOURCE_LABEL, Attendance, DEVICE_STATUS_LABEL, WorkShift, attendanceDeviceId, attendanceDeviceName, employeesApi, fmtHours, fmtMinutes, hhmm, shiftLabel, useAttendance, useAttendanceCurrent, useAttendanceDevices, useMyAttendance, useWorkShifts } from '../../api/employees';
import { errMsg, normalizeError } from '../../api/client';
import { orgApi } from '../../api/org';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt } from '../../utils/format';
import { BranchSelect, CardPager, DateRangeBar, HBarChart, Range, Stat, presetRange } from '../reports/ReportShared';
import { DateTimeInput, EmployeeSelect, periodParams, useInvalidateEmployees, useUrlTab, useUrlUserId } from './EmployeeShared';
import './employees.css';

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dayLabel = (v: string) => { const d = dayjs(v); return `${DAY_NAMES[d.day()]} ${d.format('DD/MM')}`; };
/** Thời gian có mặt thật (phút) của lượt đã chấm ra – so với giờ công tính theo ca. */
const presentMinutes = (a: Attendance) => (a.checkOutAt ? Math.max(0, Math.round((new Date(a.checkOutAt).getTime() - new Date(a.checkInAt).getTime()) / 60000)) : null);
/** Giờ công của lượt; khác thời gian có mặt (vào sớm / ra muộn so với ca) thì ghi thêm. */
function MinutesCell({ a }: { a: Attendance }) {
  if (!a.checkOutAt) return <>—</>;
  const p = presentMinutes(a);
  return <span className="em-min"><b>{fmtMinutes(a.minutes)}</b>{p !== null && p !== (a.minutes ?? 0) && <small>có mặt {fmtMinutes(p)}</small>}</span>;
}
const shiftCell = (a: Attendance) => (a.workShift ? <span className="em-shift-tag">{shiftLabel(a.workShift)}</span> : <span className="muted">—</span>);

/** Live HH:MM:SS since `since`. */
function LiveTimer({ since }: { since: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const h = window.setInterval(() => tick((t) => t + 1), 1000); return () => window.clearInterval(h); }, []);
  const sec = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  return <span className="em-timer">{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
}
function Clock() {
  const [now, setNow] = useState(() => dayjs());
  useEffect(() => { const h = window.setInterval(() => setNow(dayjs()), 1000); return () => window.clearInterval(h); }, []);
  return <div className="now">{now.format('HH:mm:ss')}</div>;
}

/** Chấm công: tab "Của tôi" for everyone, tab "Toàn bộ nhân viên" for attendance.view (edit / add for employee.manage). */
export default function AttendancePage() {
  const can = useCan();
  const canAll = can('attendance.view');
  const [tab, setTab] = useUrlTab(['me', 'all'] as const, 'me');
  const active = tab === 'all' && canAll ? 'all' : 'me';
  return (
    <div className="em-page">
      <h1 className="kv-page-title">Chấm công</h1>
      {canAll ? (
        <Tabs activeKey={active} onChange={(k) => setTab(k as 'me' | 'all')} items={[{ key: 'me', label: 'Của tôi', children: <MyTab /> }, { key: 'all', label: 'Toàn bộ nhân viên', children: <AllTab /> }]} />
      ) : <MyTab />}
    </div>
  );
}

// ---------------------------------------------------------------- my attendance
function MyTab() {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const branchId = useAuthStore((s) => s.currentBranchId);
  const invalidate = useInvalidateEmployees();
  const deviceId = useMemo(() => attendanceDeviceId(), []);
  const { data: cur, isLoading, error, refetch } = useAttendanceCurrent(true, deviceId);
  const [note, setNote] = useState('');
  const [branch, setBranch] = useState<string | undefined>(branchId ?? undefined);
  const [shiftId, setShiftId] = useState<string>();
  const [shiftTouched, setShiftTouched] = useState(false);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [page, setPage] = useState(1);
  const hist = useMyAttendance({ ...periodParams(range), page, pageSize: 20 });
  useEffect(() => { setBranch(branchId ?? undefined); }, [branchId]);
  const branchName = (id?: string | null) => me?.branches.find((b) => b.id === id)?.name;

  // chính sách: chi nhánh có tọa độ + cửa hàng bật "bắt buộc GPS" → phải lấy được vị trí mới chấm được
  const branchGeo = cur?.branches?.find((b) => b.id === branch);
  const needGps = !!cur?.policy?.gpsRequired && !!branchGeo?.hasGeo;
  // ca làm: gợi ý theo giờ hiện tại (máy chủ tính), nhân viên đổi được trước khi chấm vào
  const shiftOpts = branchGeo?.shifts ?? [];
  const pickedShift = shiftOpts.find((x) => x.id === shiftId);
  useEffect(() => { setShiftTouched(false); }, [branch]);
  useEffect(() => { if (!shiftTouched) setShiftId(branchGeo?.suggestedShiftId ?? undefined); }, [branchGeo?.suggestedShiftId, branch, shiftTouched]);
  const locate = (required: boolean) => new Promise<{ latitude: number; longitude: number; accuracy: number } | undefined>((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return required ? reject(new Error('Trình duyệt không hỗ trợ định vị – dùng Chrome / Safari trên điện thoại')) : resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) => (required ? reject(new Error(err.code === 1 ? 'Bạn chưa cho phép trình duyệt dùng vị trí – bật định vị cho trang này rồi thử lại' : 'Không lấy được vị trí – bật GPS, ra chỗ thoáng rồi thử lại')) : resolve(undefined)),
      { enableHighAccuracy: true, timeout: required ? 15000 : 5000, maximumAge: 0 },
    );
  });
  const checkIn = async () => {
    setBusy(true);
    try {
      setLocating(true);
      const pos = await locate(needGps).finally(() => setLocating(false));
      const a = await employeesApi.checkIn({ branchId: branch, note: note.trim() || undefined, ...(pos ?? {}), deviceId, deviceName: attendanceDeviceName(), workShiftId: shiftId });
      message.success(a.distanceMeters !== null && a.distanceMeters !== undefined ? `Đã chấm công vào lúc ${dt(a.checkInAt, 'HH:mm')} · cách cửa hàng ${a.distanceMeters} m` : `Đã chấm công vào lúc ${dt(a.checkInAt, 'HH:mm')}`);
      setNote(''); invalidate();
    } catch (e) { const err = normalizeError(e); if (err.code === 'ATTENDANCE_OPEN') { message.warning('Bạn đang trong ca – hãy chấm công ra trước'); void refetch(); } else message.error({ content: err.message, duration: 6 }); } finally { setBusy(false); setLocating(false); }
  };
  const checkOut = async () => {
    setBusy(true);
    try {
      const pos = await locate(false);
      const a = await employeesApi.checkOut({ note: note.trim() || undefined, ...(pos ?? {}), deviceId });
      message.success(a.workShift ? `Đã chấm công ra · tính ${fmtMinutes(a.minutes)} công (${shiftLabel(a.workShift)})` : `Đã chấm công ra · ${fmtMinutes(a.minutes)} công`);
      setNote(''); invalidate();
    } catch (e) { const err = normalizeError(e); if (err.code === 'ATTENDANCE_NOT_OPEN') { message.warning('Bạn chưa chấm công vào'); void refetch(); } else message.error(err.message); } finally { setBusy(false); }
  };

  const open = cur?.open ?? null;
  const rows = hist.data?.data ?? [];
  return (
    <>
      {error && !cur && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
      {isLoading && !cur ? <Skeleton active paragraph={{ rows: 4 }} /> : (
        <div className={`em-clock${open ? ' on' : ''}`}>
          {open ? (
            <>
              <div className="st"><span className="em-open-dot" />Đang trong ca · vào lúc <b>{dt(open.checkInAt, 'HH:mm')}</b>{!dayjs(open.checkInAt).isSame(dayjs(), 'day') && <span> ({dayjs(open.checkInAt).format('DD/MM')})</span>}</div>
              <LiveTimer since={open.checkInAt} />
              {open.workShift && open.shiftStartAt && open.shiftEndAt && (
                <div className="em-shift-line"><ScheduleOutlined /> {shiftLabel(open.workShift)}<span>Tính công {dt(dayjs(open.checkInAt).isAfter(open.shiftStartAt) ? open.checkInAt : open.shiftStartAt, 'HH:mm')} → tối đa {dt(open.shiftEndAt, 'HH:mm')}</span></div>
              )}
              <div className="sub">{branchName(open.branchId) ?? 'Chưa gắn chi nhánh'}{open.note ? ` · ${open.note}` : ''}</div>
              <div className="fields"><Input placeholder="Ghi chú khi ra (tùy chọn)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
              <Button className="em-clock-btn out" size="large" icon={<LogoutOutlined />} loading={busy} onClick={checkOut}>CHẤM CÔNG RA</Button>
            </>
          ) : (
            <>
              <div className="st"><ClockCircleOutlined /> Bạn chưa vào ca</div>
              <Clock />
              <div className="sub">{dayjs().format('dddd, DD/MM/YYYY').replace(/^\w/, (c) => c.toUpperCase())}</div>
              <div className="fields">
                <Select placeholder="Chi nhánh" value={branch} onChange={setBranch} options={(me?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
                {shiftOpts.length > 0 && <Select placeholder="Ngoài giờ ca – chọn ca làm" value={shiftId} onChange={(v) => { setShiftId(v); setShiftTouched(true); }} options={shiftOpts.map((x) => ({ value: x.id, label: shiftLabel(x) }))} suffixIcon={<ScheduleOutlined />} />}
                <Input placeholder="Ghi chú (ca sáng, đổi ca…)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </div>
              <div className="em-policy">
                {shiftOpts.length > 0 && <span><ScheduleOutlined /> {pickedShift ? `Giờ công tính trong ca: vào trước ${pickedShift.start} vẫn tính từ ${pickedShift.start}, ra sau ${pickedShift.end} chỉ tính đến ${pickedShift.end}` : 'Ngoài giờ ca: giờ công tính cả lượt, quản lý sẽ xem lại'}</span>}
                <span className={needGps ? 'need' : ''}><EnvironmentOutlined /> {needGps ? `Phải đứng trong bán kính ${branchGeo?.radius ?? ''} m của ${branchGeo?.name ?? 'chi nhánh'} – điện thoại cần bật định vị` : 'Vị trí được gửi kèm khi điện thoại cho phép'}</span>
                {cur?.device ? <span className={`dev ${cur.device.status.toLowerCase()}`}><MobileOutlined /> Thiết bị này: {DEVICE_STATUS_LABEL[cur.device.status] ?? cur.device.status}{cur.device.name ? ` · ${cur.device.name}` : ''}</span>
                  : cur?.policy?.deviceLock ? <span className="dev"><SafetyCertificateOutlined /> Thiết bị này sẽ được đăng ký cho bạn ở lần chấm công đầu tiên</span> : null}
              </div>
              <Button className="em-clock-btn in" size="large" icon={<LoginOutlined />} loading={busy} onClick={checkIn}>{locating ? 'ĐANG LẤY VỊ TRÍ…' : 'CHẤM CÔNG VÀO'}</Button>
            </>
          )}
        </div>
      )}
      {cur && (
        <div className="rp-stats three">
          <Stat label="Lượt tháng này" value={cur.monthDays} />
          <Stat label="Giờ công tháng này" value={fmtHours(cur.monthMinutes)} tone="blue" sub={open ? 'chưa tính ca đang mở' : undefined} />
          <Stat label="Trung bình / lượt" value={cur.monthDays ? fmtMinutes(cur.monthMinutes / cur.monthDays) : '—'} />
        </div>
      )}
      <Card size="small" title="Lịch sử chấm công" extra={<Button size="small" icon={<ReloadOutlined />} loading={hist.isFetching} onClick={() => { void hist.refetch(); void refetch(); }} />}>
        <div className="em-toolbar"><DateRangeBar value={range} onChange={(r) => { setRange(r); setPage(1); }} /></div>
        {hist.isLoading && !hist.data ? <Skeleton active /> : rows.length === 0 ? <Empty description="Không có lượt chấm công trong kỳ" /> : isMobile ? (
          <>
            <div className="em-sessions">{rows.map((a) => <SessionCard key={a.id} a={a} branchName={branchName(a.branchId)} />)}</div>
            <CardPager page={page} pageSize={20} total={hist.data?.meta.total ?? 0} onChange={(p) => setPage(p)} />
          </>
        ) : (
          <Table<Attendance> size="small" rowKey="id" dataSource={rows} pagination={{ current: page, pageSize: 20, total: hist.data?.meta.total ?? 0, onChange: setPage, showTotal: (t) => `${t} lượt` }}
            columns={[
              { title: 'Ngày', dataIndex: 'checkInAt', width: 120, render: (v) => <b>{dayLabel(v)}</b> },
              { title: 'Vào', dataIndex: 'checkInAt', width: 80, render: (v) => dt(v, 'HH:mm') },
              { title: 'Ra', dataIndex: 'checkOutAt', width: 80, render: (v) => v ? dt(v, 'HH:mm') : <Tag color="green">Đang mở</Tag> },
              { title: 'Ca', width: 170, render: (_, a) => shiftCell(a) },
              { title: 'Giờ công', dataIndex: 'minutes', className: 'num', width: 110, render: (_, a) => <MinutesCell a={a} /> },
              { title: 'Chi nhánh', dataIndex: 'branchId', width: 160, render: (v) => branchName(v) ?? '—' },
              { title: 'Vị trí', width: 130, render: (_, a) => <GeoCell a={a} /> },
              { title: 'Nguồn', dataIndex: 'source', width: 110, render: (v) => ATTENDANCE_SOURCE_LABEL[v] ?? v },
              { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (v) => v || <span className="muted">—</span> },
            ]} />
        )}
      </Card>
    </>
  );
}

/** Khoảng cách tới chi nhánh + cờ nghi vấn của một lượt (ngoài bán kính, thiết bị của người khác, GPS sai số lớn…). */
function GeoCell({ a }: { a: Attendance }) {
  const flags = (a.flags ?? []).filter((f) => f !== 'NO_DEVICE');
  const bad = flags.some((f) => /OUT_OF_RANGE|DEVICE_SHARED|GPS_INACCURATE/.test(f));
  const dist = a.distanceMeters ?? null;
  return (
    <span className={`em-geo-cell${bad ? ' bad' : ''}`}>
      {dist !== null ? <span className="d"><EnvironmentOutlined /> {dist} m</span> : a.latitude ? <span className="d muted"><EnvironmentOutlined /> có GPS</span> : <span className="muted">—</span>}
      {flags.length > 0 && <Tooltip title={flags.map((f) => ATTENDANCE_FLAG_LABEL[f] ?? f).join(' · ')}><Tag color={bad ? 'red' : 'gold'}>{bad ? 'Nghi vấn' : `${flags.length} cờ`}</Tag></Tooltip>}
    </span>
  );
}

/** Quản lý thiết bị chấm công: duyệt thiết bị mới (khi bật khóa thiết bị), khóa, xóa đăng ký. */
function DevicesDrawer({ open, onClose, canManage }: { open: boolean; onClose: () => void; canManage: boolean }) {
  const { message, modal } = App.useApp();
  const isMobile = useIsMobile();
  const invalidate = useInvalidateEmployees();
  const { data, isLoading } = useAttendanceDevices({}, open);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); message.success(ok); invalidate(); } catch (e) { message.error(errMsg(e)); } };
  const rows = data ?? [];
  return (
    <Drawer title="Thiết bị chấm công" open={open} onClose={onClose} width={isMobile ? '100%' : 640}>
      <div className="kv-hint" style={{ marginBottom: 10 }}>Mỗi điện thoại chỉ thuộc một nhân viên. Khi bật "Khóa thiết bị chấm công" (Thiết lập → Chính sách), nhân viên đổi máy sẽ thấy thiết bị ở trạng thái Chờ duyệt – bấm Duyệt để cho phép, Khóa để chặn, Xóa để người khác đăng ký lại máy đó.</div>
      {isLoading ? <Skeleton active /> : rows.length === 0 ? <Empty description="Chưa có thiết bị nào chấm công" /> : (
        <div className="em-devices">
          {rows.map((d) => (
            <div key={d.id} className={`em-device ${d.status.toLowerCase()}`}>
              <div className="main">
                <b>{d.user?.fullName ?? '—'}</b>
                <span className="nm"><MobileOutlined /> {d.name ?? 'Thiết bị'}</span>
                <span className="meta">Lần đầu {dt(d.firstSeenAt, 'DD/MM/YY')} · gần nhất {dt(d.lastSeenAt, 'DD/MM HH:mm')}</span>
              </div>
              <Tag color={d.status === 'TRUSTED' ? 'green' : d.status === 'PENDING' ? 'gold' : 'red'}>{DEVICE_STATUS_LABEL[d.status] ?? d.status}</Tag>
              {canManage && (
                <div className="acts">
                  {d.status !== 'TRUSTED' && <Button size="small" type="primary" onClick={() => void act(() => employeesApi.patchDevice(d.id, 'TRUSTED'), 'Đã duyệt thiết bị')}>Duyệt</Button>}
                  {d.status !== 'BLOCKED' && <Button size="small" danger onClick={() => void act(() => employeesApi.patchDevice(d.id, 'BLOCKED'), 'Đã khóa thiết bị')}>Khóa</Button>}
                  <Button size="small" type="text" onClick={() => modal.confirm({ title: 'Xóa đăng ký thiết bị này?', content: 'Máy này có thể được đăng ký lại từ đầu (cho nhân viên này hoặc người khác).', okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: () => act(() => employeesApi.removeDevice(d.id), 'Đã xóa thiết bị') })}>Xóa</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

function SessionCard({ a, branchName, who, onEdit }: { a: Attendance; branchName?: string; who?: string; onEdit?: () => void }) {
  return (
    <div className="em-session">
      <div className="d">{who && <span className="who">{who} · </span>}{dayLabel(a.checkInAt)}</div>
      <div className="t">{dt(a.checkInAt, 'HH:mm')} → {a.checkOutAt ? dt(a.checkOutAt, 'HH:mm') : '…'}</div>
      {a.workShift && <div className="sh"><ScheduleOutlined /> {shiftLabel(a.workShift)}</div>}
      <div className="g"><GeoCell a={a} /></div>
      <div className={`dur${a.checkOutAt ? '' : ' open'}`}>{a.checkOutAt ? <MinutesCell a={a} /> : <><span className="em-open-dot" />Đang mở</>}</div>
      <div className="meta">{branchName && <span>{branchName}</span>}<Tag color={a.source === 'MANUAL' ? 'gold' : 'default'}>{ATTENDANCE_SOURCE_LABEL[a.source] ?? a.source}</Tag>{a.note && <span>{a.note}</span>}</div>
      {onEdit && <div className="act"><Button size="small" type="link" icon={<EditOutlined />} onClick={onEdit}>Sửa giờ</Button></div>}
    </div>
  );
}

// ---------------------------------------------------------------- everyone (managers)
function AllTab() {
  const can = useCan();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const canManage = can('employee.manage');
  const [userId, setUserId] = useUrlUserId();
  const [branchId, setBranchId] = useState<string>();
  const [openOnly, setOpenOnly] = useState(false);
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ open: boolean; session?: Attendance | null }>({ open: false });
  const [devOpen, setDevOpen] = useState(false);
  const [shiftsOpen, setShiftsOpen] = useState(false);
  const q = { ...periodParams(range), userId, branchId, open: openOnly ? ('true' as const) : undefined, page, pageSize: 30 };
  const { data, isLoading, isFetching, error, refetch } = useAttendance(q);
  const branchName = (id?: string | null) => me?.branches.find((b) => b.id === id)?.name;
  const rows = data?.data ?? [];
  const summary = [...(data?.summary ?? [])].sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = summary.reduce((s, x) => s + x.minutes, 0);
  const openCount = rows.filter((r) => !r.checkOutAt).length;
  return (
    <>
      <div className="em-toolbar">
        <DateRangeBar value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        <div className="em-w"><EmployeeSelect value={userId} onChange={(v) => { setUserId(v); setPage(1); }} /></div>
        <div className="em-w"><BranchSelect value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} /></div>
        <span className="rp-switch"><Switch size="small" checked={openOnly} onChange={(v) => { setOpenOnly(v); setPage(1); }} /> Chỉ lượt đang mở</span>
        <span style={{ flex: 1 }} />
        <Button icon={<ScheduleOutlined />} onClick={() => setShiftsOpen(true)}>Ca làm & bán kính</Button>
        <Button icon={<MobileOutlined />} onClick={() => setDevOpen(true)}>Thiết bị</Button>
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({ open: true, session: null })}>Thêm lượt</Button>}
        <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
      </div>
      {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
      {isLoading && !data ? <Skeleton active paragraph={{ rows: 8 }} /> : data && (
        <>
          <div className="rp-stats three">
            <Stat label="Nhân viên" value={summary.length} sub={`${data.meta.total} lượt`} />
            <Stat label="Tổng giờ công" value={fmtHours(totalMinutes)} tone="blue" />
            <Stat label="Đang trong ca" value={openCount} tone={openCount ? 'pos' : undefined} sub="trang hiện tại" />
          </div>
          <div className="rp-grid2">
            <Card size="small" title="Giờ công theo nhân viên" className="rp-chart-card">
              {summary.length === 0 ? <div className="muted">Không có dữ liệu</div> : <HBarChart rows={summary.slice(0, 10).map((s) => ({ key: s.userId, name: s.name, sub: `${s.sessions} lượt`, value: s.minutes, display: fmtHours(s.minutes) }))} onPick={(k) => { setUserId(userId === k ? undefined : k); setPage(1); }} />}
              {summary.length > 10 && <div className="rp-table-note">Hiển thị 10 người nhiều giờ nhất · chạm vào thanh để lọc</div>}
            </Card>
            <Card size="small" title="Lượt chấm công">
              {rows.length === 0 ? <Empty description="Không có lượt chấm công" /> : isMobile ? (
                <>
                  <div className="em-sessions">{rows.map((a) => <SessionCard key={a.id} a={a} who={a.user?.fullName} branchName={branchName(a.branchId)} onEdit={canManage ? () => setModal({ open: true, session: a }) : undefined} />)}</div>
                  <CardPager page={page} pageSize={30} total={data.meta.total} onChange={(p) => setPage(p)} />
                </>
              ) : (
                <Table<Attendance> size="small" rowKey="id" dataSource={rows} scroll={{ x: 920 }} pagination={{ current: page, pageSize: 30, total: data.meta.total, onChange: setPage, showTotal: (t) => `${t} lượt` }}
                  columns={[
                    { title: 'Nhân viên', width: 160, render: (_, a) => <b>{a.user?.fullName ?? '—'}</b> },
                    { title: 'Ngày', dataIndex: 'checkInAt', width: 110, render: (v) => dayLabel(v) },
                    { title: 'Vào', dataIndex: 'checkInAt', width: 70, render: (v) => dt(v, 'HH:mm') },
                    { title: 'Ra', dataIndex: 'checkOutAt', width: 90, render: (v) => v ? dt(v, 'HH:mm') : <Tag color="green">Đang mở</Tag> },
                    { title: 'Ca', width: 160, render: (_, a) => shiftCell(a) },
                    { title: 'Giờ công', dataIndex: 'minutes', className: 'num', width: 100, render: (_, a) => <MinutesCell a={a} /> },
                    { title: 'Chi nhánh', dataIndex: 'branchId', width: 140, render: (v) => branchName(v) ?? '—' },
                    { title: 'Vị trí', width: 130, render: (_, a) => <GeoCell a={a} /> },
                    { title: 'Nguồn', dataIndex: 'source', width: 110, render: (v) => <Tag color={v === 'MANUAL' ? 'gold' : 'default'}>{ATTENDANCE_SOURCE_LABEL[v] ?? v}</Tag> },
                    { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (v) => v || <span className="muted">—</span> },
                    ...(canManage ? [{ title: '', width: 50, render: (_: unknown, a: Attendance) => <Button size="small" type="link" icon={<EditOutlined />} onClick={() => setModal({ open: true, session: a })} /> }] : []),
                  ]} />
              )}
            </Card>
          </div>
        </>
      )}
      <SessionModal open={modal.open} session={modal.session} defaultUserId={userId} defaultBranchId={branchId} onClose={() => setModal({ open: false })} />
      <DevicesDrawer open={devOpen} onClose={() => setDevOpen(false)} canManage={canManage} />
      <ShiftsDrawer open={shiftsOpen} onClose={() => setShiftsOpen(false)} canManage={canManage} />
    </>
  );
}

/** Edit an existing session (times + note) or add a manual one (employee.manage, BR-151). */
function SessionModal({ open, session, defaultUserId, defaultBranchId, onClose }: { open: boolean; session?: Attendance | null; defaultUserId?: string; defaultBranchId?: string; onClose: () => void }) {
  const { message } = App.useApp();
  const me = useAuthStore((s) => s.me);
  const invalidate = useInvalidateEmployees();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const isEdit = !!session;
  const { data: shifts } = useWorkShifts(true, open);
  // ca: tự nhận theo giờ vào (chỉ khi thêm) / không theo ca / một ca cụ thể
  const AUTO = '__auto'; const NONE = '__none';
  const shiftOptions = [
    ...(isEdit ? [] : [{ value: AUTO, label: 'Tự nhận theo giờ vào' }]),
    { value: NONE, label: 'Không theo ca (tính cả lượt)' },
    ...(shifts ?? []).filter((x) => x.isActive !== false || x.id === session?.workShiftId).map((x) => ({ value: x.id, label: `${shiftLabel(x)}${x.isActive === false ? ' (ngừng dùng)' : ''}` })),
  ];
  const toShiftId = (v?: string) => (v === AUTO || v === undefined ? undefined : v === NONE ? null : v);
  useEffect(() => {
    if (!open) return;
    if (session) form.setFieldsValue({ userId: session.userId, branchId: session.branchId ?? undefined, checkInAt: dayjs(session.checkInAt), checkOutAt: session.checkOutAt ? dayjs(session.checkOutAt) : undefined, note: session.note ?? undefined, shift: session.workShiftId ?? NONE });
    else { form.resetFields(); form.setFieldsValue({ userId: defaultUserId, branchId: defaultBranchId ?? me?.branches[0]?.id, checkInAt: dayjs().startOf('hour'), checkOutAt: undefined, shift: AUTO }); }
  }, [open, session]);
  const save = async () => {
    const v = await form.validateFields();
    if (v.checkOutAt && dayjs(v.checkOutAt).isBefore(dayjs(v.checkInAt))) { message.warning('Giờ ra phải sau giờ vào'); return; }
    setSaving(true);
    try {
      const shift = toShiftId(v.shift);
      if (session) await employeesApi.editAttendance(session.id, { checkInAt: dayjs(v.checkInAt).toISOString(), checkOutAt: v.checkOutAt ? dayjs(v.checkOutAt).toISOString() : null, note: v.note?.trim() || undefined, ...(shift !== (session.workShiftId ?? null) ? { workShiftId: shift ?? null } : {}) });
      else await employeesApi.manualAttendance({ userId: v.userId, branchId: v.branchId || undefined, checkInAt: dayjs(v.checkInAt).toISOString(), checkOutAt: v.checkOutAt ? dayjs(v.checkOutAt).toISOString() : undefined, note: v.note?.trim() || undefined, ...(shift !== undefined ? { workShiftId: shift } : {}) });
      message.success(session ? 'Đã cập nhật lượt chấm công' : 'Đã thêm lượt chấm công');
      invalidate(); onClose();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={isEdit ? `Sửa lượt chấm công · ${session?.user?.fullName ?? ''}` : 'Thêm lượt chấm công'} open={open} onCancel={onClose} onOk={save} okText="Lưu" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      <Form form={form} layout="vertical">
        {!isEdit && <Form.Item name="userId" label="Nhân viên" rules={[{ required: true, message: 'Chọn nhân viên' }]}><EmployeeSelect onChange={() => undefined} allowClear={false} placeholder="Chọn nhân viên" /></Form.Item>}
        {!isEdit && <Form.Item name="branchId" label="Chi nhánh"><Select allowClear placeholder="Không gắn chi nhánh" options={(me?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} /></Form.Item>}
        <div className="em-form-row">
          <Form.Item name="checkInAt" label="Giờ vào" rules={[{ required: true, message: 'Nhập giờ vào' }]}><DateTimeInput /></Form.Item>
          <Form.Item name="checkOutAt" label="Giờ ra" tooltip="Bỏ trống = lượt đang mở"><DateTimeInput /></Form.Item>
        </div>
        <Form.Item name="shift" label="Ca làm việc" extra="Giờ công chỉ tính trong giờ ca (vào sớm tính từ giờ vào ca, ra muộn tính đến giờ hết ca)."><Select options={shiftOptions} /></Form.Item>
        <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} maxLength={500} placeholder={isEdit ? 'Lý do sửa giờ' : 'Quên chấm công, làm bù…'} /></Form.Item>
        {isEdit && <div className="kv-hint">Nguồn: {ATTENDANCE_SOURCE_LABEL[session!.source] ?? session!.source} · người sửa được ghi vào nhật ký hệ thống.</div>}
      </Form>
    </Modal>
  );
}

/**
 * Ca làm việc (BR-187) + chấm công trong bán kính cửa hàng: bật / tắt "chỉ chấm trong bán kính" (cấu hình chung), thêm / sửa / ngừng / xóa ca.
 * Giờ công chỉ tính trong giờ ca: chấm vào trước giờ vào ca tính từ giờ vào ca, chấm ra sau giờ hết ca tính đến giờ hết ca.
 */
function ShiftsDrawer({ open, onClose, canManage }: { open: boolean; onClose: () => void; canManage: boolean }) {
  const { message, modal } = App.useApp();
  const isMobile = useIsMobile();
  const can = useCan();
  const me = useAuthStore((s) => s.me);
  const qc = useQueryClient();
  const invalidate = useInvalidateEmployees();
  const canSettings = can('tenant.settings.manage');
  const { data: shifts, isLoading } = useWorkShifts(true, open);
  const settings = useQuery({ queryKey: ['settings'], queryFn: orgApi.settings, enabled: open && canSettings });
  const { data: cur } = useAttendanceCurrent(open);
  const [edit, setEdit] = useState<WorkShift | 'new' | null>(null);
  const [savingGps, setSavingGps] = useState(false);
  const gps = canSettings ? settings.data?.['attendance.gpsRequired'] === true : !!cur?.policy?.gpsRequired;
  const setGps = async (v: boolean) => {
    setSavingGps(true);
    try { await orgApi.updateSettings({ 'attendance.gpsRequired': v }); message.success(v ? 'Đã bật: chỉ chấm công vào khi đứng trong bán kính cửa hàng' : 'Đã tắt kiểm tra bán kính'); await qc.invalidateQueries({ queryKey: ['settings'] }); invalidate(); } catch (e) { message.error(errMsg(e)); } finally { setSavingGps(false); }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); message.success(ok); invalidate(); } catch (e) { message.error(errMsg(e)); } };
  const remove = (x: WorkShift) => modal.confirm({
    title: `Xóa ${x.name}?`, content: x.used ? `Ca đã có ${x.used} lượt chấm công nên chỉ chuyển sang "Ngừng dùng" (giữ lịch sử).` : 'Ca chưa có lượt chấm công nào, sẽ xóa hẳn.',
    okText: x.used ? 'Ngừng dùng' : 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
    onOk: () => act(() => employeesApi.removeShift(x.id), x.used ? 'Đã ngừng dùng ca' : 'Đã xóa ca'),
  });
  const list = shifts ?? [];
  return (
    <Drawer title="Ca làm việc & bán kính chấm công" open={open} onClose={onClose} width={isMobile ? '100%' : 560}>
      <div className="em-sec-title">Chấm công tại cửa hàng</div>
      <div className="em-gps-row">
        <div className="tx">
          <b>Chỉ cho chấm công vào khi đứng trong bán kính cửa hàng</b>
          <div className="kv-hint">Điện thoại phải bật định vị; ở xa cửa hàng hoặc tắt định vị sẽ không chấm vào được. Chấm ra không bị chặn (chỉ ghi cờ).</div>
          <div className="em-gps-branches">
            {(cur?.branches ?? []).map((b) => <span key={b.id} className={b.hasGeo ? '' : 'warn'}><EnvironmentOutlined /> {b.name}: {b.hasGeo ? `bán kính ${b.radius} m` : 'chưa có tọa độ – vào Thiết lập → Chi nhánh bấm "Lấy vị trí hiện tại" tại cửa hàng'}</span>)}
          </div>
        </div>
        <Switch checked={gps} loading={savingGps || (canSettings && settings.isLoading)} disabled={!canSettings} onChange={(v) => void setGps(v)} />
      </div>
      {!canSettings && <div className="kv-hint">Cần quyền "Thiết lập cửa hàng" để đổi.</div>}

      <div className="em-sec-title with-btn">
        <span>Ca làm việc</span>
        {canManage && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setEdit('new')}>Thêm ca</Button>}
      </div>
      <div className="kv-hint" style={{ marginBottom: 8 }}>Giờ công chỉ tính trong giờ ca: chấm vào trước giờ vào ca vẫn tính từ giờ vào ca, chấm ra sau giờ hết ca chỉ tính đến giờ hết ca (VD ca hết 22:00, chấm ra 23:00 → tính đến 22:00). Khi chấm vào, ca được gợi ý theo giờ, nhân viên đổi được nếu cần.</div>
      {isLoading ? <Skeleton active /> : list.length === 0 ? <Empty description="Chưa có ca nào – giờ công đang tính theo giờ chấm thật" /> : (
        <div className="em-shifts">
          {list.map((x) => (
            <div key={x.id} className={`em-shift${x.isActive === false ? ' off' : ''}`}>
              <div className="main">
                <b>{x.name}</b>
                <span className="tm">{x.start} → {x.end}{x.endMinute <= x.startMinute ? ' (hôm sau)' : ''}</span>
                <span className="meta">{x.branch?.name ?? 'Mọi chi nhánh'} · {x.used ?? 0} lượt chấm công{x.isActive === false ? ' · Ngừng dùng' : ''}</span>
              </div>
              {canManage && (
                <div className="acts">
                  <Switch size="small" checked={x.isActive !== false} onChange={(v) => void act(() => employeesApi.updateShift(x.id, { isActive: v }), v ? 'Đã bật lại ca' : 'Đã ngừng dùng ca')} />
                  <Button size="small" type="text" icon={<EditOutlined />} aria-label="Sửa" onClick={() => setEdit(x)} />
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Xóa" onClick={() => remove(x)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ShiftModal shift={edit} branches={me?.branches ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); invalidate(); }} />
    </Drawer>
  );
}

function ShiftModal({ shift, branches, onClose, onSaved }: { shift: WorkShift | 'new' | null; branches: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ name: string; start: string; end: string; branchId?: string }>();
  const [saving, setSaving] = useState(false);
  const open = shift !== null;
  const cur = shift && shift !== 'new' ? shift : null;
  const start = Form.useWatch('start', form);
  const end = Form.useWatch('end', form);
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(cur ? { name: cur.name, start: cur.start, end: cur.end, branchId: cur.branchId ?? undefined } : { name: '', start: '07:00', end: '14:00', branchId: undefined });
  }, [shift]);
  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body = { name: v.name.trim(), start: v.start, end: v.end, branchId: v.branchId ?? null };
      if (cur) await employeesApi.updateShift(cur.id, body); else await employeesApi.createShift(body);
      message.success(cur ? 'Đã lưu ca' : 'Đã thêm ca'); onSaved();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const overnight = !!start && !!end && end < start;
  return (
    <Modal title={cur ? `Sửa ${cur.name}` : 'Thêm ca làm việc'} open={open} onCancel={onClose} onOk={save} okText="Lưu" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="name" label="Tên ca" rules={[{ required: true, whitespace: true, message: 'Nhập tên ca' }]}><Input maxLength={100} placeholder="Ca sáng, Ca chiều, Ca gãy…" /></Form.Item>
        <div className="em-form-row">
          <Form.Item name="start" label="Giờ vào ca" rules={[{ required: true, message: 'Chọn giờ vào ca' }]}><Input type="time" step={300} /></Form.Item>
          <Form.Item name="end" label="Giờ hết ca" rules={[{ required: true, message: 'Chọn giờ hết ca' }, { validator: (_, v) => (v && v === form.getFieldValue('start') ? Promise.reject(new Error('Trùng giờ vào ca')) : Promise.resolve()) }]}><Input type="time" step={300} /></Form.Item>
        </div>
        {overnight && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Ca qua đêm: vào ${start}, hết ca ${end} sáng hôm sau.`} />}
        {branches.length > 1 && <Form.Item name="branchId" label="Chi nhánh"><Select allowClear placeholder="Mọi chi nhánh" options={branches.map((b) => ({ value: b.id, label: b.name }))} /></Form.Item>}
        {cur && <div className="kv-hint">Đổi giờ ca chỉ áp dụng cho lượt chấm công từ nay; lượt đã chấm giữ giờ ca cũ.</div>}
      </Form>
    </Modal>
  );
}
