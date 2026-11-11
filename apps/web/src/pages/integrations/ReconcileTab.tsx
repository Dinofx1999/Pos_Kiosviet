import { Alert, Button, Card, Empty, Skeleton } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ReloadOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { type Reconcile, useReconcile } from '../../api/integrations';
import { errMsg } from '../../api/client';
import { useIsMobile } from '../../hooks/useMedia';
import { d, dt, money, qty } from '../../utils/format';
import { IMPORT_TYPE_LABEL, JobDrawer, SourceTag, totalsSummary } from './shared';

/** Tiles to compare with KiotViet's Tổng quan / Hàng hóa / Công nợ screens. */
export function ReconcileTiles({ data }: { data: Reconcile }) {
  const groups: Array<{ title: string; hint: string; items: Array<{ label: string; value: string; tone?: 'pos' | 'neg' }> }> = [
    { title: 'Hàng hóa', hint: 'KiotViet: Hàng hóa → Danh mục (tổng số hàng, tồn kho)', items: [
      { label: 'Hàng hóa', value: qty(data.products.products) }, { label: 'SKU / đơn vị', value: qty(data.products.variants) }, { label: 'SKU có tồn', value: qty(data.products.withStock) },
      { label: 'Số lượng tồn', value: qty(data.stock.quantity) }, { label: 'Giá trị tồn (giá vốn)', value: money(data.stock.value) },
    ] },
    { title: 'Khách hàng', hint: 'KiotViet: Khách hàng (tổng nợ cần thu)', items: [
      { label: 'Khách hàng', value: qty(data.customers.count) }, { label: 'Đang nợ', value: qty(data.customers.debtors) }, { label: 'Phải thu', value: money(data.customers.receivable), tone: 'neg' }, { label: 'Khách có số dư', value: money(data.customers.credit), tone: 'pos' },
    ] },
    { title: 'Nhà cung cấp', hint: 'KiotViet: Đối tác → Nhà cung cấp (tổng nợ cần trả)', items: [
      { label: 'Nhà cung cấp', value: qty(data.suppliers.count) }, { label: 'Đang nợ', value: qty(data.suppliers.creditors) }, { label: 'Phải trả', value: money(data.suppliers.payable), tone: 'neg' },
    ] },
    { title: 'Hóa đơn lịch sử', hint: 'KiotViet: Giao dịch → Hóa đơn (cùng khoảng ngày)', items: [
      { label: 'Số hóa đơn', value: qty(data.importedInvoices.count) }, { label: 'Doanh thu', value: money(data.importedInvoices.revenue) },
      { label: 'Khoảng ngày', value: data.importedInvoices.first ? `${d(data.importedInvoices.first)} → ${d(data.importedInvoices.last)}` : '—' },
    ] },
    { title: 'Trả hàng lịch sử', hint: 'KiotViet: Giao dịch → Trả hàng (cùng khoảng ngày)', items: [
      { label: 'Số phiếu trả', value: qty(data.importedReturns?.count ?? 0) }, { label: 'Tiền trả khách', value: money(data.importedReturns?.refund ?? 0) },
      { label: 'Khoảng ngày', value: data.importedReturns?.first ? `${d(data.importedReturns.first)} → ${d(data.importedReturns.last)}` : '—' },
    ] },
    { title: 'Nhập hàng lịch sử', hint: 'KiotViet: Mua hàng → Nhập hàng (cùng khoảng ngày)', items: [
      { label: 'Số phiếu nhập', value: qty(data.importedPurchases?.count ?? 0) }, { label: 'Tiền hàng nhập', value: money(data.importedPurchases?.total ?? 0) },
      { label: 'Khoảng ngày', value: data.importedPurchases?.first ? `${d(data.importedPurchases.first)} → ${d(data.importedPurchases.last)}` : '—' },
    ] },
    { title: 'Đặt hàng lịch sử', hint: 'KiotViet: Đơn hàng → Đặt hàng (cùng khoảng ngày)', items: [
      { label: 'Số đơn', value: qty(data.importedOrders?.count ?? 0) }, { label: 'Đơn hoàn thành', value: money(data.importedOrders?.total ?? 0) }, { label: 'Đơn còn mở', value: qty(data.importedOrders?.open ?? 0) },
      { label: 'Khoảng ngày', value: data.importedOrders?.first ? `${d(data.importedOrders.first)} → ${d(data.importedOrders.last)}` : '—' },
    ] },
    { title: 'Sổ quỹ lịch sử', hint: 'KiotViet: Sổ quỹ (cùng khoảng ngày)', items: [
      { label: 'Số phiếu', value: qty(data.importedCash?.count ?? 0) }, { label: 'Tổng thu', value: money(data.importedCash?.income ?? 0) }, { label: 'Tổng chi', value: money(data.importedCash?.expense ?? 0) },
      { label: 'Khoảng ngày', value: data.importedCash?.first ? `${d(data.importedCash.first)} → ${d(data.importedCash.last)}` : '—' },
    ] },
    { title: 'Kiểm kho lịch sử', hint: 'KiotViet: Kho hàng → Kiểm kho (cùng khoảng ngày)', items: [
      { label: 'Số phiếu kiểm', value: qty(data.importedStocktakes?.count ?? 0) }, { label: 'Dòng kiểm', value: qty(data.importedStocktakes?.lines ?? 0) }, { label: 'Phiếu tạm', value: qty(data.importedStocktakes?.open ?? 0) },
      { label: 'Khoảng ngày', value: data.importedStocktakes?.first ? `${d(data.importedStocktakes.first)} → ${d(data.importedStocktakes.last)}` : '—' },
    ] },
    { title: 'Trả hàng nhập & xuất hủy lịch sử', hint: 'KiotViet: Mua hàng → Trả hàng nhập; Kho hàng → Xuất hủy', items: [
      { label: 'Phiếu trả hàng nhập', value: qty(data.importedPurchaseReturns?.count ?? 0) }, { label: 'Tiền trả NCC', value: money(data.importedPurchaseReturns?.total ?? 0) },
      { label: 'Phiếu xuất hủy', value: qty(data.importedDamages?.count ?? 0) }, { label: 'Giá trị hủy', value: money(data.importedDamages?.cost ?? 0) },
    ] },
  ];
  return (
    <div className="ig-recon">
      {groups.map((g) => (
        <Card key={g.title} size="small" title={g.title} className="ig-card ig-recon-card" extra={<span className="kv-hint ig-recon-hint">{g.hint}</span>}>
          <div className="ig-tiles">
            {g.items.map((it) => (
              <div key={it.label} className={`ig-tile${it.tone ? ` ig-tile-${it.tone}` : ''}${it.value.length > 9 ? ' long' : ''}`}>
                <div className="ig-tile-v">{it.value}</div>
                <div className="ig-tile-l">{it.label}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

export function ReconcileTab() {
  const { data, isLoading, isFetching, error, refetch } = useReconcile();
  const isMobile = useIsMobile();
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <div className="ig-reconcile">
      <Alert type="info" showIcon className="ig-hint" message="So sánh các con số dưới đây với màn hình Tổng quan / Hàng hóa / Công nợ trong KiotViet trước khi chuyển hẳn sang hệ thống mới." action={<Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>Làm mới</Button>} />
      {isLoading && <Skeleton active paragraph={{ rows: 6 }} />}
      {error && <Empty description={errMsg(error)} />}
      {data && <ReconcileTiles data={data} />}
      {data && (
        <Card size="small" title="Lần nhập gần đây" className="ig-card">
          {data.recentJobs.length === 0 ? <Empty description="Chưa có lần nhập nào hoàn thành" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : isMobile ? (
            <div className="ig-job-cards">
              {data.recentJobs.map((j) => (
                <button type="button" key={j.id} className="ig-job-card" onClick={() => setJobId(j.id)}>
                  <div className="ig-job-head"><b>{IMPORT_TYPE_LABEL[j.type] ?? j.type}</b><SourceTag source={j.source} /></div>
                  <div className="ig-job-meta">{totalsSummary(j.totals)}</div>
                  <div className="kv-hint">{j.finishedAt ? dt(j.finishedAt) : ''}</div>
                </button>
              ))}
            </div>
          ) : (
            <Table size="small" rowKey="id" pagination={false} dataSource={data.recentJobs} className="kv-table" onRow={(r) => ({ onClick: () => setJobId(r.id) })}
              columns={[
                { title: 'Thời gian', dataIndex: 'finishedAt', width: 150, render: (v) => v ? dt(v) : '—' },
                { title: 'Loại', dataIndex: 'type', width: 140, render: (v) => IMPORT_TYPE_LABEL[v as keyof typeof IMPORT_TYPE_LABEL] ?? v },
                { title: 'Nguồn', dataIndex: 'source', width: 130, render: (v) => <SourceTag source={v} /> },
                { title: 'Kết quả', render: (_, r) => totalsSummary(r.totals) },
              ]} />
          )}
        </Card>
      )}
      <JobDrawer id={jobId} onClose={() => setJobId(null)} />
    </div>
  );
}
