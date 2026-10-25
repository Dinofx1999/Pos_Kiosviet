import { App, Button, Descriptions, Dropdown, Empty, Image, Input, Modal, Radio, Select, Tabs, Tag, Upload } from 'antd';
import Table from '../../components/ResponsiveTable';
import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, StopOutlined, CheckCircleOutlined, UploadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { catalogApi, useBrands, useInvalidate, useProduct, useProducts, ProductQuery } from '../../api/catalog';
import { useMovements } from '../../api/inventory';
import { errMsg } from '../../api/client';
import type { Product } from '../../api/types';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useAuthStore, useBranchWarehouses, useCan } from '../../store/auth';
import { MOVEMENT_LABEL, PRODUCT_TYPE_LABEL, downloadBlob, dt, money, pct, qty, signedQty } from '../../utils/format';
import { CategoryFilter } from './CategoryFilter';
import { ProductFormModal } from './ProductFormModal';

export default function ProductsPage() {
  const { message, modal } = App.useApp();
  const can = useCan();
  const invalidate = useInvalidate();
  const [sp, setSp] = useSearchParams();
  const warehouses = useBranchWarehouses();
  const [q, setQ] = useState<ProductQuery>({ page: 1, pageSize: 20, search: sp.get('search') ?? undefined, isActive: 'true', stockStatus: (sp.get('stock') as ProductQuery['stockStatus']) ?? undefined });
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [form, setForm] = useState<{ open: boolean; product?: Product | null }>({ open: false });
  const [importRes, setImportRes] = useState<{ created: number; failed: { row: number; error: string }[]; totalRows: number } | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useProducts(q);
  const { data: brands } = useBrands();
  const canSeeCost = can('product.cost.view');

  const set = (patch: Partial<ProductQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); message.success(ok); invalidate('products', 'product', 'dashboard'); } catch (e) { message.error(errMsg(e)); } };

  const columns = useMemo(() => [
    { title: '', dataIndex: 'imageUrl', width: 44, mobile: 'image' as const, render: (v: string | null) => v ? <Image src={v} width={32} height={32} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} /> : <div style={{ width: 32, height: 32, background: '#eef2f7', borderRadius: 4 }} /> },
    { title: 'Mã hàng', dataIndex: 'code', width: 120, sorter: true, mobile: 'subtitle' as const, render: (v: string) => <b>{v}</b> },
    { title: 'Tên hàng', dataIndex: 'name', sorter: true, mobile: 'title' as const, render: (v: string, r: Product) => <span>{v} {r.type !== 'GOODS' && <Tag color={r.type === 'COMBO' ? 'purple' : 'cyan'}>{PRODUCT_TYPE_LABEL[r.type]}</Tag>} {r.variants.length > 1 && <Tag>{r.variants.length} biến thể</Tag>} {r.trackBatch && <Tag color="gold">Lô</Tag>}</span> },
    { title: 'Nhóm hàng', width: 140, render: (_: unknown, r: Product) => r.category?.name ?? <span className="muted">—</span> },
    { title: 'Giá bán', dataIndex: 'sellPrice', className: 'num', width: 110, mobile: 'right' as const, render: (v: string, r: Product) => r.variants.length > 1 ? <span>{money(Math.min(...r.variants.map((x) => Number(x.sellPrice))))}{r.variants.length > 1 ? '+' : ''}</span> : money(v) },
    ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'costPrice', className: 'num', width: 110, render: (v: string) => money(v) }] : []),
    { title: 'Tồn kho', dataIndex: 'onHand', className: 'num', width: 90, render: (v: string, r: Product) => r.type === 'SERVICE' ? <span className="muted">—</span> : <span className={Number(v) <= 0 ? 'neg' : ''}>{qty(v)}</span> },
    { title: 'Trạng thái', dataIndex: 'isActive', width: 120, mobile: 'badge' as const, mobileRender: (v: boolean) => (v ? null : <Tag>Ngừng KD</Tag>), render: (v: boolean) => v ? <Tag color="green">Đang kinh doanh</Tag> : <Tag>Ngừng kinh doanh</Tag> },
    { title: 'Ngày tạo', dataIndex: 'createdAt', width: 130, sorter: true, mobile: 'hide' as const, render: (v: string) => dt(v) },
  ], [canSeeCost]);

  return (
    <div className="kv-list">
      <FilterPanel>
        <FilterCard title="Nhóm hàng"><CategoryFilter value={q.categoryId} onChange={(id) => set({ categoryId: id })} /></FilterCard>
        <FilterCard title="Tồn kho">
          <Select size="small" allowClear placeholder="Tất cả kho (toàn hệ thống)" style={{ width: '100%', marginBottom: 6 }} value={q.warehouseId} onChange={(v) => set({ warehouseId: v })} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <Radio.Group value={q.stockStatus ?? ''} onChange={(e) => set({ stockStatus: e.target.value || undefined })}>
            <Radio value="">Tất cả</Radio><Radio value="in">Còn hàng</Radio><Radio value="low">Dưới định mức tồn</Radio><Radio value="over">Vượt định mức tồn</Radio><Radio value="out">Hết hàng</Radio>
          </Radio.Group>
        </FilterCard>
        <FilterCard title="Trạng thái">
          <Radio.Group value={q.isActive ?? ''} onChange={(e) => set({ isActive: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="true">Đang kinh doanh</Radio><Radio value="false">Ngừng kinh doanh</Radio></Radio.Group>
        </FilterCard>
        <FilterCard title="Loại hàng">
          <Radio.Group value={q.type ?? ''} onChange={(e) => set({ type: e.target.value || undefined })}><Radio value="">Tất cả</Radio><Radio value="GOODS">Hàng hóa</Radio><Radio value="SERVICE">Dịch vụ</Radio><Radio value="COMBO">Combo</Radio></Radio.Group>
        </FilterCard>
        <FilterCard title="Thương hiệu" extra={can('brand.manage') && <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => { let name = ''; modal.confirm({ title: 'Thêm thương hiệu', autoFocusButton: null, content: <Input autoFocus placeholder="Tên thương hiệu" onChange={(e) => (name = e.target.value)} />, okText: 'Thêm', cancelText: 'Hủy', onOk: async () => { if (!name.trim()) { message.warning('Nhập tên thương hiệu'); throw new Error('empty'); } await catalogApi.createBrand(name.trim()).catch((e) => { message.error(errMsg(e)); throw e; }); message.success('Đã thêm thương hiệu'); invalidate('brands'); } }); }} />}>
          <Select size="small" allowClear showSearch optionFilterProp="label" placeholder="Chọn thương hiệu" style={{ width: '100%' }} value={q.brandId} onChange={(v) => set({ brandId: v })}
            options={(brands ?? []).map((b) => ({ value: b.id, label: `${b.name}${b._count ? ` (${b._count.products})` : ''}` }))}
            optionRender={(o) => <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{o.label}</span>{can('brand.manage') && <DeleteOutlined onClick={(e) => { e.stopPropagation(); modal.confirm({ title: 'Xóa thương hiệu?', okText: 'Xóa', okButtonProps: { danger: true }, onOk: () => act(() => catalogApi.deleteBrand(o.value as string), 'Đã xóa').then(() => invalidate('brands')) }); }} />}</div>} />
        </FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <h1 className="kv-page-title">Hàng hóa</h1>
        <div className="kv-toolbar">
          <Input.Search className="kv-search" allowClear placeholder="Theo mã, tên hàng, mã vạch" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={(v) => { set({ search: v || undefined }); setSp(v ? { search: v } : {}); }} enterButton={<SearchOutlined />} />
          <span className="spacer" />
          {can('product.create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({ open: true, product: null })}>Thêm mới</Button>}
          {can('product.import') && (
            <Dropdown menu={{ items: [
              { key: 'tpl', icon: <DownloadOutlined />, label: 'Tải file mẫu', onClick: async () => { try { downloadBlob(await catalogApi.importTemplate(), 'mau-nhap-hang-hoa.xlsx'); } catch (e) { message.error(errMsg(e)); } } },
              { key: 'up', label: <Upload accept=".xlsx" showUploadList={false} customRequest={async ({ file }) => { try { const r = await catalogApi.importXlsx(file as File); setImportRes(r); invalidate('products', 'categories', 'brands'); } catch (e) { message.error(errMsg(e)); } }}><span><UploadOutlined /> Chọn file Excel…</span></Upload> },
            ] }}><Button icon={<UploadOutlined />}>Import</Button></Dropdown>
          )}
          {can('product.export') && <Button icon={<DownloadOutlined />} onClick={async () => { try { downloadBlob(await catalogApi.exportXlsx(), 'hang-hoa.xlsx'); } catch (e) { message.error(errMsg(e)); } }}>Xuất file</Button>}
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} />
        </div>
        <div className="kv-card">
          <Table className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data?.data ?? []} columns={columns as any} rowSelection={{}} scroll={{ x: 900 }}
            locale={{ emptyText: error ? <Empty description={errMsg(error)} /> : <Empty description="Không có hàng hóa phù hợp" /> }}
            expandable={{ expandedRowRender: (r) => <ProductDetail product={r} onEdit={() => setForm({ open: true, product: r })} />, expandRowByClick: true }}
            onChange={(p, _f, sorter: any) => set({ page: p.current, pageSize: p.pageSize, sortBy: sorter?.field && sorter.order ? sorter.field : undefined, sortDir: sorter?.order === 'ascend' ? 'asc' : sorter?.order === 'descend' ? 'desc' : undefined })}
            pagination={{ current: q.page, pageSize: q.pageSize, total: data?.meta.total ?? 0, showSizeChanger: true, pageSizeOptions: [15, 20, 50, 100], showTotal: (t, r) => `${r[0]}-${r[1]} / ${t} hàng hóa` }} />
        </div>
      </div>
      <ProductFormModal open={form.open} product={form.product} onClose={() => setForm({ open: false })} onSaved={() => setForm({ open: false })} />
      <Modal title="Kết quả import" open={!!importRes} onCancel={() => setImportRes(null)} footer={<Button onClick={() => setImportRes(null)}>Đóng</Button>}>
        {importRes && <>
          <p>Tổng dòng: <b>{importRes.totalRows}</b> · Tạo thành công: <b className="pos">{importRes.created}</b> hàng hóa · Lỗi: <b className="neg">{importRes.failed.length}</b></p>
          {importRes.failed.length > 0 && <Table size="small" rowKey="row" pagination={false} dataSource={importRes.failed} columns={[{ title: 'Dòng', dataIndex: 'row', width: 70 }, { title: 'Lỗi', dataIndex: 'error' }]} scroll={{ y: 300 }} />}
        </>}
      </Modal>
    </div>
  );
}

function ProductDetail({ product, onEdit }: { product: Product; onEdit: () => void }) {
  const { message, modal } = App.useApp();
  const can = useCan();
  const invalidate = useInvalidate();
  const canSeeCost = useAuthStore((s) => s.can('product.cost.view'));
  const { data: full } = useProduct(product.id);
  const p = full ?? product;
  const [tab, setTab] = useState('info');
  const mv = useMovements({ productId: product.id, page: 1, pageSize: 20 }, tab === 'card' && can('inventory.movement.view'));

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); message.success(ok); invalidate('products', 'product', 'dashboard', 'balances'); } catch (e) { message.error(errMsg(e)); } };

  return (
    <div>
      <Tabs className="kv-detail-tabs" activeKey={tab} onChange={setTab} items={[
        { key: 'info', label: 'Thông tin', children: (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              {(() => {
                const imgs = (p.images ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.url);
                const urls = imgs.length ? imgs : p.imageUrl ? [p.imageUrl] : [];
                return urls.length ? (
                  <Image.PreviewGroup>
                    <div className="kv-gallery">
                      {urls.map((u, i) => <Image key={u} src={u} width={i === 0 ? 120 : 56} height={i === 0 ? 120 : 56} style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e7eb' }} alt={`${p.name} ${i + 1}`} />)}
                    </div>
                  </Image.PreviewGroup>
                ) : <div className="kv-gallery-empty">Chưa có hình ảnh</div>;
              })()}
              <Descriptions size="small" column={1} colon={false} labelStyle={{ width: 140, color: '#6b7280' }}>
                <Descriptions.Item label="Mã hàng"><b>{p.code}</b></Descriptions.Item>
                <Descriptions.Item label="Tên hàng">{p.name}</Descriptions.Item>
                <Descriptions.Item label="Loại">{PRODUCT_TYPE_LABEL[p.type]}</Descriptions.Item>
                <Descriptions.Item label="Nhóm hàng">{p.category?.name ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Thương hiệu">{p.brand?.name ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Đơn vị tính">{p.baseUnit ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Thuế">{pct(p.taxRate) || '—'}</Descriptions.Item>
                <Descriptions.Item label="Theo dõi lô">{p.trackBatch ? 'Có' : 'Không'}</Descriptions.Item>
                <Descriptions.Item label="Mô tả">{p.description || '—'}</Descriptions.Item>
              </Descriptions>
            </div>
            <div style={{ flex: '2 1 480px' }}>
              <Table size="small" rowKey="id" pagination={false} dataSource={p.variants} title={() => <b>Biến thể / đơn vị tồn</b>}
                columns={[
                  { title: 'SKU', dataIndex: 'sku' }, { title: 'Mã vạch', dataIndex: 'barcode', render: (v) => v ?? '—' },
                  { title: 'Thuộc tính', render: (_, v) => v.attributes ? Object.entries(v.attributes).map(([k, val]) => <Tag key={k}>{k}: {val}</Tag>) : '—' },
                  { title: 'Giá bán', dataIndex: 'sellPrice', className: 'num', render: (v) => money(v) },
                  ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'costPrice', className: 'num', render: (v: string) => money(v) }] : []),
                  { title: 'Tồn', dataIndex: 'onHandTotal', className: 'num', render: (v) => qty(v) },
                  { title: 'Min/Max', render: (_, v) => `${v.minStock ? qty(v.minStock) : '—'} / ${v.maxStock ? qty(v.maxStock) : '—'}` },
                ]} />
              {p.units.length > 0 && <Table size="small" style={{ marginTop: 8 }} rowKey="unitName" pagination={false} dataSource={p.units} title={() => <b>Đơn vị quy đổi</b>} columns={[{ title: 'Đơn vị', dataIndex: 'unitName' }, { title: 'Quy đổi', render: (_, u) => `1 ${u.unitName} = ${qty(u.conversionFactor)} ${p.baseUnit ?? ''}` }, { title: 'SKU', dataIndex: 'sku', render: (v) => v ?? '—' }, { title: 'Mã vạch', dataIndex: 'barcode', render: (v) => v ?? '—' }, { title: 'Giá bán', dataIndex: 'sellPrice', className: 'num', render: (v) => v ? money(v) : '—' }]} />}
              {p.type === 'COMBO' && <Table size="small" style={{ marginTop: 8 }} rowKey="componentVariantId" pagination={false} dataSource={p.comboItems} title={() => <b>Thành phần combo</b>} columns={[{ title: 'Hàng hóa', render: (_, c) => `${c.componentVariant?.sku} · ${c.componentVariant?.name}` }, { title: 'Số lượng', dataIndex: 'quantity', className: 'num', render: (v) => qty(v) }, { title: 'Tồn thành phần', className: 'num', render: (_, c) => qty(c.componentVariant?.onHandTotal) }]} />}
            </div>
          </div>
        ) },
        ...(can('inventory.movement.view') ? [{ key: 'card', label: 'Thẻ kho', children: (
          <Table size="small" rowKey="id" loading={mv.isLoading} pagination={false} dataSource={mv.data?.data ?? []} locale={{ emptyText: 'Chưa có giao dịch kho' }}
            columns={[
              { title: 'Chứng từ', dataIndex: 'documentCode' }, { title: 'Thời gian', dataIndex: 'createdAt', render: (v) => dt(v) },
              { title: 'Loại', dataIndex: 'type', render: (v) => MOVEMENT_LABEL[v] ?? v }, { title: 'Biến thể', render: (_, m) => m.variant?.sku }, { title: 'Kho', render: (_, m) => m.warehouse?.name },
              ...(canSeeCost ? [{ title: 'Giá vốn', dataIndex: 'unitCost', className: 'num', render: (v: string) => money(v) }] : []),
              { title: 'Số lượng', dataIndex: 'quantity', className: 'num', render: (v) => <span className={Number(v) >= 0 ? 'pos' : 'neg'}>{signedQty(v)}</span> },
              { title: 'Tồn cuối', dataIndex: 'balanceAfter', className: 'num', render: (v) => qty(v) },
            ]} />
        ) }] : []),
        { key: 'stock', label: 'Tồn kho', children: (
          <Table size="small" rowKey="id" pagination={false} dataSource={full?.balances ?? []} locale={{ emptyText: 'Chưa có tồn kho' }}
            columns={[
              { title: 'Kho', render: (_, b) => b.warehouse?.name }, { title: 'Biến thể', render: (_, b) => p.variants.find((v) => v.id === b.variantId)?.sku }, { title: 'Lô', render: (_, b) => b.batch?.batchNo ?? '—' },
              { title: 'Tồn kho', dataIndex: 'onHand', className: 'num', render: (v) => qty(v) }, { title: 'Đã giữ', dataIndex: 'reserved', className: 'num', render: (v) => qty(v) }, { title: 'Khả dụng', dataIndex: 'available', className: 'num', render: (v) => <b>{qty(v)}</b> },
            ]} />
        ) },
      ]} />
      <div className="kv-detail-actions">
        {can('product.update') && <Button icon={<EditOutlined />} type="primary" onClick={onEdit}>Cập nhật</Button>}
        {can('product.update') && (p.isActive
          ? <Button icon={<StopOutlined />} onClick={() => modal.confirm({ title: `Ngừng kinh doanh ${p.code}?`, content: 'Hàng sẽ không hiển thị khi bán nhưng vẫn giữ lịch sử.', okText: 'Đồng ý', cancelText: 'Bỏ qua', onOk: () => act(() => catalogApi.setActive(p.id, false), 'Đã ngừng kinh doanh') })}>Ngừng kinh doanh</Button>
          : <Button icon={<CheckCircleOutlined />} onClick={() => act(() => catalogApi.setActive(p.id, true), 'Đã cho phép kinh doanh')}>Cho phép kinh doanh</Button>)}
        {can('product.delete') && <Button danger icon={<DeleteOutlined />} onClick={() => modal.confirm({ title: `Xóa hàng hóa ${p.code}?`, content: 'Chỉ xóa được khi chưa phát sinh giao dịch kho.', okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua', onOk: () => act(() => catalogApi.deleteProduct(p.id), 'Đã xóa hàng hóa') })}>Xóa</Button>}
      </div>
    </div>
  );
}
