import { App, Button, Drawer, Empty, Input, Radio, Table, Tag } from 'antd';
import { ClockCircleOutlined, DollarOutlined, IdcardOutlined, LineChartOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errMsg } from '../../api/client';
import { Employee, EmployeeProfile, EmployeeQuery, useEmployees } from '../../api/employees';
import { orgApi } from '../../api/org';
import type { UserRow } from '../../api/types';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { USER_STATUS_LABEL, d, dt, money } from '../../utils/format';
import { CardPager } from '../reports/ReportShared';
import { UserFormDrawer } from '../settings/SettingsTabs';
import { initials } from './EmployeeShared';
import './employees.css';

const STATUS_COLOR: Record<string, string> = { ACTIVE: 'green', LOCKED: 'orange', DISABLED: 'default' };

/** Danh sách nhân viên (BR-153): profile fields, roles, branches, hire date, last login; links to attendance / commission / performance. */
export default function EmployeesPage() {
  const { message } = App.useApp();
  const can = useCan();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const canUsers = can('user.manage');
  const canSalary = can('employee.manage');
  const [q, setQ] = useState<EmployeeQuery>({ page: 1, pageSize: 20, status: 'ACTIVE' });
  const [searchText, setSearchText] = useState('');
  const [view, setView] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined);
  const [editProfile, setEditProfile] = useState<EmployeeProfile>();
  const [opening, setOpening] = useState<string>();
  const { data, isLoading, isFetching, error, refetch } = useEmployees(q);
  const set = (patch: Partial<EmployeeQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;

  /** "Hồ sơ": the user form (user.manage, loaded from /users so branch / warehouse access is complete) or a read-only drawer. */
  const openProfile = async (e: Employee) => {
    if (!canUsers) { setView(e); return; }
    setOpening(e.id);
    try {
      const r = await orgApi.users({ search: e.username, pageSize: 20 });
      const u = r.data.find((x) => x.id === e.id);
      if (!u) { setView(e); return; }
      setEditProfile({ position: e.position, hiredAt: e.hiredAt, baseSalary: e.baseSalary, employeeNote: e.employeeNote });
      setEditing(u);
    } catch (err) { message.error(errMsg(err)); } finally { setOpening(undefined); }
  };
  const branchesText = (e: Employee) => (e.isOwner || e.allBranches ? 'Tất cả chi nhánh' : e.branches.map((b) => b.name).join(', ') || '—');
  const links = (e: Employee, size: 'small' | 'middle' = 'small') => (
    <>
      <Button size={size} type="link" icon={<IdcardOutlined />} loading={opening === e.id} onClick={() => openProfile(e)}>Hồ sơ</Button>
      <Button size={size} type="link" icon={<ClockCircleOutlined />} onClick={() => nav(`/employees/attendance?tab=all&userId=${e.id}`)}>Chấm công</Button>
      {can('commission.view') && <Button size={size} type="link" icon={<DollarOutlined />} onClick={() => nav(`/employees/commissions?tab=team&userId=${e.id}`)}>Hoa hồng</Button>}
      <Button size={size} type="link" icon={<LineChartOutlined />} onClick={() => nav(`/employees/performance?userId=${e.id}`)}>Hiệu suất</Button>
    </>
  );

  return (
    <div className="kv-list em-page">
      <FilterPanel>
        <FilterCard title="Trạng thái"><Radio.Group value={q.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}><Radio value="ACTIVE">Đang làm việc</Radio><Radio value="LOCKED">Đã khóa</Radio><Radio value="DISABLED">Đã nghỉ</Radio><Radio value="">Tất cả</Radio></Radio.Group></FilterCard>
        <FilterCard title="Chi nhánh"><Radio.Group value={q.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}><Radio value="">Tất cả</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Nhân viên</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo tên, tên đăng nhập, điện thoại" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {canUsers && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditProfile(undefined); setEditing(null); }}>Thêm nhân viên</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        {isMobile ? (
          <>
            {!isLoading && rows.length === 0 && <Empty description={error ? errMsg(error) : 'Không có nhân viên'} />}
            <div className="em-people">
              {rows.map((e) => (
                <div key={e.id} className="em-person">
                  <span className="av">{initials(e.fullName)}</span>
                  <div className="nm">{e.fullName}{e.isOwner && <Tag color="gold">Chủ gian hàng</Tag>}</div>
                  <div className="st"><Tag color={STATUS_COLOR[e.status] ?? 'default'}>{USER_STATUS_LABEL[e.status] ?? e.status}</Tag></div>
                  <div className="pos">{e.position || 'Chưa có chức vụ'} · @{e.username}</div>
                  <div className="meta">
                    {e.roles.map((r) => <Tag key={r.id}>{r.name}</Tag>)}
                    <span>{branchesText(e)}</span>
                    {e.hiredAt && <span>· Vào làm {d(e.hiredAt)}</span>}
                    {canSalary && e.baseSalary && <span>· Lương {money(e.baseSalary)}</span>}
                    <span>· Đăng nhập {e.lastLoginAt ? dt(e.lastLoginAt) : 'chưa'}</span>
                  </div>
                  <div className="act">{links(e, 'middle')}</div>
                </div>
              ))}
            </div>
            <CardPager page={q.page ?? 1} pageSize={q.pageSize ?? 20} total={total} onChange={(p) => set({ page: p })} />
          </>
        ) : (
          <div className="kv-card">
            <Table<Employee> className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 1500 }}
              locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Không có nhân viên" /> }}
              onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
              pagination={{ current: q.page, pageSize: q.pageSize, total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `${t} nhân viên` }}
              onRow={(e) => ({ onClick: () => void openProfile(e) })}
              columns={[
                { title: 'Nhân viên', dataIndex: 'fullName', width: 220, render: (v, e) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className="av" style={{ width: 30, height: 30, borderRadius: '50%', background: '#e5edf7', color: '#1e3a8a', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{initials(v)}</span><span><b>{v}</b>{e.isOwner && <Tag color="gold" style={{ marginLeft: 6 }}>Chủ</Tag>}<div className="kv-hint">@{e.username}</div></span></span> },
                { title: 'Chức vụ', dataIndex: 'position', width: 140, render: (v) => v || <span className="muted">—</span> },
                { title: 'Vai trò', width: 180, render: (_, e) => e.roles.map((r) => <Tag key={r.id}>{r.name}</Tag>) },
                { title: 'Chi nhánh', width: 180, render: (_, e) => branchesText(e) },
                { title: 'Liên hệ', width: 170, render: (_, e) => [e.phone, e.email].filter(Boolean).join(' · ') || <span className="muted">—</span> },
                { title: 'Vào làm', dataIndex: 'hiredAt', width: 110, render: (v) => v ? d(v) : <span className="muted">—</span> },
                ...(canSalary ? [{ title: 'Lương cơ bản', dataIndex: 'baseSalary', className: 'num', width: 130, render: (v: string | null | undefined) => v ? money(v) : <span className="muted">—</span> }] : []),
                { title: 'Đăng nhập cuối', dataIndex: 'lastLoginAt', width: 140, render: (v) => v ? dt(v) : <span className="muted">Chưa</span> },
                { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (v) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{USER_STATUS_LABEL[v] ?? v}</Tag> },
                { title: '', width: 400, render: (_, e) => <span style={{ whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>{links(e)}</span> },
              ]} />
          </div>
        )}
      </div>
      <UserFormDrawer editing={editing} profile={editProfile} onClose={() => setEditing(undefined)} onSaved={() => refetch()} />
      <Drawer title={view ? view.fullName : ''} open={!!view} onClose={() => setView(null)} width={420}>
        {view && (
          <>
            <div className="em-profile">
              <span className="k">Tên đăng nhập</span><span className="v">@{view.username}</span>
              <span className="k">Chức vụ</span><span className="v">{view.position || '—'}</span>
              <span className="k">Vai trò</span><span className="v">{view.roles.map((r) => r.name).join(', ') || '—'}</span>
              <span className="k">Chi nhánh</span><span className="v">{branchesText(view)}</span>
              <span className="k">Điện thoại</span><span className="v">{view.phone || '—'}</span>
              <span className="k">Email</span><span className="v">{view.email || '—'}</span>
              <span className="k">Ngày vào làm</span><span className="v">{view.hiredAt ? d(view.hiredAt) : '—'}</span>
              {canSalary && <><span className="k">Lương cơ bản</span><span className="v">{view.baseSalary ? money(view.baseSalary) : '—'}</span></>}
              <span className="k">Ghi chú</span><span className="v">{view.employeeNote || '—'}</span>
              <span className="k">Trạng thái</span><span className="v"><Tag color={STATUS_COLOR[view.status] ?? 'default'}>{USER_STATUS_LABEL[view.status] ?? view.status}</Tag></span>
              <span className="k">Đăng nhập cuối</span><span className="v">{view.lastLoginAt ? dt(view.lastLoginAt) : 'Chưa đăng nhập'}</span>
            </div>
            <div className="em-links" style={{ marginTop: 12 }}><Link to={`/employees/attendance?tab=all&userId=${view.id}`}>Chấm công</Link>{can('commission.view') && <Link to={`/employees/commissions?tab=team&userId=${view.id}`}>Hoa hồng</Link>}<Link to={`/employees/performance?userId=${view.id}`}>Hiệu suất</Link></div>
            {!canUsers && <div className="kv-hint" style={{ marginTop: 10 }}>Cần quyền quản lý người dùng để sửa hồ sơ.</div>}
          </>
        )}
      </Drawer>
    </div>
  );
}
