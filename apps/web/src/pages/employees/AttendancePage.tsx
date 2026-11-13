import { Alert, App, Button, Card, Drawer, Empty, Form, Input, InputNumber, Modal, Segmented, Select, Skeleton, Switch, Tabs, Tag, Tooltip } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ClockCircleOutlined, DeleteOutlined, EditOutlined, EnvironmentOutlined, LoginOutlined, LogoutOutlined, MobileOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, ScheduleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_FLAG_LABEL, ATTENDANCE_SOURCE_LABEL, Attendance, DEVICE_STATUS_LABEL, LatePolicy, WorkShift, attendanceDeviceId, attendanceDeviceName, employeesApi, fmtHours, fmtMinutes, lateOf, shiftLabel, useAttendance, useAttendanceCurrent, useAttendanceDevices, useLatePolicy, useMyAttendance, useWorkShifts } from '../../api/employees';
import { errMsg, normalizeError } from '../../api/client';
import { orgApi } from '../../api/org';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money, moneyFormatter, moneyParser } from '../../utils/format';
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
const vnd = (v: unknown) => `${money(v)}đ`;
/** Đi trễ của lượt: "Trễ 12p" + tiền phạt; đúng giờ / trong thời gian cho phép → "Đúng giờ"; không theo ca → —. */
function LateCell({ a }: { a: Attendance }) {
  if (a.lateMinutes === null || a.lateMinutes === undefined) return <span className="muted">—</span>;
  if (!a.lateMinutes) return <span className="em-ontime">Đúng giờ</span>;
  const p = Number(a.latePenalty ?? 0);
  return <span className="em-late-cell"><Tag color="red">Trễ {fmtMinutes(a.lateMinutes)}</Tag>{p > 0 ? <small>phạt {vnd(p)}</small> : <small className="muted">không phạt</small>}</span>;
}
/** Khung giờ của ca gần lúc này nhất (giờ máy) – để hiện "sắp vào ca / đang trong giờ ca / đã hết ca" khi chọn ca. */
function nearestWindow(s: { startMinute: number; endMinute: number }, now: Date) {
  const len = (((s.endMinute - s.startMinute) % 1440) + 1440) % 1440 || 1440;
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  return [-1, 0, 1].map((d) => { const start = new Date(day0.getTime() + d * 86_400_000 + s.startMinute * 60_000); return { start, end: new Date(start.getTime() + len * 60_000) }; })
    .sort((x, y) => Math.abs(x.start.getTime() - now.getTime()) - Math.abs(y.start.getTime() - now.getTime()))[0];
}

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
  const [tab, setTab] = useUrlTab(['me', 'all', 'setup'] as const, 'me');
  const active = canAll && (tab === 'all' || tab === 'setup') ? tab : 'me';
  return (
    <div className="em-page">
      <h1 className="kv-page-title">Chấm công</h1>
      {canAll ? (
        <Tabs activeKey={active} onChange={(k) => setTab(k as 'me' | 'all' | 'setup')} items={[
          { key: 'me', label: 'Của tôi', children: <MyTab /> },
          { key: 'all', label: 'Toàn bộ nhân viên', children: <AllTab /> },
          { key: 'setup', label: 'Thiết lập ca làm', children: <SetupTab canManage={can('employee.manage')} /> },
        ]} />
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
  const [picker, setPicker] = useState(false);
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
  // ca làm: bấm Chấm công vào → hiện các ca của chi nhánh để nhân viên chọn (ca gợi ý theo giờ hiện tại đứng đầu)
  const shiftOpts = branchGeo?.shifts ?? [];
  const locate = (required: boolean) => new Promise<{ latitude: number; longitude: number; accuracy: number } | undefined>((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return required ? reject(new Error('Trình duyệt không hỗ trợ định vị – dùng Chrome / Safari trên điện thoại')) : resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) => (required ? reject(new Error(err.code === 1 ? 'Bạn chưa cho phép trình duyệt dùng vị trí – bật định vị cho trang này rồi thử lại' : 'Không lấy được vị trí – bật GPS, ra chỗ thoáng rồi thử lại')) : resolve(undefined)),
      { enableHighAccuracy: true, timeout: required ? 15000 : 5000, maximumAge: 0 },
    );
  });
  const checkIn = async (workShiftId?: string | null) => {
    setBusy(true);
    try {
      setLocating(true);
      const pos = await locate(needGps).finally(() => setLocating(false));
      const a = await employeesApi.checkIn({ branchId: branch, note: note.trim() || undefined, ...(pos ?? {}), deviceId, deviceName: attendanceDeviceName(), workShiftId });
      setPicker(false);
      const parts = [`Đã chấm công vào${a.workShift ? ` ${a.workShift.name}` : ''} lúc ${dt(a.checkInAt, 'HH:mm')}`];
      if (a.lateMinutes) parts.push(`trễ ${fmtMinutes(a.lateMinutes)}${Number(a.latePenalty ?? 0) > 0 ? ` · phạt ${vnd(a.latePenalty)}` : ''}`);
      if (a.distanceMeters !== null && a.distanceMeters !== undefined) parts.push(`cách cửa hàng ${a.distanceMeters} m`);
      (a.lateMinutes ? message.warning : message.success)({ content: parts.join(' · '), duration: 5 });
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
              {!!open.lateMinutes && <div className="em-late-line">Đi trễ {fmtMinutes(open.lateMinutes)}{Number(open.latePenalty ?? 0) > 0 ? ` · phạt ${vnd(open.latePenalty)}` : ''}</div>}
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
                <Input placeholder="Ghi chú (ca sáng, đổi ca…)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </div>
              <div className="em-policy">
                {shiftOpts.length > 0 && <span><ScheduleOutlined /> Bấm Chấm công vào rồi chọn ca làm ({shiftOpts.length} ca){cur?.latePolicy?.enabled ? ` · trễ quá ${cur.latePolicy.graceMinutes} phút bị phạt` : ''}</span>}
                <span className={needGps ? 'need' : ''}><EnvironmentOutlined /> {needGps ? `Phải đứng trong bán kính ${branchGeo?.radius ?? ''} m của ${branchGeo?.name ?? 'chi nhánh'} – điện thoại cần bật định vị` : 'Vị trí được gửi kèm khi điện thoại cho phép'}</span>
                {cur?.device ? <span className={`dev ${cur.device.status.toLowerCase()}`}><MobileOutlined /> Thiết bị này: {DEVICE_STATUS_LABEL[cur.device.status] ?? cur.device.status}{cur.device.name ? ` · ${cur.device.name}` : ''}</span>
                  : cur?.policy?.deviceLock ? <span className="dev"><SafetyCertificateOutlined /> Thiết bị này sẽ được đăng ký cho bạn ở lần chấm công đầu tiên</span> : null}
              </div>
              <Button className="em-clock-btn in" size="large" icon={<LoginOutlined />} loading={busy && !picker} onClick={() => (shiftOpts.length ? setPicker(true) : void checkIn())}>{locating && !picker ? 'ĐANG LẤY VỊ TRÍ…' : 'CHẤM CÔNG VÀO'}</Button>
              <ShiftPicker open={picker} shifts={shiftOpts} suggestedId={branchGeo?.suggestedShiftId ?? null} policy={cur?.latePolicy} busy={busy} locating={locating} onPick={(id) => void checkIn(id)} onClose={() => setPicker(false)} />
            </>
          )}
        </div>
      )}
      {cur && (
        <div className="rp-stats three">
          <Stat label="Lượt tháng này" value={cur.monthDays} />
          <Stat label="Giờ công tháng này" value={fmtHours(cur.monthMinutes)} tone="blue" sub={open ? 'chưa tính ca đang mở' : undefined} />
          <Stat label="Đi trễ tháng này" value={`${cur.monthLate ?? 0} lần`} tone={cur.monthLate ? 'neg' : undefined} sub={cur.monthLatePenalty ? `phạt ${vnd(cur.monthLatePenalty)}` : undefined} />
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
          <Table<Attendance> size="small" rowKey="id" dataSource={rows} scroll={{ x: 1100 }} pagination={{ current: page, pageSize: 20, total: hist.data?.meta.total ?? 0, onChange: setPage, showTotal: (t) => `${t} lượt` }}
            columns={[
              { title: 'Ngày', dataIndex: 'checkInAt', width: 120, render: (v) => <b>{dayLabel(v)}</b> },
              { title: 'Vào', dataIndex: 'checkInAt', width: 80, render: (v) => dt(v, 'HH:mm') },
              { title: 'Ra', dataIndex: 'checkOutAt', width: 80, render: (v) => v ? dt(v, 'HH:mm') : <Tag color="green">Đang mở</Tag> },
              { title: 'Ca', width: 170, render: (_, a) => shiftCell(a) },
              { title: 'Giờ công', dataIndex: 'minutes', className: 'num', width: 110, render: (_, a) => <MinutesCell a={a} /> },
              { title: 'Đi trễ', width: 120, render: (_, a) => <LateCell a={a} /> },
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
      <div className="meta">{!!a.lateMinutes && <LateCell a={a} />}{branchName && <span>{branchName}</span>}<Tag color={a.source === 'MANUAL' ? 'gold' : 'default'}>{ATTENDANCE_SOURCE_LABEL[a.source] ?? a.source}</Tag>{a.note && <span>{a.note}</span>}</div>
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
  const q = { ...periodParams(range), userId, branchId, open: openOnly ? ('true' as const) : undefined, page, pageSize: 30 };
  const { data, isLoading, isFetching, error, refetch } = useAttendance(q);
  const branchName = (id?: string | null) => me?.branches.find((b) => b.id === id)?.name;
  const rows = data?.data ?? [];
  const summary = [...(data?.summary ?? [])].sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = summary.reduce((s, x) => s + x.minutes, 0);
  const openCount = rows.filter((r) => !r.checkOutAt).length;
  const lateCount = summary.reduce((s, x) => s + (x.lateCount ?? 0), 0);
  const latePenalty = summary.reduce((s, x) => s + (x.latePenalty ?? 0), 0);
  return (
    <>
      <div className="em-toolbar">
        <DateRangeBar value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        <div className="em-w"><EmployeeSelect value={userId} onChange={(v) => { setUserId(v); setPage(1); }} /></div>
        <div className="em-w"><BranchSelect value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} /></div>
        <span className="rp-switch"><Switch size="small" checked={openOnly} onChange={(v) => { setOpenOnly(v); setPage(1); }} /> Chỉ lượt đang mở</span>
        <span style={{ flex: 1 }} />
        <Button icon={<MobileOutlined />} onClick={() => setDevOpen(true)}>Thiết bị</Button>
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({ open: true, session: null })}>Thêm lượt</Button>}
        <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
      </div>
      {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
      {isLoading && !data ? <Skeleton active paragraph={{ rows: 8 }} /> : data && (
        <>
          <div className="rp-stats">
            <Stat label="Nhân viên" value={summary.length} sub={`${data.meta.total} lượt`} />
            <Stat label="Tổng giờ công" value={fmtHours(totalMinutes)} tone="blue" />
            <Stat label="Đi trễ" value={`${lateCount} lần`} tone={lateCount ? 'neg' : undefined} sub={latePenalty ? `phạt ${vnd(latePenalty)}` : undefined} />
            <Stat label="Đang trong ca" value={openCount} tone={openCount ? 'pos' : undefined} sub="trang hiện tại" />
          </div>
          <div className="rp-grid2">
            <Card size="small" title="Giờ công theo nhân viên" className="rp-chart-card">
              {summary.length === 0 ? <div className="muted">Không có dữ liệu</div> : <HBarChart rows={summary.slice(0, 10).map((s) => ({ key: s.userId, name: s.name, sub: `${s.sessions} lượt${s.lateCount ? ` · trễ ${s.lateCount} lần` : ''}`, value: s.minutes, display: fmtHours(s.minutes) }))} onPick={(k) => { setUserId(userId === k ? undefined : k); setPage(1); }} />}
              {summary.length > 10 && <div className="rp-table-note">Hiển thị 10 người nhiều giờ nhất · chạm vào thanh để lọc</div>}
            </Card>
            <Card size="small" title="Lượt chấm công">
              {rows.length === 0 ? <Empty description="Không có lượt chấm công" /> : isMobile ? (
                <>
                  <div className="em-sessions">{rows.map((a) => <SessionCard key={a.id} a={a} who={a.user?.fullName} branchName={branchName(a.branchId)} onEdit={canManage ? () => setModal({ open: true, session: a }) : undefined} />)}</div>
                  <CardPager page={page} pageSize={30} total={data.meta.total} onChange={(p) => setPage(p)} />
                </>
              ) : (
                <Table<Attendance> size="small" rowKey="id" dataSource={rows} scroll={{ x: 1040 }} pagination={{ current: page, pageSize: 30, total: data.meta.total, onChange: setPage, showTotal: (t) => `${t} lượt` }}
                  columns={[
                    { title: 'Nhân viên', width: 160, render: (_, a) => <b>{a.user?.fullName ?? '—'}</b> },
                    { title: 'Ngày', dataIndex: 'checkInAt', width: 110, render: (v) => dayLabel(v) },
                    { title: 'Vào', dataIndex: 'checkInAt', width: 70, render: (v) => dt(v, 'HH:mm') },
                    { title: 'Ra', dataIndex: 'checkOutAt', width: 90, render: (v) => v ? dt(v, 'HH:mm') : <Tag color="green">Đang mở</Tag> },
                    { title: 'Ca', width: 160, render: (_, a) => shiftCell(a) },
                    { title: 'Giờ công', dataIndex: 'minutes', className: 'num', width: 100, render: (_, a) => <MinutesCell a={a} /> },
                    { title: 'Đi trễ', width: 120, render: (_, a) => <LateCell a={a} /> },
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
    if (session) form.setFieldsValue({ userId: session.userId, branchId: session.branchId ?? undefined, checkInAt: dayjs(session.checkInAt), checkOutAt: session.checkOutAt ? dayjs(session.checkOutAt) : undefined, note: session.note ?? undefined, shift: session.workShiftId ?? NONE, latePenalty: session.latePenalty === null || session.latePenalty === undefined ? undefined : Number(session.latePenalty) });
    else { form.resetFields(); form.setFieldsValue({ userId: defaultUserId, branchId: defaultBranchId ?? me?.branches[0]?.id, checkInAt: dayjs().startOf('hour'), checkOutAt: undefined, shift: AUTO }); }
  }, [open, session]);
  const save = async () => {
    const v = await form.validateFields();
    if (v.checkOutAt && dayjs(v.checkOutAt).isBefore(dayjs(v.checkInAt))) { message.warning('Giờ ra phải sau giờ vào'); return; }
    setSaving(true);
    try {
      const shift = toShiftId(v.shift);
      const penaltyChanged = session && session.lateMinutes !== null && session.lateMinutes !== undefined && typeof v.latePenalty === 'number' && v.latePenalty !== Number(session.latePenalty ?? 0);
      if (session) await employeesApi.editAttendance(session.id, { checkInAt: dayjs(v.checkInAt).toISOString(), checkOutAt: v.checkOutAt ? dayjs(v.checkOutAt).toISOString() : null, note: v.note?.trim() || undefined, ...(shift !== (session.workShiftId ?? null) ? { workShiftId: shift ?? null } : {}), ...(penaltyChanged ? { latePenalty: v.latePenalty } : {}) });
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
        {isEdit && !!session?.lateMinutes && (
          <Form.Item name="latePenalty" label={`Tiền phạt đi trễ (trễ ${fmtMinutes(session.lateMinutes)})`} extra="Đặt 0 để miễn phạt. Đổi giờ vào hoặc ca thì hệ thống tự tính lại theo cấu hình phạt.">
            <InputNumber min={0} step={10000} style={{ width: '100%' }} formatter={moneyFormatter} parser={moneyParser} addonAfter="đ" />
          </Form.Item>
        )}
        <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} maxLength={500} placeholder={isEdit ? 'Lý do sửa giờ' : 'Quên chấm công, làm bù…'} /></Form.Item>
        {isEdit && <div className="kv-hint">Nguồn: {ATTENDANCE_SOURCE_LABEL[session!.source] ?? session!.source} · người sửa được ghi vào nhật ký hệ thống.</div>}
      </Form>
    </Modal>
  );
}

/** Chọn ca khi chấm công vào: mỗi ca một thẻ (giờ ca, đúng giờ / trễ … phút + tiền phạt dự kiến / sắp vào ca / đã hết ca); ca gợi ý đứng đầu. */
function ShiftPicker({ open, shifts, suggestedId, policy, busy, locating, onPick, onClose }: { open: boolean; shifts: WorkShift[]; suggestedId: string | null; policy?: LatePolicy; busy: boolean; locating: boolean; onPick: (id: string | null) => void; onClose: () => void }) {
  const [now, setNow] = useState(() => new Date());
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (!open) return; setNow(new Date()); setPicked(undefined); const h = window.setInterval(() => setNow(new Date()), 15_000); return () => window.clearInterval(h); }, [open]);
  const list = [...shifts].map((x) => ({ x, w: nearestWindow(x, now) })).sort((a, b) => Number(b.x.id === suggestedId) - Number(a.x.id === suggestedId) || a.w.start.getTime() - b.w.start.getTime());
  const pick = (id: string | null) => { setPicked(id); onPick(id); };
  return (
    <Modal title="Chọn ca làm" open={open} onCancel={busy ? undefined : onClose} footer={null} centered destroyOnClose width={460} className="em-picker-modal">
      <div className="em-picker">
        {list.map(({ x, w }) => {
          const mins = Math.floor((now.getTime() - w.start.getTime()) / 60_000);
          const ended = now >= w.end;
          const l = mins > 0 && !ended ? lateOf(mins, policy) : { late: 0, penalty: 0 };
          const status = ended ? { cls: 'ended', text: 'Đã hết ca' }
            : mins < 0 ? { cls: 'early', text: `Vào ca lúc ${dt(w.start.toISOString(), 'HH:mm')} · còn ${fmtMinutes(-mins)}` }
            : l.late > 0 ? { cls: 'late', text: `Trễ ${fmtMinutes(l.late)}${l.penalty > 0 ? ` · phạt ${vnd(l.penalty)}` : ''}` }
            : { cls: 'ok', text: mins > 0 ? `Trễ ${mins} phút – trong thời gian cho phép` : 'Đúng giờ' };
          const loading = busy && picked === x.id;
          return (
            <button key={x.id} type="button" className={`em-pick${x.id === suggestedId ? ' sug' : ''}`} disabled={busy} onClick={() => pick(x.id)}>
              <span className="top"><b>{x.name}</b>{x.id === suggestedId && <Tag color="blue">Gợi ý</Tag>}</span>
              <span className="tm">{x.start} → {x.end}{x.endMinute <= x.startMinute ? ' (hôm sau)' : ''}</span>
              <span className={`stt ${status.cls}`}>{loading ? (locating ? 'Đang lấy vị trí…' : 'Đang chấm công…') : status.text}</span>
            </button>
          );
        })}
        <button type="button" className="em-pick off" disabled={busy} onClick={() => pick(null)}>
          <span className="top"><b>Chấm ngoài ca</b></span>
          <span className="stt">{busy && picked === null ? 'Đang chấm công…' : 'Không thuộc ca nào – tính cả lượt, quản lý sẽ xem lại'}</span>
        </button>
      </div>
    </Modal>
  );
}

/**
 * Tab "Thiết lập ca làm" (quản lý): ca làm việc (BR-187), phạt đi trễ (BR-188), chấm công trong bán kính cửa hàng.
 * Người chỉ có quyền xem chấm công thấy cấu hình nhưng không sửa được.
 */
function SetupTab({ canManage }: { canManage: boolean }) {
  const { message, modal } = App.useApp();
  const can = useCan();
  const me = useAuthStore((s) => s.me);
  const qc = useQueryClient();
  const invalidate = useInvalidateEmployees();
  const canSettings = can('tenant.settings.manage');
  const { data: shifts, isLoading } = useWorkShifts(true);
  const settings = useQuery({ queryKey: ['settings'], queryFn: orgApi.settings, enabled: canSettings });
  const { data: cur } = useAttendanceCurrent(true);
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
    <div className="em-setup">
      <Card size="small" title={<><ScheduleOutlined /> Ca làm việc</>} extra={canManage && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setEdit('new')}>Thêm ca</Button>}>
        <div className="kv-hint" style={{ marginBottom: 8 }}>Nhân viên bấm Chấm công vào sẽ thấy các ca dưới đây để chọn. Giờ công chỉ tính trong giờ ca: chấm vào trước giờ vào ca vẫn tính từ giờ vào ca, chấm ra sau giờ hết ca chỉ tính đến giờ hết ca (VD ca hết 22:00, chấm ra 23:00 → tính đến 22:00).</div>
        {isLoading ? <Skeleton active /> : list.length === 0 ? <Empty description="Chưa có ca nào – bấm Thêm ca (VD Ca sáng 07:30–14:00, Ca chiều 14:00–22:00)" /> : (
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
      </Card>

      <LatePolicyCard canManage={canManage} />

      <Card size="small" title={<><EnvironmentOutlined /> Chấm công tại cửa hàng</>}>
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
        {!canSettings && <div className="kv-hint" style={{ marginTop: 6 }}>Cần quyền "Thiết lập cửa hàng" để đổi.</div>}
      </Card>
      <ShiftModal shift={edit} branches={me?.branches ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); invalidate(); }} />
    </div>
  );
}

/** Cấu hình phạt đi trễ (BR-188): bật / tắt, cho phép trễ (phút), phạt theo mức trễ hoặc theo phút; xem trước ví dụ. */
function LatePolicyCard({ canManage }: { canManage: boolean }) {
  const { message } = App.useApp();
  const invalidate = useInvalidateEmployees();
  const { data, isLoading } = useLatePolicy();
  const [p, setP] = useState<LatePolicy | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setP(data); }, [data]);
  const dirty = !!data && !!p && JSON.stringify(data) !== JSON.stringify(p);
  const set = (patch: Partial<LatePolicy>) => setP((x) => (x ? { ...x, ...patch } : x));
  const setTier = (i: number, patch: Partial<LatePolicy['tiers'][number]>) => setP((x) => (x ? { ...x, tiers: x.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) } : x));
  const save = async () => {
    if (!p) return;
    setSaving(true);
    try { const r = await employeesApi.saveLatePolicy(p); setP(r); message.success('Đã lưu cấu hình phạt đi trễ'); invalidate(); } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };
  const ro = !canManage;
  const samples = p ? [p.graceMinutes, p.graceMinutes + 5, 15, 30, 60].filter((v, i, a) => v > 0 && a.indexOf(v) === i).sort((a, b) => a - b) : [];
  return (
    <Card size="small" title={<><ClockCircleOutlined /> Phạt đi trễ {dirty && <Tag color="orange">Chưa lưu</Tag>}</>} extra={canManage && <Button size="small" type="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>Lưu</Button>}>
      {isLoading || !p ? <Skeleton active /> : (
        <div className="em-late-form">
          <div className="em-gps-row">
            <div className="tx"><b>Bật phạt đi trễ</b><div className="kv-hint">Đi trễ tính theo giờ vào của ca nhân viên chọn khi chấm công. Tắt phạt vẫn ghi số phút trễ để theo dõi.</div></div>
            <Switch checked={p.enabled} disabled={ro} onChange={(v) => set({ enabled: v })} />
          </div>
          <label className="em-field"><span>Cho phép trễ</span><InputNumber min={0} max={240} value={p.graceMinutes} disabled={ro} onChange={(v) => set({ graceMinutes: Number(v ?? 0) })} addonAfter="phút" style={{ width: 160 }} /><small>Trễ quá số phút này mới tính là đi trễ</small></label>
          <Segmented block value={p.mode} disabled={ro} onChange={(v) => set({ mode: v as LatePolicy['mode'] })} options={[{ value: 'TIERS', label: 'Phạt theo mức trễ' }, { value: 'PER_MINUTE', label: 'Phạt theo phút' }]} />
          {p.mode === 'TIERS' ? (
            <div className="em-tiers">
              {p.tiers.map((t, i) => (
                <div key={i} className="em-tier">
                  <span>Trễ từ</span>
                  <InputNumber min={1} max={1440} value={t.fromMinutes} disabled={ro} onChange={(v) => setTier(i, { fromMinutes: Number(v ?? 1) })} addonAfter="phút" />
                  {!ro && <Button className="del" size="small" type="text" danger icon={<DeleteOutlined />} aria-label="Bỏ mức" onClick={() => set({ tiers: p.tiers.filter((_, j) => j !== i) })} />}
                  <span>Phạt</span>
                  <InputNumber min={0} step={10000} value={t.amount} disabled={ro} onChange={(v) => setTier(i, { amount: Number(v ?? 0) })} formatter={moneyFormatter} parser={moneyParser} addonAfter="đ" />
                </div>
              ))}
              {!ro && p.tiers.length < 10 && <Button size="small" icon={<PlusOutlined />} onClick={() => set({ tiers: [...p.tiers, { fromMinutes: (p.tiers[p.tiers.length - 1]?.fromMinutes ?? p.graceMinutes) + 15, amount: (p.tiers[p.tiers.length - 1]?.amount ?? 0) + 20000 }] })}>Thêm mức phạt</Button>}
              <div className="kv-hint">Trễ đạt nhiều mức thì lấy mức cao nhất.</div>
            </div>
          ) : (
            <label className="em-field"><span>Mỗi phút trễ phạt</span><InputNumber min={0} step={1000} value={p.perMinute} disabled={ro} onChange={(v) => set({ perMinute: Number(v ?? 0) })} formatter={moneyFormatter} parser={moneyParser} addonAfter="đ" style={{ width: 180 }} /><small>Tính từ giờ vào ca (VD trễ 12 phút × 1.000đ = 12.000đ)</small></label>
          )}
          <div className="em-late-sample">
            <b>Ví dụ:</b> {samples.map((m) => { const r = lateOf(m, { ...p, enabled: true }); return <span key={m}>trễ {m} phút → {r.late === 0 ? 'không tính trễ' : r.penalty > 0 ? vnd(r.penalty) : 'không phạt'}</span>; })}
            {!p.enabled && <em>(đang tắt phạt)</em>}
          </div>
        </div>
      )}
    </Card>
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
