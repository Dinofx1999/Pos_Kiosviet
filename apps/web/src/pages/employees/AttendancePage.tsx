import { Alert, App, Button, Card, Checkbox, Empty, Form, Input, Modal, Select, Skeleton, Switch, Tabs, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ClockCircleOutlined, EditOutlined, LoginOutlined, LogoutOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { ATTENDANCE_SOURCE_LABEL, Attendance, employeesApi, fmtHours, fmtMinutes, useAttendance, useAttendanceCurrent, useMyAttendance } from '../../api/employees';
import { errMsg, normalizeError } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt } from '../../utils/format';
import { BranchSelect, CardPager, DateRangeBar, HBarChart, Range, Stat, presetRange } from '../reports/ReportShared';
import { DateTimeInput, EmployeeSelect, periodParams, useInvalidateEmployees, useUrlTab, useUrlUserId } from './EmployeeShared';
import './employees.css';

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dayLabel = (v: string) => { const d = dayjs(v); return `${DAY_NAMES[d.day()]} ${d.format('DD/MM')}`; };

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
  const { data: cur, isLoading, error, refetch } = useAttendanceCurrent();
  const [note, setNote] = useState('');
  const [branch, setBranch] = useState<string | undefined>(branchId ?? undefined);
  const [geo, setGeo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [page, setPage] = useState(1);
  const hist = useMyAttendance({ ...periodParams(range), page, pageSize: 20 });
  useEffect(() => { setBranch(branchId ?? undefined); }, [branchId]);
  const branchName = (id?: string | null) => me?.branches.find((b) => b.id === id)?.name;

  const locate = () => new Promise<{ latitude: number; longitude: number } | undefined>((resolve) => {
    if (!geo || typeof navigator === 'undefined' || !navigator.geolocation) return resolve(undefined);
    const t = window.setTimeout(() => resolve(undefined), 4000);
    navigator.geolocation.getCurrentPosition((p) => { window.clearTimeout(t); resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }); }, () => { window.clearTimeout(t); resolve(undefined); }, { timeout: 4000, maximumAge: 60_000 });
  });
  const checkIn = async () => {
    setBusy(true);
    try {
      const pos = await locate();
      const a = await employeesApi.checkIn({ branchId: branch, note: note.trim() || undefined, ...(pos ?? {}) });
      message.success(`Đã chấm công vào lúc ${dt(a.checkInAt, 'HH:mm')}`);
      setNote(''); invalidate();
    } catch (e) { const err = normalizeError(e); if (err.code === 'ATTENDANCE_OPEN') { message.warning('Bạn đang trong ca – hãy chấm công ra trước'); void refetch(); } else message.error(err.message); } finally { setBusy(false); }
  };
  const checkOut = async () => {
    setBusy(true);
    try {
      const a = await employeesApi.checkOut({ note: note.trim() || undefined });
      message.success(`Đã chấm công ra · ${fmtMinutes(a.minutes)} trong ca`);
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
                <Checkbox className="em-geo" checked={geo} onChange={(e) => setGeo(e.target.checked)}>Gửi kèm vị trí (GPS) khi chấm công</Checkbox>
              </div>
              <Button className="em-clock-btn in" size="large" icon={<LoginOutlined />} loading={busy} onClick={checkIn}>CHẤM CÔNG VÀO</Button>
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
              { title: 'Thời lượng', dataIndex: 'minutes', className: 'num', width: 110, render: (v, a) => a.checkOutAt ? <b>{fmtMinutes(v)}</b> : '—' },
              { title: 'Chi nhánh', dataIndex: 'branchId', width: 160, render: (v) => branchName(v) ?? '—' },
              { title: 'Nguồn', dataIndex: 'source', width: 110, render: (v) => ATTENDANCE_SOURCE_LABEL[v] ?? v },
              { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, render: (v) => v || <span className="muted">—</span> },
            ]} />
        )}
      </Card>
    </>
  );
}

function SessionCard({ a, branchName, who, onEdit }: { a: Attendance; branchName?: string; who?: string; onEdit?: () => void }) {
  return (
    <div className="em-session">
      <div className="d">{who && <span className="who">{who} · </span>}{dayLabel(a.checkInAt)}</div>
      <div className="t">{dt(a.checkInAt, 'HH:mm')} → {a.checkOutAt ? dt(a.checkOutAt, 'HH:mm') : '…'}</div>
      <div className={`dur${a.checkOutAt ? '' : ' open'}`}>{a.checkOutAt ? fmtMinutes(a.minutes) : <><span className="em-open-dot" />Đang mở</>}</div>
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
                <Table<Attendance> size="small" rowKey="id" dataSource={rows} scroll={{ x: 760 }} pagination={{ current: page, pageSize: 30, total: data.meta.total, onChange: setPage, showTotal: (t) => `${t} lượt` }}
                  columns={[
                    { title: 'Nhân viên', width: 160, render: (_, a) => <b>{a.user?.fullName ?? '—'}</b> },
                    { title: 'Ngày', dataIndex: 'checkInAt', width: 110, render: (v) => dayLabel(v) },
                    { title: 'Vào', dataIndex: 'checkInAt', width: 70, render: (v) => dt(v, 'HH:mm') },
                    { title: 'Ra', dataIndex: 'checkOutAt', width: 90, render: (v) => v ? dt(v, 'HH:mm') : <Tag color="green">Đang mở</Tag> },
                    { title: 'Thời lượng', dataIndex: 'minutes', className: 'num', width: 100, render: (v, a) => a.checkOutAt ? <b>{fmtMinutes(v)}</b> : '—' },
                    { title: 'Chi nhánh', dataIndex: 'branchId', width: 140, render: (v) => branchName(v) ?? '—' },
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
  useEffect(() => {
    if (!open) return;
    if (session) form.setFieldsValue({ userId: session.userId, branchId: session.branchId ?? undefined, checkInAt: dayjs(session.checkInAt), checkOutAt: session.checkOutAt ? dayjs(session.checkOutAt) : undefined, note: session.note ?? undefined });
    else { form.resetFields(); form.setFieldsValue({ userId: defaultUserId, branchId: defaultBranchId ?? me?.branches[0]?.id, checkInAt: dayjs().startOf('hour'), checkOutAt: undefined }); }
  }, [open, session]);
  const save = async () => {
    const v = await form.validateFields();
    if (v.checkOutAt && dayjs(v.checkOutAt).isBefore(dayjs(v.checkInAt))) { message.warning('Giờ ra phải sau giờ vào'); return; }
    setSaving(true);
    try {
      if (session) await employeesApi.editAttendance(session.id, { checkInAt: dayjs(v.checkInAt).toISOString(), checkOutAt: v.checkOutAt ? dayjs(v.checkOutAt).toISOString() : null, note: v.note?.trim() || undefined });
      else await employeesApi.manualAttendance({ userId: v.userId, branchId: v.branchId || undefined, checkInAt: dayjs(v.checkInAt).toISOString(), checkOutAt: v.checkOutAt ? dayjs(v.checkOutAt).toISOString() : undefined, note: v.note?.trim() || undefined });
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
        <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} maxLength={500} placeholder={isEdit ? 'Lý do sửa giờ' : 'Quên chấm công, làm bù…'} /></Form.Item>
        {isEdit && <div className="kv-hint">Nguồn: {ATTENDANCE_SOURCE_LABEL[session!.source] ?? session!.source} · người sửa được ghi vào nhật ký hệ thống.</div>}
      </Form>
    </Modal>
  );
}
