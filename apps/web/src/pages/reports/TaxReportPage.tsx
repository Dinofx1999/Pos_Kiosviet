import { Alert, Button, Card, Empty, Skeleton } from 'antd';
import Table from '../../components/ResponsiveTable';
import { ReloadOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { errMsg } from '../../api/client';
import { TaxInputRow, TaxOutputRow, useTaxReport } from '../../api/loyalty';
import { FilterCard, FilterPanel } from '../../components/FilterPanel';
import { useIsMobile } from '../../hooks/useMedia';
import { useMe } from '../../store/auth';
import { toNum } from '../../utils/format';
import { BranchSelect, DateRangeBar, Range, Stat, presetRange, signed, vnd } from './ReportShared';
import '../settings/loyalty.css';

const rateLabel = (r: unknown) => `${toNum(r).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;

/** Báo cáo thuế GTGT (BR-155): đầu ra theo thuế suất từ hóa đơn hoàn thành, đầu vào từ phiếu nhập đã ghi sổ, số phải nộp tham khảo. */
export default function TaxReportPage() {
  const isMobile = useIsMobile();
  const me = useMe();
  const [range, setRange] = useState<Range>(() => presetRange('month'));
  const [branchId, setBranchId] = useState<string>();
  const { data, isLoading, isFetching, error, refetch } = useTaxReport({ from: range[0].toISOString(), to: range[1].toISOString(), branchId });
  const t = data?.totals;
  const payable = toNum(t?.payable);
  const includesTax = me?.settings?.['pricing.priceIncludesTax'] !== false;

  const rowsBlock = <T extends { taxRate: string; taxable: string; tax: string }>(rows: T[], count: (r: T) => number, countLabel: string, totalTaxable: unknown, totalTax: unknown, empty: string) => rows.length === 0 ? <Empty className="rp-empty" description={empty} /> : isMobile ? (
    <div className="lp-tax-rows">
      {rows.map((r) => <div className="lp-tax-row" key={r.taxRate}><span className="rate">{rateLabel(r.taxRate)}</span><span className="base">{count(r)} {countLabel} · chịu thuế <b>{vnd(r.taxable)}</b></span><span className="tax">{vnd(r.tax)}</span></div>)}
      <div className="lp-tax-row total"><span className="rate">Tổng</span><span className="base">chịu thuế <b>{vnd(totalTaxable)}</b></span><span className="tax">{vnd(totalTax)}</span></div>
    </div>
  ) : (
    <Table<T> className="kv-table" size="small" rowKey="taxRate" dataSource={rows} pagination={false}
      columns={[
        { title: 'Thuế suất', dataIndex: 'taxRate', width: 110, render: (v) => <b>{rateLabel(v)}</b> },
        { title: countLabel === 'hóa đơn' ? 'Số hóa đơn' : 'Số phiếu nhập', className: 'num', width: 130, render: (_, r) => count(r) },
        { title: 'Giá trị chịu thuế', dataIndex: 'taxable', className: 'num', render: (v) => vnd(v) },
        { title: 'Tiền thuế', dataIndex: 'tax', className: 'num', width: 160, render: (v) => <b>{vnd(v)}</b> },
      ]}
      summary={() => <Table.Summary fixed><Table.Summary.Row><Table.Summary.Cell index={0}><b>Tổng</b></Table.Summary.Cell><Table.Summary.Cell index={1} className="num"><b>{rows.reduce((s, r) => s + count(r), 0)}</b></Table.Summary.Cell><Table.Summary.Cell index={2} className="num"><b>{vnd(totalTaxable)}</b></Table.Summary.Cell><Table.Summary.Cell index={3} className="num"><b>{vnd(totalTax)}</b></Table.Summary.Cell></Table.Summary.Row></Table.Summary>} />
  );

  return (
    <div className="kv-list rp-page">
      <FilterPanel>
        <FilterCard title="Chi nhánh"><BranchSelect size="small" value={branchId} onChange={setBranchId} /></FilterCard>
      </FilterPanel>
      <div className="kv-main">
        <div className="rp-head">
          <h1 className="kv-page-title">Thuế GTGT</h1>
          <div className="rp-actions"><Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} /></div>
        </div>
        <div className="rp-toolbar"><DateRangeBar value={range} onChange={setRange} /></div>
        {error && !data && <Alert type="error" showIcon message={errMsg(error)} style={{ marginBottom: 10 }} />}
        {isLoading && !data ? <Skeleton active paragraph={{ rows: 8 }} /> : data && t && (
          <>
            <div className="rp-stats three">
              <Stat label="Thuế đầu ra" value={vnd(t.outputTax)} tone="blue" sub={`doanh thu chịu thuế ${vnd(t.outputTaxable)}`} />
              <Stat label="Thuế đầu vào" value={vnd(t.inputTax)} sub={`giá trị mua chịu thuế ${vnd(t.inputTaxable)}`} />
              <Stat label={payable < 0 ? 'Được khấu trừ' : 'Phải nộp (tham khảo)'} value={vnd(Math.abs(payable))} tone={payable > 0 ? 'warn' : payable < 0 ? 'pos' : undefined} sub={`${range[0].format('DD/MM')} – ${range[1].format('DD/MM/YYYY')}`} />
            </div>
            <div className="rp-grid2">
              <Card size="small" title="Thuế GTGT đầu ra (bán hàng)" extra={<span className="kv-hint">{includesTax ? 'giá bán đã gồm thuế' : 'thuế cộng thêm vào giá'}</span>}>
                {rowsBlock<TaxOutputRow>(data.output, (r) => r.invoices, 'hóa đơn', t.outputTaxable, t.outputTax, 'Không có hóa đơn hoàn thành trong kỳ')}
                <div className="rp-table-note">Từ dòng hóa đơn hoàn thành; giá trị chịu thuế đã trừ chiết khấu / khuyến mãi cấp hóa đơn.</div>
              </Card>
              <Card size="small" title="Thuế GTGT đầu vào (mua hàng)">
                {rowsBlock<TaxInputRow>(data.input, (r) => r.receipts, 'phiếu nhập', t.inputTaxable, t.inputTax, 'Không có phiếu nhập đã ghi sổ trong kỳ')}
                <div className="rp-table-note">Từ dòng phiếu nhập hàng đã ghi sổ{me?.settings?.['purchasing.includeTaxInCost'] !== false ? ' (thuế mua hàng đang được tính vào giá vốn)' : ''}.</div>
              </Card>
            </div>
            <div className="rp-grid2 rp-section">
              <Card size="small" title="Xác định số thuế">
                <div className="lp-tax-formula">
                  <span className="k">Thuế GTGT đầu ra</span><span className="v">{vnd(t.outputTax)}</span>
                  <span className="k">− Thuế GTGT đầu vào được khấu trừ</span><span className="v">{vnd(t.inputTax)}</span>
                  <span className="hr" />
                  <span className="k big">{payable < 0 ? 'Thuế còn được khấu trừ' : 'Thuế phải nộp'}</span><span className={`v big ${payable > 0 ? 'neg' : payable < 0 ? 'pos' : ''}`}>{signed(payable)}</span>
                </div>
              </Card>
              <Card size="small" title="Trả hàng trong kỳ">
                <div className="lp-tax-formula">
                  <span className="k">Số phiếu trả hoàn thành</span><span className="v">{data.returns.count}</span>
                  <span className="k">Tiền hoàn cho khách</span><span className="v">{vnd(data.returns.refund)}</span>
                </div>
                <div className="rp-table-note">Hoàn trả hàng được ghi nhận riêng, chưa trừ vào thuế đầu ra ở trên – kế toán đối chiếu khi lập tờ khai.</div>
              </Card>
            </div>
            <Alert type="info" showIcon style={{ marginTop: 12 }} message={data.note} />
          </>
        )}
      </div>
    </div>
  );
}
