import { App, Button, Card, Checkbox, Col, Empty, Input, Row, Select, Statistic, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ReloadOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { BalanceQuery, inventoryApi, useBalanceSummary, useBalances } from '../../api/inventory';
import { errMsg } from '../../api/client';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useBranchWarehouses, useCan, useMe } from '../../store/auth';
import { money, qty } from '../../utils/format';
import { useCategoryOptions } from '../products/CategoryFilter';
import { BarcodeScanButton } from '../../components/BarcodeScanner';

export default function BalancesPage() {
  const { message, modal } = App.useApp();
  const can = useCan();
  const me = useMe();
  const warehouses = useBranchWarehouses();
  const categories = useCategoryOptions();
  const [q, setQ] = useState<BalanceQuery>({ page: 1, pageSize: 20, nonZero: 'true' });
  const [searchText, setSearchText] = useState('');
  const { data, isLoading, isFetching, error, refetch } = useBalances(q);
  const summary = useBalanceSummary(q.warehouseId);
  const set = (patch: Partial<BalanceQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));
  const canSeeCost = can('inventory.cost.view');

  const reconcile = () => modal.confirm({ title: 'Chạy đối soát tồn kho?', content: 'So sánh số dư với sổ kho (stock ledger) và sổ giá vốn.', okText: 'Chạy', cancelText: 'Bỏ qua', onOk: async () => { try { const r = await inventoryApi.reconcile(); modal.info({ title: r.ok ? 'Đối soát khớp ✔' : 'Phát hiện lệch', width: 640, content: <pre style={{ maxHeight: 400, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(r, null, 2)}</pre> }); } catch (e) { message.error(errMsg(e)); } } });

  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Kho hàng"><Select allowClear size="small" style={{ width: '100%' }} placeholder="Tất cả kho" value={q.warehouseId} onChange={(v) => set({ warehouseId: v })} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></FilterCard>
        <FilterCard title="Nhóm hàng"><Select allowClear showSearch optionFilterProp="label" size="small" style={{ width: '100%' }} placeholder="Tất cả nhóm" value={q.categoryId} onChange={(v) => set({ categoryId: v })} options={categories} /></FilterCard>
        <FilterCard title="Tùy chọn">
          <Checkbox checked={q.lowStock === 'true'} onChange={(e) => set({ lowStock: e.target.checked ? 'true' : undefined })}>Chỉ hàng dưới định mức</Checkbox>
          <Checkbox checked={q.nonZero !== 'false'} onChange={(e) => set({ nonZero: e.target.checked ? 'true' : 'false' })}>Ẩn dòng tồn bằng 0</Checkbox>
        </FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Báo cáo tồn kho</h1>
        <Row gutter={[10, 10]} style={{ marginBottom: 10 }}>
          <Col xs={12} md={6}><Card size="small"><Statistic title="SKU có tồn" value={summary.data?.skuCount ?? 0} /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title="Tổng tồn" value={qty(summary.data?.onHandTotal)} /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title="Đang giữ (đơn)" value={qty(summary.data?.reservedTotal)} /></Card></Col>
          <Col xs={12} md={6}><Card size="small"><Statistic title={summary.data?.stockValue !== undefined ? 'Giá trị tồn (giá vốn)' : 'Cảnh báo tồn thấp'} value={summary.data?.stockValue !== undefined ? money(summary.data.stockValue) : summary.data?.lowStockCount ?? 0} /></Card></Col>
        </Row>
        <div className="kv-toolbar">
          <div className="kv-search input-with-scan">
            <Input.Search allowClear placeholder="Theo mã, tên hàng, mã vạch" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => set({ search: v || undefined })} enterButton={<SearchOutlined />} />
            <BarcodeScanButton title="Quét mã vạch – xem tồn kho" onScan={(c) => { setSearchText(c); set({ search: c }); }} />
          </div>
          <span className="spacer" />
          {me?.user.isOwner && <Button icon={<SyncOutlined />} onClick={reconcile}>Đối soát</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => { refetch(); summary.refetch(); }} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} scroll={{ x: 900 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Không có dữ liệu tồn kho" /> }}
            onChange={(p) => set({ page: p.current, pageSize: p.pageSize })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t) => `${t} dòng` }}
            columns={[
              { title: 'Mã hàng', render: (_, b) => <b>{b.variant?.sku}</b>, width: 120 },
              { title: 'Tên hàng', render: (_, b) => <span>{b.variant?.name}<div className="kv-hint">{b.variant?.product.code} · {b.variant?.product.baseUnit ?? ''}</div></span> },
              { title: 'Kho', render: (_, b) => b.warehouse?.name, width: 140 },
              { title: 'Lô', render: (_, b) => b.batch ? <Tag color="gold">{b.batch.batchNo}{b.batch.expiryDate ? ` · HSD ${b.batch.expiryDate.slice(0, 10)}` : ''}</Tag> : '—', width: 150 },
              { title: 'Tồn kho', dataIndex: 'onHand', className: 'num', width: 90, render: (v, b) => <span className={Number(v) <= 0 ? 'neg' : b.variant?.minStock && Number(v) <= Number(b.variant.minStock) ? 'neg' : ''}>{qty(v)}</span> },
              { title: 'Đã giữ', dataIndex: 'reserved', className: 'num', width: 80, render: (v) => qty(v) },
              { title: 'Khả dụng', dataIndex: 'available', className: 'num', width: 90, render: (v) => <b>{qty(v)}</b> },
              { title: 'Tồn min', className: 'num', width: 80, render: (_, b) => b.variant?.minStock ? qty(b.variant.minStock) : '—' },
              ...(canSeeCost ? [{ title: 'Giá vốn', className: 'num', width: 110, render: (_: unknown, b: any) => money(b.variant?.costPrice) }, { title: 'Giá trị tồn', className: 'num', width: 120, render: (_: unknown, b: any) => b.value !== undefined ? money(b.value) : '' }] : []),
            ]} />
        </div>
      </div>
    </div>
  );
}
