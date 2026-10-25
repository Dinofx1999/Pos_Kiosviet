import { Alert, App, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Modal, Segmented, Skeleton, Switch, Tabs, Tag, Tooltip } from 'antd';
import Table from '../../components/ResponsiveTable';
import { CloseOutlined, DeleteOutlined, EditOutlined, InfoCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCategories } from '../../api/catalog';
import { errMsg } from '../../api/client';
import { COMMISSION_BASIS_HINT, COMMISSION_BASIS_LABEL, CommissionBasis, CommissionByRule, CommissionRow, CommissionRule, employeesApi, useCommissionRules, useCommissions, useMyCommission } from '../../api/employees';
import type { Category, SearchHit } from '../../api/types';
import { MoneyInput } from '../../components/Inputs';
import { ProductSearch } from '../../components/ProductSearch';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { d, money, qty, toNum } from '../../utils/format';
import { BranchSelect, CardPager, CategorySelect, DateRangeBar, HBarChart, RankBadge, Range, Stat, fmtPct, pctOf, presetRange, vnd } from '../reports/ReportShared';
import { EmployeeSelect, ScopeChips, periodParams, rateText, useInvalidateEmployees, useUrlTab, useUrlUserId } from './EmployeeShared';
import './employees.css';

const flatCats = (list: Category[], out = new Map<string, string>()): Map<string, string> => { list.forEach((c) => { out.set(c.id, c.name); flatCats(c.children ?? [], out); }); return out; };

/** Hoa hồng: của tôi (mọi người), theo nhân viên (commission.view), quy tắc (employee.manage) – BR-150. */
export default function CommissionsPage() {
  const can = useCan();
  const canTeam = can('commission.view');
  const canRules = can('employee.manage');
  const allowed = ['me', ...(canTeam ? ['team'] : []), ...(canRules ? ['rules'] : [])] as const;
  const [tab, setTab] = useUrlTab(allowed as readonly string[], 'me');
  const items = [
    { key: 'me', label: 'Hoa hồng của tôi', children: <MyTab /> },
    ...(canTeam ? [{ key: 'team', label: 'Theo nhân viên', children: <TeamTab /> }] : []),
    ...(canRules ? [{ key: 'rules', label: 'Quy tắc hoa hồng', children: <RulesTab /> }] : []),
  ];
  return (
    <div className="em-page">
      <h1 className="kv-page-title">Hoa hồng</h1>
      {items.length > 1 ? <Tabs activeKey={tab} onChange={setTab} items={items} /> : <MyTab />}
    </div>
  );
}

/** Breakdown by rule: base × rate = commission, with the minRevenue gate. */
function ByRule({ rows }: { rows: CommissionByRule[] }) {
  if (!rows.length) return <div className="muted">Không có quy tắc nào áp dụng cho các dòng bán trong kỳ</div>;
  return (
    <div className="em-byrule">
      {rows.map((r) => (
        <div key={r.ruleId} className={`it${r.eligible ? '' : ' off'}`}>
          <span className="nm">{r.name}</span>
          <span className="v">{vnd(r.commission)}</span>
          <span className="sub">{COMMISSION_BASIS_LABEL[r.basis]} {r.basis === 'QUANTITY' ? `${qty(r.base)} đv × ${money(r.rate)} đ` : `${vnd(r.base)} × ${toNum(r.rate).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %`} · {r.lines} dòng bán</span>
          {!r.eligible && <span className="warn">Chưa đạt doanh thu tối thiểu {vnd(r.minRevenue)} trong kỳ – chưa được hưởng</span>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- my commission
function MyTab() {
  const me = useAuthStore((s) => s.me);
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const { data, isLoading, isFetching, error, refetch } = useMyCommission(periodParams(range));
  const row: CommissionRow | undefined = data?.data.find((r) => r.sellerId === me?.user.id) ?? data?.data[0];
  return (
    <>
      <div className="em-toolbar"><DateRangeBar value={range} onChange={setRange} /><span style={{ flex: 1 }} /><Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} /></div>
      {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
      {isLoading && !data ? <Skeleton active paragraph={{ rows: 6 }} /> : data && (
        <>
          <div className="rp-stats">
            <Stat label="Hoa hồng kỳ này" value={vnd(row?.commission ?? 0)} tone="pos" sub={`${data.rules} quy tắc đang hiệu lực`} />
            <Stat label="Doanh thu thuần" value={vnd(row?.revenue ?? 0)} tone="blue" sub={`${row?.invoices ?? 0} hóa đơn`} />
            <Stat label="Lợi nhuận gộp" value={vnd(row?.grossProfit ?? 0)} sub={`biên ${fmtPct(pctOf(row?.grossProfit, row?.revenue))}`} />
            <Stat label="Số lượng bán" value={qty(row?.quantity ?? 0)} />
          </div>
          <Card size="small" title="Theo quy tắc" extra={<span className="kv-hint">{range[0].format('DD/MM')} – {range[1].format('DD/MM/YYYY')}</span>}>
            {!row ? <Empty description="Bạn chưa có hóa đơn hoàn thành trong kỳ" /> : <ByRule rows={row.byRule} />}
            <div className="rp-table-note">Hoa hồng tính trên hóa đơn hoàn thành đã trừ phần trả hàng; chi trả bằng phiếu chi "Lương / hoa hồng" trong sổ quỹ.</div>
          </Card>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- team
function TeamTab() {
  const isMobile = useIsMobile();
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [branchId, setBranchId] = useState<string>();
  const [userId, setUserId] = useUrlUserId();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, error, refetch } = useCommissions({ ...periodParams(range), branchId, userId });
  const rows = data?.data ?? [];
  const pageRows = isMobile ? rows.slice((page - 1) * 20, page * 20) : rows;
  const toggle = (id: string) => setExpanded((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <>
      <div className="em-toolbar">
        <DateRangeBar value={range} onChange={setRange} />
        <div className="em-w"><EmployeeSelect value={userId} onChange={setUserId} /></div>
        <div className="em-w"><BranchSelect value={branchId} onChange={setBranchId} /></div>
        <span style={{ flex: 1 }} /><Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
      </div>
      {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
      {isLoading && !data ? <Skeleton active paragraph={{ rows: 8 }} /> : data && (
        <>
          <div className="rp-stats three">
            <Stat label="Tổng hoa hồng" value={vnd(data.totals.commission)} tone="pos" sub={`${data.rules} quy tắc hiệu lực`} />
            <Stat label="Doanh thu thuần" value={vnd(data.totals.revenue)} tone="blue" />
            <Stat label="Nhân viên có doanh số" value={data.totals.sellers} />
          </div>
          <div className="rp-grid2">
            <Card size="small" title="Top hoa hồng" className="rp-chart-card">
              {rows.length === 0 ? <div className="muted">Không có dữ liệu</div> : <HBarChart rows={rows.slice(0, 5).map((r) => ({ key: r.sellerId, name: r.name, sub: `${r.invoices} HĐ`, value: toNum(r.commission), display: vnd(r.commission) }))} />}
            </Card>
            <Card size="small" title="Theo nhân viên">
              {rows.length === 0 ? <Empty description="Không có hóa đơn trong kỳ" /> : isMobile ? (
                <>
                  <div className="rp-cards">
                    {pageRows.map((r, i) => (
                      <div key={r.sellerId} className="rp-card ranked" onClick={() => toggle(r.sellerId)}>
                        <RankBadge rank={(page - 1) * 20 + i + 1} />
                        <div className="nm">{r.name}</div>
                        <div><div className="amt pos">{vnd(r.commission)}</div><div className="sub">hoa hồng</div></div>
                        <div className="meta"><span>{r.invoices} hóa đơn</span><span>· DT thuần {vnd(r.revenue)}</span><span>· LN gộp {vnd(r.grossProfit)}</span></div>
                        {expanded.includes(r.sellerId) && <div className="rows" style={{ display: 'block' }} onClick={(e) => e.stopPropagation()}><ByRule rows={r.byRule} /><div className="em-links" style={{ marginTop: 6 }}><Link to={`/employees/performance?userId=${r.sellerId}`}>Hiệu suất</Link><Link to={`/employees/attendance?tab=all&userId=${r.sellerId}`}>Chấm công</Link></div></div>}
                      </div>
                    ))}
                  </div>
                  <CardPager page={page} pageSize={20} total={rows.length} onChange={(p) => setPage(p)} />
                </>
              ) : (
                <Table<CommissionRow> size="small" rowKey="sellerId" dataSource={rows} pagination={false} scroll={{ x: 760 }}
                  expandable={{ expandedRowRender: (r) => <div style={{ maxWidth: 720 }}><ByRule rows={r.byRule} /><div className="em-links" style={{ marginTop: 8 }}><Link to={`/employees/performance?userId=${r.sellerId}`}>Hiệu suất</Link><Link to={`/employees/attendance?tab=all&userId=${r.sellerId}`}>Chấm công</Link></div></div>, expandRowByClick: true }}
                  columns={[
                    { title: '#', width: 44, render: (_, __, i) => <RankBadge rank={i + 1} /> },
                    { title: 'Nhân viên', dataIndex: 'name', render: (v) => <b>{v}</b> },
                    { title: 'HĐ', dataIndex: 'invoices', className: 'num', width: 60 },
                    { title: 'DT thuần', dataIndex: 'revenue', className: 'num', width: 130, render: (v) => vnd(v) },
                    { title: 'LN gộp', dataIndex: 'grossProfit', className: 'num', width: 130, render: (v) => vnd(v) },
                    { title: 'SL', dataIndex: 'quantity', className: 'num', width: 70, render: (v) => qty(v) },
                    { title: 'Quy tắc', width: 90, className: 'num', render: (_, r) => `${r.byRule.filter((x) => x.eligible).length}/${r.byRule.length}` },
                    { title: 'Hoa hồng', dataIndex: 'commission', className: 'num', width: 140, render: (v) => <b className="pos">{vnd(v)}</b> },
                  ]}
                  summary={() => <Table.Summary fixed><Table.Summary.Row><Table.Summary.Cell index={0} colSpan={2}><b>Tổng</b></Table.Summary.Cell><Table.Summary.Cell index={2} className="num"><b>{rows.reduce((s, r) => s + r.invoices, 0)}</b></Table.Summary.Cell><Table.Summary.Cell index={3} className="num"><b>{vnd(data.totals.revenue)}</b></Table.Summary.Cell><Table.Summary.Cell index={4} className="num"><b>{vnd(rows.reduce((s, r) => s + toNum(r.grossProfit), 0))}</b></Table.Summary.Cell><Table.Summary.Cell index={5} className="num" /><Table.Summary.Cell index={6} className="num" /><Table.Summary.Cell index={7} className="num"><b className="pos">{vnd(data.totals.commission)}</b></Table.Summary.Cell></Table.Summary.Row></Table.Summary>} />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- rules
function RulesTab() {
  const { message, modal } = App.useApp();
  const isMobile = useIsMobile();
  const invalidate = useInvalidateEmployees();
  const { data: cats } = useCategories();
  const catNames = useMemo(() => flatCats(cats ?? []), [cats]);
  const [showInactive, setShowInactive] = useState(true);
  const { data, isLoading, isFetching, error, refetch } = useCommissionRules(true, true);
  const [editing, setEditing] = useState<CommissionRule | null | undefined>(undefined);
  const [names, setNames] = useState<Record<string, string>>({}); // variantId → name picked in this session
  const rules = (data ?? []).filter((r) => showInactive || r.isActive);
  const toggle = async (r: CommissionRule) => { try { await employeesApi.updateRule(r.id, { isActive: !r.isActive }); message.success(r.isActive ? 'Đã ngừng quy tắc' : 'Đã kích hoạt quy tắc'); invalidate(); } catch (e) { message.error(errMsg(e)); } };
  const remove = (r: CommissionRule) => modal.confirm({ title: `Xóa quy tắc "${r.name}"?`, content: 'Hoa hồng các kỳ trước sẽ được tính lại không có quy tắc này.', okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: async () => { try { await employeesApi.deleteRule(r.id); message.success('Đã xóa quy tắc'); invalidate(); } catch (e) { message.error(errMsg(e)); } } });
  const validity = (r: CommissionRule) => r.startsAt || r.endsAt ? `${r.startsAt ? d(r.startsAt) : '…'} → ${r.endsAt ? d(r.endsAt) : '…'}` : 'Không giới hạn thời gian';
  const running = (r: CommissionRule) => r.isActive && (!r.startsAt || dayjs(r.startsAt).isBefore(dayjs())) && (!r.endsAt || dayjs(r.endsAt).isAfter(dayjs()));
  return (
    <>
      <div className="em-toolbar">
        <span className="rp-switch"><Switch size="small" checked={showInactive} onChange={setShowInactive} /> Hiện quy tắc đã ngừng</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', gap: 6 }}><Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>Thêm quy tắc</Button><Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} /></span>
      </div>
      <Alert type="info" showIcon icon={<InfoCircleOutlined />} style={{ marginBottom: 10 }} message="Mỗi dòng bán áp dụng quy tắc cụ thể nhất: nhân viên + hàng hóa › nhân viên + nhóm hàng › nhân viên › hàng hóa › nhóm hàng › chung; cùng mức thì ưu tiên cao hơn thắng. Quy tắc có doanh thu tối thiểu chỉ trả khi tổng doanh thu thuần kỳ của nhân viên đạt ngưỡng." />
      {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
      {isLoading && !data ? <Skeleton active /> : rules.length === 0 ? <Empty description="Chưa có quy tắc hoa hồng" /> : isMobile ? (
        <div className="em-rules">
          {rules.map((r) => (
            <div key={r.id} className={`em-rule${r.isActive ? '' : ' off'}`}>
              <div className="nm">{r.name} {!r.isActive && <Tag>Ngừng</Tag>}{r.isActive && !running(r) && <Tag color="gold">Ngoài thời hạn</Tag>}</div>
              <div className="rate">{rateText(r)}</div>
              <div className="scope"><ScopeChips rule={r} categoryName={r.categoryId ? catNames.get(r.categoryId) : undefined} variantName={r.variantId ? names[r.variantId] : undefined} /></div>
              <div className="meta"><span>{COMMISSION_BASIS_LABEL[r.basis]}</span>{toNum(r.minRevenue) > 0 && <span>· DT tối thiểu {vnd(r.minRevenue)}</span>}<span>· Ưu tiên {r.priority}</span><span>· {validity(r)}</span></div>
              <div className="act"><Button size="small" type="link" icon={<EditOutlined />} onClick={() => setEditing(r)}>Sửa</Button><Button size="small" type="link" onClick={() => toggle(r)}>{r.isActive ? 'Ngừng' : 'Kích hoạt'}</Button><Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => remove(r)}>Xóa</Button></div>
            </div>
          ))}
        </div>
      ) : (
        <Table<CommissionRule> className="kv-table" size="small" rowKey="id" dataSource={rules} pagination={false} scroll={{ x: 980 }}
          columns={[
            { title: 'Tên quy tắc', dataIndex: 'name', render: (v, r) => <span><b>{v}</b> {!r.isActive && <Tag>Ngừng</Tag>}{r.isActive && !running(r) && <Tag color="gold">Ngoài thời hạn</Tag>}</span> },
            { title: 'Phạm vi', render: (_, r) => <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}><ScopeChips rule={r} categoryName={r.categoryId ? catNames.get(r.categoryId) : undefined} variantName={r.variantId ? names[r.variantId] : undefined} /></span> },
            { title: 'Cơ sở', dataIndex: 'basis', width: 130, render: (v) => COMMISSION_BASIS_LABEL[v as CommissionBasis] },
            { title: 'Mức', width: 120, className: 'num', render: (_, r) => <b>{rateText(r)}</b> },
            { title: 'DT tối thiểu', dataIndex: 'minRevenue', width: 130, className: 'num', render: (v) => toNum(v) > 0 ? vnd(v) : <span className="muted">—</span> },
            { title: 'Ưu tiên', dataIndex: 'priority', width: 80, className: 'num' },
            { title: 'Hiệu lực', width: 190, render: (_, r) => validity(r) },
            { title: '', width: 150, render: (_, r) => <span onClick={(e) => e.stopPropagation()}><Button size="small" type="link" icon={<EditOutlined />} onClick={() => setEditing(r)} /><Button size="small" type="link" onClick={() => toggle(r)}>{r.isActive ? 'Ngừng' : 'Kích hoạt'}</Button><Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => remove(r)} /></span> },
          ]} />
      )}
      <RuleModal rule={editing} onClose={() => setEditing(undefined)} onPicked={(id, name) => setNames((n) => ({ ...n, [id]: name }))} variantName={editing?.variantId ? names[editing.variantId] : undefined} />
    </>
  );
}

function RuleModal({ rule, onClose, onPicked, variantName }: { rule: CommissionRule | null | undefined; onClose: () => void; onPicked: (variantId: string, name: string) => void; variantName?: string }) {
  const { message } = App.useApp();
  const invalidate = useInvalidateEmployees();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [variant, setVariant] = useState<{ id: string; name: string } | null>(null);
  const basis: CommissionBasis = Form.useWatch('basis', form) ?? 'REVENUE';
  const open = rule !== undefined;
  useEffect(() => {
    if (!open) return;
    if (rule) { form.setFieldsValue({ name: rule.name, userId: rule.userId ?? undefined, categoryId: rule.categoryId ?? undefined, basis: rule.basis, rate: toNum(rule.rate), minRevenue: toNum(rule.minRevenue) || undefined, priority: rule.priority, range: rule.startsAt || rule.endsAt ? [rule.startsAt ? dayjs(rule.startsAt) : null, rule.endsAt ? dayjs(rule.endsAt) : null] : undefined, isActive: rule.isActive }); setVariant(rule.variantId ? { id: rule.variantId, name: variantName ?? `Hàng hóa #${rule.variantId.slice(0, 8)}` } : null); }
    else { form.resetFields(); form.setFieldsValue({ basis: 'REVENUE', priority: 0, isActive: true }); setVariant(null); }
  }, [open, rule]);
  const pick = (hit: SearchHit) => { setVariant({ id: hit.id, name: `${hit.name} (${hit.sku})` }); onPicked(hit.id, `${hit.name} (${hit.sku})`); };
  const save = async () => {
    const v = await form.validateFields();
    const [s, e] = (v.range ?? []) as [dayjs.Dayjs | null, dayjs.Dayjs | null];
    const body = { name: v.name.trim(), userId: v.userId ?? null, categoryId: v.categoryId ?? null, variantId: variant?.id ?? null, basis: v.basis as CommissionBasis, rate: String(v.rate), minRevenue: String(toNum(v.minRevenue)), priority: Number(v.priority ?? 0), startsAt: s ? s.startOf('day').toISOString() : null, endsAt: e ? e.endOf('day').toISOString() : null, isActive: !!v.isActive };
    setSaving(true);
    try {
      if (rule) await employeesApi.updateRule(rule.id, body);
      else await employeesApi.createRule({ ...body, userId: body.userId ?? undefined, categoryId: body.categoryId ?? undefined, variantId: body.variantId ?? undefined, startsAt: body.startsAt ?? undefined, endsAt: body.endsAt ?? undefined });
      message.success(rule ? 'Đã cập nhật quy tắc' : 'Đã thêm quy tắc hoa hồng');
      invalidate(); onClose();
    } catch (err) { message.error(errMsg(err)); } finally { setSaving(false); }
  };
  return (
    <Modal title={rule ? 'Sửa quy tắc hoa hồng' : 'Thêm quy tắc hoa hồng'} open={open} onCancel={onClose} onOk={save} okText="Lưu" cancelText="Bỏ qua" confirmLoading={saving} destroyOnClose width={640}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Tên quy tắc" rules={[{ required: true, message: 'Nhập tên quy tắc' }]}><Input placeholder="VD: 2% doanh thu, 5% lợi nhuận son môi…" maxLength={200} /></Form.Item>
        <div className="kv-hint" style={{ marginBottom: 6 }}>Phạm vi áp dụng – bỏ trống = tất cả</div>
        <div className="em-form-row">
          <Form.Item name="userId" label="Nhân viên"><EmployeeSelect onChange={() => undefined} placeholder="Mọi nhân viên" /></Form.Item>
          <Form.Item name="categoryId" label="Nhóm hàng"><CategorySelect onChange={() => undefined} /></Form.Item>
        </div>
        <Form.Item label="Hàng hóa cụ thể">
          {variant ? <div className="em-picked"><span className="nm">{variant.name}</span><Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setVariant(null)} /></div> : <ProductSearch size="middle" onPick={pick} placeholder="Tìm hàng hóa theo mã / tên (tùy chọn)" />}
        </Form.Item>
        <Form.Item name="basis" label="Cơ sở tính" extra={<span className="kv-hint">{COMMISSION_BASIS_HINT[basis]}</span>}><Segmented block options={(['REVENUE', 'GROSS_PROFIT', 'QUANTITY'] as CommissionBasis[]).map((b) => ({ value: b, label: COMMISSION_BASIS_LABEL[b] }))} /></Form.Item>
        <div className="em-form-row">
          <Form.Item name="rate" label={basis === 'QUANTITY' ? 'Tiền thưởng mỗi đơn vị (đ)' : 'Tỷ lệ (%)'} rules={[{ required: true, message: 'Nhập mức hoa hồng' }]}>{basis === 'QUANTITY' ? <MoneyInput placeholder="10.000" suffix="đ" /> : <InputNumber min={0} max={100} step={0.5} style={{ width: '100%' }} suffix="%" inputMode="decimal" />}</Form.Item>
          <Form.Item name="minRevenue" label={<span>Doanh thu tối thiểu <Tooltip title="Chỉ hưởng khi tổng doanh thu thuần trong kỳ của nhân viên đạt mức này"><InfoCircleOutlined /></Tooltip></span>}><MoneyInput placeholder="Không yêu cầu" /></Form.Item>
        </div>
        <div className="em-form-row">
          <Form.Item name="priority" label="Ưu tiên (cao hơn thắng khi cùng mức cụ thể)"><InputNumber min={-100} max={100} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="range" label="Thời gian hiệu lực"><DatePicker.RangePicker style={{ width: '100%' }} format="DD/MM/YYYY" allowEmpty={[true, true]} inputReadOnly /></Form.Item>
        </div>
        <Form.Item name="isActive" label="Đang áp dụng" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
  );
}
