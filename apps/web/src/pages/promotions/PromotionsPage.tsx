import { App, Button, Descriptions, Empty, Input, Pagination, Radio, Tabs, Tag, Tooltip } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, GiftOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, TagsOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useCategories } from '../../api/catalog';
import { errMsg, normalizeError } from '../../api/client';
import { PROMOTION_KEYS, PROMOTION_TYPES, PROMOTION_TYPE_COLOR, PROMOTION_TYPE_LABEL, PROMOTION_TYPE_SHORT, Promotion, PromotionDetail, PromotionQuery, promotionsApi, usePromotion, usePromotionReport, usePromotions } from '../../api/promotions';
import type { Category } from '../../api/types';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore, useCan } from '../../store/auth';
import { dt, money, qty } from '../../utils/format';
import { PromotionEditor } from './PromotionEditor';
import { PromotionReport } from './PromotionReport';
import { VouchersPanel } from './VouchersPanel';
import { NameLookup, PROMO_STATUS_COLOR, PROMO_STATUS_LABEL, describePromotion, promotionStatus, scheduleText } from './promoText';
import dayjs from 'dayjs';
import './promotions.css';

const flatCats = (list: Category[], out = new Map<string, string>()): Map<string, string> => { list.forEach((c) => { out.set(c.id, c.name); flatCats(c.children ?? [], out); }); return out; };
const useCategoryNames = () => { const { data } = useCategories(); return useMemo(() => flatCats(data ?? []), [data]); };

/** Shared mutations: toggle status, delete (409 PROMOTION_IN_USE → offer "Ngừng" instead). */
function usePromotionActions() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const refresh = () => PROMOTION_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const toggle = async (p: Pick<Promotion, 'id' | 'code' | 'status'>) => {
    try { await promotionsApi.update(p.id, { status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); message.success(p.status === 'ACTIVE' ? `Đã ngừng ${p.code}` : `Đã kích hoạt ${p.code}`); refresh(); } catch (e) { message.error(errMsg(e)); }
  };
  const remove = (p: Pick<Promotion, 'id' | 'code' | 'status' | 'name'>, after?: () => void) => modal.confirm({
    title: `Xóa khuyến mãi ${p.code}?`, content: p.name, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
    onOk: async () => {
      try { await promotionsApi.remove(p.id); message.success('Đã xóa khuyến mãi'); refresh(); after?.(); } catch (e) {
        const err = normalizeError(e);
        if (err.code === 'PROMOTION_IN_USE') {
          modal.confirm({ title: 'Không thể xóa', content: `${p.code} đã được áp dụng trên ${err.details?.uses ?? 'một số'} hóa đơn nên không xóa được. Bạn có muốn ngừng chương trình thay vào đó?`, okText: 'Ngừng chương trình', cancelText: 'Bỏ qua', okButtonProps: { disabled: p.status !== 'ACTIVE' }, onOk: () => toggle(p) });
        } else message.error(err.message);
      }
    },
  });
  return { toggle, remove, refresh };
}

export default function PromotionsPage() {
  const { id } = useParams();
  return id ? <PromotionDetailPage id={id} /> : <PromotionsList />;
}

// ---------------------------------------------------------------- list
function PromotionsList() {
  const can = useCan();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const { message } = App.useApp();
  const { toggle, remove } = usePromotionActions();
  const cats = useCategoryNames();
  const [tab, setTab] = useState<'list' | 'report'>('list');
  const [q, setQ] = useState<PromotionQuery>({ page: 1, pageSize: 20 });
  const [searchText, setSearchText] = useState('');
  const [editing, setEditing] = useState<PromotionDetail | null | undefined>(undefined);
  const [editorTab, setEditorTab] = useState<'info' | 'vouchers'>('info');
  const { data, isLoading, isFetching, error, refetch } = usePromotions(q);
  const { data: runningData } = usePromotions({ running: 'true', pageSize: 1 });
  const { data: report } = usePromotionReport({ from: dayjs().startOf('month').toISOString(), to: dayjs().endOf('day').toISOString() });
  const set = (patch: Partial<PromotionQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const rows = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const canManage = can('promotion.manage');
  const lookup: NameLookup = { category: (cid) => cats.get(cid) };
  const statusFilter = q.running === 'true' ? 'running' : q.status ?? '';

  const openEdit = async (p: Promotion, t: 'info' | 'vouchers' = 'info') => { try { setEditorTab(t); setEditing(await promotionsApi.get(p.id)); } catch (e) { message.error(errMsg(e)); } };
  const statusTag = (p: Promotion) => { const k = promotionStatus(p); return <Tag color={PROMO_STATUS_COLOR[k]}>{PROMO_STATUS_LABEL[k]}</Tag>; };
  const actionButtons = (p: Promotion, size: 'small' | 'middle' = 'small') => canManage ? (
    <span className="km-actions" onClick={(e) => e.stopPropagation()}>
      <Button size={size} type="link" icon={<EditOutlined />} onClick={() => openEdit(p)}>Sửa</Button>
      {p.type === 'VOUCHER' && <Button size={size} type="link" icon={<TagsOutlined />} onClick={() => openEdit(p, 'vouchers')}>Voucher</Button>}
      <Button size={size} type="link" icon={p.status === 'ACTIVE' ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={() => toggle(p)}>{p.status === 'ACTIVE' ? 'Ngừng' : 'Kích hoạt'}</Button>
      <Button size={size} type="link" danger icon={<DeleteOutlined />} onClick={() => remove(p)}>Xóa</Button>
    </span>
  ) : null;

  const filters = (
    <FilterPanel>
      <FilterCard title="Trạng thái">
        <Radio.Group value={statusFilter} onChange={(e) => { const v = e.target.value; set(v === 'running' ? { running: 'true', status: undefined } : { running: undefined, status: v || undefined }); }}>
          <Radio value="">Tất cả</Radio><Radio value="running">Đang chạy</Radio><Radio value="ACTIVE">Đang kích hoạt</Radio><Radio value="INACTIVE">Ngừng</Radio>
        </Radio.Group>
      </FilterCard>
      <FilterCard title="Loại khuyến mãi">
        <Radio.Group value={q.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}><Radio value="">Tất cả</Radio>{PROMOTION_TYPES.map((t) => <Radio key={t} value={t}>{PROMOTION_TYPE_LABEL[t]}</Radio>)}</Radio.Group>
      </FilterCard>
      <FilterCard title="Chi nhánh">
        <Radio.Group value={q.branchId ?? ''} onChange={(e) => set({ branchId: e.target.value || undefined })}><Radio value="">Tất cả</Radio>{(me?.branches ?? []).map((b) => <Radio key={b.id} value={b.id}>{b.name}</Radio>)}</Radio.Group>
      </FilterCard>
    </FilterPanel>
  );

  const listBody = (
    <>
      <div className="kv-toolbar">
        <Input.Search className="kv-search" allowClear placeholder="Theo mã hoặc tên chương trình" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
        <span className="spacer" />
        {canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditorTab('info'); setEditing(null); }}>Thêm khuyến mãi</Button>}
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
      </div>
      <div className="km-summary">
        <div className="km-tile"><div className="lbl">Chương trình</div><div className="val">{total}</div></div>
        <div className="km-tile"><div className="lbl">Đang chạy</div><div className="val pos">{runningData?.meta.total ?? 0}</div></div>
        <div className="km-tile"><div className="lbl">Lượt áp dụng (tháng này)</div><div className="val">{report?.totals.uses ?? 0}</div></div>
        <div className="km-tile"><div className="lbl">Tiền giảm (tháng này)</div><div className="val neg">{money(report?.totals.discount ?? 0)}</div></div>
      </div>
      {isMobile ? (
        <div>
          {isLoading && <div className="muted" style={{ padding: 12 }}>Đang tải…</div>}
          {!isLoading && !rows.length && <div className="kv-card" style={{ padding: 16 }}><Empty description={error ? errMsg(error) : 'Chưa có chương trình khuyến mãi'} /></div>}
          <div className="km-cards">
            {rows.map((p) => (
              <div key={p.id} className="km-card" onClick={() => nav(`/promotions/${p.id}`)}>
                <div className="km-card-head"><span><b>{p.code}</b> <Tag color={PROMOTION_TYPE_COLOR[p.type]}>{PROMOTION_TYPE_SHORT[p.type]}</Tag></span>{statusTag(p)}</div>
                <div className="km-card-name">{p.name}</div>
                <div className="km-card-desc">{describePromotion(p, lookup)}</div>
                <div className="km-card-meta">{scheduleText(p)} · {p._count?.uses ?? p.usageCount} lượt{p.usageLimit ? `/${p.usageLimit}` : ''}{p.type === 'VOUCHER' ? ` · ${p._count?.vouchers ?? 0} mã` : ''}{p.stackable ? ' · cộng dồn' : ''}</div>
                {canManage && <div className="km-card-actions">{actionButtons(p, 'middle')}</div>}
              </div>
            ))}
          </div>
          {total > (q.pageSize ?? 20) && <div className="km-pager"><Pagination simple current={q.page} pageSize={q.pageSize} total={total} onChange={(page, pageSize) => set({ page, pageSize })} /></div>}
        </div>
      ) : (
        <div className="kv-card">
          <Table<Promotion> className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={rows} scroll={{ x: 1100 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Chưa có chương trình khuyến mãi" /> }}
            onRow={(p) => ({ onClick: () => nav(`/promotions/${p.id}`) })}
            onChange={(pg) => set({ page: pg.current, pageSize: pg.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} chương trình` }}
            columns={[
              { title: 'Mã', dataIndex: 'code', width: 100, render: (v) => <b>{v}</b> },
              { title: 'Chương trình', render: (_, p) => <div><div style={{ fontWeight: 500 }}>{p.name}</div><div className="kv-hint km-ellipsis" title={describePromotion(p, lookup)}>{describePromotion(p, lookup)}</div></div> },
              { title: 'Loại', dataIndex: 'type', width: 140, render: (v) => <Tag color={PROMOTION_TYPE_COLOR[v as keyof typeof PROMOTION_TYPE_COLOR]}>{PROMOTION_TYPE_SHORT[v as keyof typeof PROMOTION_TYPE_SHORT]}</Tag> },
              { title: 'Hiệu lực', width: 220, render: (_, p) => <span className="km-wrap">{scheduleText(p)}</span> },
              { title: 'Ưu tiên', dataIndex: 'priority', width: 80, className: 'num', render: (v, p) => <span>{v}{p.stackable && <Tooltip title="Cộng dồn với khuyến mãi khác"><Tag style={{ marginLeft: 4 }}>+</Tag></Tooltip>}</span> },
              { title: 'Lượt dùng', width: 100, className: 'num', render: (_, p) => `${p._count?.uses ?? p.usageCount}${p.usageLimit ? ` / ${p.usageLimit}` : ''}` },
              { title: 'Trạng thái', width: 110, render: (_, p) => statusTag(p) },
              ...(canManage ? [{ title: '', width: 300, render: (_: unknown, p: Promotion) => actionButtons(p) }] : []),
            ]} />
        </div>
      )}
    </>
  );

  return (
    <div className="kv-list km-page">
      {tab === 'list' && filters}
      <div className="kv-main">
        <h1 className="kv-page-title">Khuyến mãi</h1>
        <Tabs className="km-tabs" activeKey={tab} onChange={(k) => setTab(k as 'list' | 'report')} items={[{ key: 'list', label: 'Chương trình', children: listBody }, { key: 'report', label: 'Báo cáo khuyến mãi', children: <PromotionReport /> }]} />
      </div>
      <PromotionEditor open={editing !== undefined} promotion={editing} initialTab={editorTab} onClose={() => setEditing(undefined)} onSaved={(p) => { if (p.type === 'VOUCHER' && !editing) { setEditorTab('vouchers'); setEditing(p); } else setEditing(undefined); }} />
    </div>
  );
}

// ---------------------------------------------------------------- detail (/promotions/:id)
function PromotionDetailPage({ id }: { id: string }) {
  const can = useCan();
  const nav = useNavigate();
  const me = useAuthStore((s) => s.me);
  const { toggle, remove } = usePromotionActions();
  const cats = useCategoryNames();
  const { data: p, isLoading, error } = usePromotion(id);
  const [editing, setEditing] = useState<PromotionDetail | null>(null);
  const [editorTab, setEditorTab] = useState<'info' | 'vouchers'>('info');
  const [tab, setTab] = useState<'info' | 'vouchers'>('info');
  const canManage = can('promotion.manage');
  if (isLoading) return <div className="muted" style={{ padding: 20 }}>Đang tải…</div>;
  if (error || !p) return <Empty description={error ? errMsg(error) : 'Không tìm thấy chương trình'} style={{ padding: 40 }}><Link to="/promotions">Về danh sách</Link></Empty>;
  const lookup: NameLookup = { variant: (vid) => p.variants.find((v) => v.id === vid)?.name, category: (cid) => cats.get(cid) };
  const k = promotionStatus(p);
  const branchNames = p.branchIds.length ? p.branchIds.map((b) => me?.branches.find((x) => x.id === b)?.name ?? b).join(', ') : 'Tất cả chi nhánh';
  const remaining = p.usageLimit ? Math.max(0, p.usageLimit - p.usageCount) : null;

  const info = (
    <>
      <div className="km-summary">
        <div className="km-tile"><div className="lbl">Lượt áp dụng</div><div className="val">{p.stats.uses}</div></div>
        <div className="km-tile"><div className="lbl">Tiền đã giảm</div><div className="val neg">{money(p.stats.amount)}</div></div>
        <div className="km-tile"><div className="lbl">Hàng đã tặng</div><div className="val">{qty(p.stats.gifts)}</div></div>
        <div className="km-tile"><div className="lbl">Lượt còn lại</div><div className="val">{remaining === null ? '∞' : remaining}</div></div>
      </div>
      <div className="kv-card km-detail-card">
        <div className="km-detail-desc"><GiftOutlined /> {describePromotion(p, lookup)}</div>
        <Descriptions size="small" column={isNarrow() ? 1 : 2} colon={false} styles={{ label: { color: '#6b7280', width: 150 } }}>
          <Descriptions.Item label="Loại">{PROMOTION_TYPE_LABEL[p.type]}</Descriptions.Item>
          <Descriptions.Item label="Trạng thái"><Tag color={PROMO_STATUS_COLOR[k]}>{PROMO_STATUS_LABEL[k]}</Tag></Descriptions.Item>
          <Descriptions.Item label="Thời gian">{scheduleText(p)}</Descriptions.Item>
          <Descriptions.Item label="Chi nhánh">{branchNames}</Descriptions.Item>
          <Descriptions.Item label="Nhóm khách hàng">{p.customerGroups.length ? p.customerGroups.map((g) => <Tag key={g}>{g}</Tag>) : 'Mọi khách hàng'}</Descriptions.Item>
          <Descriptions.Item label="Ưu tiên / cộng dồn">{p.priority} · {p.stackable ? 'Cộng dồn với KM khác' : 'Không cộng dồn'}</Descriptions.Item>
          <Descriptions.Item label="Giới hạn">{p.usageLimit ? `${p.usageCount}/${p.usageLimit} lượt` : 'Không giới hạn lượt'}{p.perCustomerLimit ? ` · tối đa ${p.perCustomerLimit} lượt/khách` : ''}</Descriptions.Item>
          <Descriptions.Item label="Tạo lúc">{dt(p.createdAt)}</Descriptions.Item>
          {p.description && <Descriptions.Item label="Mô tả" span={2}>{p.description}</Descriptions.Item>}
        </Descriptions>
        {p.variants.length > 0 && (
          <div className="km-variants">
            <div className="km-sub">Hàng hóa liên quan ({p.variants.length})</div>
            {p.variants.map((v) => <div key={v.id} className="km-picked-row"><div className="nm">{v.name}<div className="kv-hint">{v.sku}</div></div><span className="num">{money(v.sellPrice)}</span></div>)}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="km-page km-detail">
      <div className="km-detail-head">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/promotions')} />
        <div className="km-detail-title"><b>{p.code}</b> · {p.name} <Tag color={PROMOTION_TYPE_COLOR[p.type]}>{PROMOTION_TYPE_SHORT[p.type]}</Tag><Tag color={PROMO_STATUS_COLOR[k]}>{PROMO_STATUS_LABEL[k]}</Tag></div>
        {canManage && (
          <div className="km-detail-actions">
            <Button icon={<EditOutlined />} onClick={() => { setEditorTab('info'); setEditing(p); }}>Sửa</Button>
            <Button icon={p.status === 'ACTIVE' ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={() => toggle(p)}>{p.status === 'ACTIVE' ? 'Ngừng' : 'Kích hoạt'}</Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => remove(p, () => nav('/promotions'))}>Xóa</Button>
          </div>
        )}
      </div>
      {p.type === 'VOUCHER'
        ? <Tabs activeKey={tab} onChange={(t) => setTab(t as 'info' | 'vouchers')} items={[{ key: 'info', label: 'Thông tin', children: info }, { key: 'vouchers', label: `Voucher (${p._count?.vouchers ?? 0})`, children: <div className="kv-card" style={{ padding: 12 }}><VouchersPanel promotionId={p.id} /></div> }]} />
        : info}
      <PromotionEditor open={!!editing} promotion={editing} initialTab={editorTab} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
    </div>
  );
}

const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 768;
