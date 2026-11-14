import { App, Button, Drawer, Dropdown, Input, Modal, Spin, Tag, Upload } from 'antd';
import { GiftOutlined, CloseOutlined, DownOutlined, DownloadOutlined, EllipsisOutlined, FilterOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SwapOutlined, UploadOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { catalogApi, useInvalidate, useProducts, type ProductQuery } from '../../api/catalog';
import { useBalanceSummary } from '../../api/inventory';
import { errMsg } from '../../api/client';
import type { Product } from '../../api/types';
import { BarcodeScanButton } from '../../components/BarcodeScanner';
import { FilterPanel } from '../../components/FilterPanel';
import Table from '../../components/ResponsiveTable';
import { useCan } from '../../store/auth';
import { PRODUCT_TYPE_LABEL, downloadBlob, money, qty } from '../../utils/format';
import { ProductDetail, ProductFilters } from './ProductsPage';
import { ProductFormModal } from './ProductFormModal';
import './products.css';

const PAGE = 30;
const TYPE_LABEL: Record<string, string> = { '': 'Tất cả loại hàng', GOODS: 'Hàng hóa', SERVICE: 'Dịch vụ', COMBO: 'Combo' };
const STOCK_LABEL: Record<string, string> = { '': 'Tồn kho', in: 'Còn hàng', low: 'Dưới định mức', over: 'Vượt định mức', out: 'Hết hàng' };
const SORTS: Array<{ key: string; label: string; sortBy?: string; sortDir?: 'asc' | 'desc' }> = [
  { key: 'new', label: 'Mới nhất', sortBy: undefined, sortDir: undefined },
  { key: 'name_asc', label: 'Tên A → Z', sortBy: 'name', sortDir: 'asc' },
  { key: 'name_desc', label: 'Tên Z → A', sortBy: 'name', sortDir: 'desc' },
  { key: 'code', label: 'Mã hàng', sortBy: 'code', sortDir: 'asc' },
  { key: 'updated', label: 'Sửa gần đây', sortBy: 'updatedAt', sortDir: 'desc' },
];

/** Hàng hóa trên điện thoại – bố cục như app KiotViet: tiêu đề + tìm / sắp xếp / thêm, chip lọc, tổng tồn, dòng hàng (ảnh, tên, mã | giá, tồn), nút +. */
export function ProductsMobile() {
  const { message } = App.useApp();
  const can = useCan();
  const invalidate = useInvalidate();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const canSeeCost = can('product.cost.view');
  const [q, setQ] = useState<ProductQuery>({ page: 1, pageSize: PAGE, search: sp.get('search') ?? undefined, isActive: 'true', stockStatus: (sp.get('stock') as ProductQuery['stockStatus']) ?? undefined });
  const [searchOpen, setSearchOpen] = useState(!!q.search);
  const [searchText, setSearchText] = useState(q.search ?? '');
  const [show, setShow] = useState<'sell' | 'cost'>('sell');
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<Product[]>([]);
  const [detail, setDetail] = useState<Product | null>(null);
  const [form, setForm] = useState<{ open: boolean; product?: Product | null }>({ open: false });
  const [importRes, setImportRes] = useState<{ created: number; failed: { row: number; error: string }[]; totalRows: number } | null>(null);
  const { data, isFetching, isPlaceholderData, error, refetch } = useProducts(q);
  const { data: summary } = useBalanceSummary(q.warehouseId);
  const sentinel = useRef<HTMLDivElement>(null);
  const total = data?.meta.total ?? 0;

  const set = (patch: Partial<ProductQuery>) => setQ((s) => ({ ...s, ...patch, page: patch.page ?? 1 }));

  // gom các trang đã tải thành một danh sách cuộn liên tục
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    setItems((cur) => (q.page === 1 ? data.data : [...cur, ...data.data.filter((x) => !cur.some((c) => c.id === x.id))]));
  }, [data, isPlaceholderData, q.page]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && !isFetching && items.length < total) set({ page: (q.page ?? 1) + 1 }); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [isFetching, items.length, total, q.page]);
  // mở lại từ liên kết có ?search= / ?stock=
  useEffect(() => { const s = sp.get('search'); if (s && s !== q.search) { setSearchText(s); setSearchOpen(true); set({ search: s }); } }, [sp]);

  const activeFilters = [q.categoryId, q.brandId, q.warehouseId, q.stockStatus, q.type, q.isActive !== 'true' ? 'x' : undefined].filter(Boolean).length;
  const sortKey = SORTS.find((x) => x.sortBy === q.sortBy && (x.sortDir ?? undefined) === (q.sortDir ?? undefined))?.key ?? 'new';
  const priceOf = (p: Product) => {
    if (show === 'cost') return p.costPrice !== undefined ? money(p.costPrice) : '—';
    if (p.variants.length > 1) return `${money(Math.min(...p.variants.map((x) => Number(x.sellPrice))))}+`;
    return money(p.sellPrice ?? p.variants[0]?.sellPrice ?? 0);
  };
  const doSearch = (v: string) => { set({ search: v || undefined }); setSp(v ? { search: v } : {}); };
  const refresh = () => invalidate('products', 'product', 'dashboard');

  const moreMenu = useMemo(() => ({ items: [
    can('product.create') ? { key: 'add', icon: <PlusOutlined />, label: 'Thêm hàng hóa', onClick: () => setForm({ open: true, product: null }) } : null,
    { key: 'combo', icon: <GiftOutlined />, label: 'Combo', onClick: () => nav('/products/combos') },
    can('product.import') ? { key: 'tpl', icon: <DownloadOutlined />, label: 'Tải file mẫu Excel', onClick: async () => { try { downloadBlob(await catalogApi.importTemplate(), 'mau-nhap-hang-hoa.xlsx'); } catch (e) { message.error(errMsg(e)); } } } : null,
    can('product.import') ? { key: 'up', label: <Upload accept=".xlsx" showUploadList={false} customRequest={async ({ file }) => { try { const r = await catalogApi.importXlsx(file as File); setImportRes(r); invalidate('products', 'categories', 'brands'); } catch (e) { message.error(errMsg(e)); } }}><span><UploadOutlined /> Import từ Excel…</span></Upload> } : null,
    can('product.export') ? { key: 'export', icon: <DownloadOutlined />, label: 'Xuất file Excel', onClick: async () => { try { downloadBlob(await catalogApi.exportXlsx(), 'hang-hoa.xlsx'); } catch (e) { message.error(errMsg(e)); } } } : null,
    { key: 'reload', icon: <ReloadOutlined />, label: 'Tải lại', onClick: () => refetch() },
  ].filter(Boolean) as any[] }), [can]);

  return (
    <div className="pm">
      <div className="pm-head">
        <h1>Hàng hóa</h1>
        <div className="pm-icons">
          <button type="button" className={searchOpen ? 'on' : ''} aria-label="Tìm hàng" onClick={() => { if (searchOpen && searchText) { setSearchText(''); doSearch(''); } setSearchOpen(!searchOpen); }}>{searchOpen ? <CloseOutlined /> : <SearchOutlined />}</button>
          <Dropdown trigger={['click']} menu={{ items: SORTS.map((x) => ({ key: x.key, label: x.label })), selectedKeys: [sortKey], onClick: ({ key }) => { const x = SORTS.find((y) => y.key === key)!; set({ sortBy: x.sortBy, sortDir: x.sortDir }); } }}>
            <button type="button" aria-label="Sắp xếp"><SwapOutlined rotate={90} /></button>
          </Dropdown>
          <Dropdown trigger={['click']} menu={moreMenu}><button type="button" aria-label="Thêm thao tác"><EllipsisOutlined /></button></Dropdown>
        </div>
      </div>
      {searchOpen && (
        <div className="pm-search input-with-scan">
          <Input.Search autoFocus allowClear placeholder="Theo mã, tên hàng, mã vạch" value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={doSearch} enterButton={<SearchOutlined />} />
          <BarcodeScanButton title="Quét mã vạch – tìm hàng" onScan={(c) => { setSearchText(c); doSearch(c); }} />
        </div>
      )}
      <div className="pm-chips">
        <button type="button" className={`pm-chip icon ${activeFilters ? 'on' : ''}`} aria-label="Bộ lọc" onClick={() => setFilterOpen(true)}><FilterOutlined />{activeFilters > 0 && <i className="pm-dot">{activeFilters}</i>}</button>
        <Dropdown trigger={['click']} menu={{ items: Object.entries(TYPE_LABEL).map(([k, l]) => ({ key: k, label: l })), selectedKeys: [q.type ?? ''], onClick: ({ key }) => set({ type: key || undefined }) }}>
          <button type="button" className={`pm-chip ${q.type ? 'on' : ''}`}>{TYPE_LABEL[q.type ?? '']} <DownOutlined /></button>
        </Dropdown>
        {canSeeCost && (
          <Dropdown trigger={['click']} menu={{ items: [{ key: 'sell', label: 'Giá bán' }, { key: 'cost', label: 'Giá vốn' }], selectedKeys: [show], onClick: ({ key }) => setShow(key as 'sell' | 'cost') }}>
            <button type="button" className="pm-chip">{show === 'sell' ? 'Giá bán' : 'Giá vốn'} <DownOutlined /></button>
          </Dropdown>
        )}
        <Dropdown trigger={['click']} menu={{ items: Object.entries(STOCK_LABEL).map(([k, l]) => ({ key: k, label: l })), selectedKeys: [q.stockStatus ?? ''], onClick: ({ key }) => set({ stockStatus: (key || undefined) as ProductQuery['stockStatus'] }) }}>
          <button type="button" className={`pm-chip ${q.stockStatus ? 'on' : ''}`}>{STOCK_LABEL[q.stockStatus ?? '']} <DownOutlined /></button>
        </Dropdown>
      </div>

      <div className="pm-summary">
        <div><div className="k">{summary ? 'Tổng tồn' : 'Hàng hóa'}</div><div className="n">{total.toLocaleString('vi-VN')} hàng hóa{q.search ? ` · "${q.search}"` : ''}</div></div>
        {summary && <div className="v">{qty(summary.onHandTotal)}</div>}
      </div>

      <div className="pm-list">
        {items.map((p) => (
          <div key={p.id} className={`pm-row ${p.isActive ? '' : 'off'}`} onClick={() => setDetail(p)} role="button">
            {p.imageUrl ? <img className="pm-img" src={p.imageUrl} alt="" loading="lazy" /> : <div className="pm-img ph" />}
            <div className="pm-main">
              <div className="pm-name">{p.name}</div>
              <div className="pm-code">{p.code}{p.type !== 'GOODS' && <Tag color={p.type === 'COMBO' ? 'purple' : 'cyan'}>{PRODUCT_TYPE_LABEL[p.type]}</Tag>}{p.variants.length > 1 && <Tag>{p.variants.length} biến thể</Tag>}{p.trackBatch && <Tag color="gold">Lô</Tag>}{!p.isActive && <Tag>Ngừng KD</Tag>}</div>
            </div>
            <div className="pm-right">
              <div className="pm-price">{priceOf(p)}</div>
              {p.type !== 'SERVICE' && <div className={`pm-stock ${Number(p.onHand) <= 0 ? 'zero' : ''}`}>Tồn: {qty(p.onHand)}{p.baseUnit ? ` ${p.baseUnit}` : ''}</div>}
            </div>
          </div>
        ))}
        {!isFetching && items.length === 0 && <div className="pm-empty">{error ? errMsg(error) : 'Không có hàng hóa phù hợp'}</div>}
        {isFetching && <div className="pm-loading"><Spin size="small" /> Đang tải…</div>}
        {!isFetching && items.length > 0 && items.length >= total && <div className="pm-end">Đã hiện hết {total.toLocaleString('vi-VN')} hàng hóa</div>}
        <div ref={sentinel} />
      </div>

      {can('product.create') && <button type="button" className="pm-fab" aria-label="Thêm hàng hóa" onClick={() => setForm({ open: true, product: null })}><PlusOutlined /></button>}

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} hideToggle><ProductFilters q={q} set={set} /></FilterPanel>
      <Drawer className="pm-detail" placement="bottom" height="92%" open={!!detail} onClose={() => setDetail(null)} title={detail ? <div className="pm-detail-title"><div>{detail.name}</div><div className="pm-code">{detail.code}</div></div> : null} destroyOnHidden>
        {detail && <ProductDetail product={detail} onEdit={() => { setForm({ open: true, product: detail }); }} />}
      </Drawer>
      <ProductFormModal open={form.open} product={form.product} onClose={() => setForm({ open: false })} onSaved={() => { setForm({ open: false }); setDetail(null); refresh(); }} />
      <Modal title="Kết quả import" open={!!importRes} onCancel={() => setImportRes(null)} footer={<Button onClick={() => setImportRes(null)}>Đóng</Button>}>
        {importRes && <>
          <p>Tổng dòng: <b>{importRes.totalRows}</b> · Tạo thành công: <b className="pos">{importRes.created}</b> hàng hóa · Lỗi: <b className="neg">{importRes.failed.length}</b></p>
          {importRes.failed.length > 0 && <Table size="small" rowKey="row" pagination={false} dataSource={importRes.failed} columns={[{ title: 'Dòng', dataIndex: 'row', width: 70 }, { title: 'Lỗi', dataIndex: 'error' }]} />}
        </>}
      </Modal>
    </div>
  );
}
