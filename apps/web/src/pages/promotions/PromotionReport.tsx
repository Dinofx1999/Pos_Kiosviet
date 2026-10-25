import { DatePicker, Empty, Select, Tag } from 'antd';
import Table from '../../components/ResponsiveTable';
import dayjs, { Dayjs } from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errMsg } from '../../api/client';
import { PROMOTION_TYPE_COLOR, PROMOTION_TYPE_SHORT, PromotionReportRow, usePromotionReport } from '../../api/promotions';
import { useIsMobile } from '../../hooks/useMedia';
import { useAuthStore } from '../../store/auth';
import { money, qty } from '../../utils/format';

/** "Báo cáo khuyến mãi": uses / discount / gifts / revenue per programme for a date range. */
export function PromotionReport() {
  const isMobile = useIsMobile();
  const me = useAuthStore((s) => s.me);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('day')]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const { data, isLoading, error } = usePromotionReport({ from: range[0].startOf('day').toISOString(), to: range[1].endOf('day').toISOString(), branchId });
  const rows = data?.rows ?? [];
  return (
    <div className="km-report">
      <div className="kv-toolbar">
        <DatePicker.RangePicker value={range} allowClear={false} format="DD/MM/YYYY" onChange={(r) => { if (r?.[0] && r?.[1]) setRange([r[0], r[1]]); }} presets={[{ label: 'Hôm nay', value: [dayjs().startOf('day'), dayjs().endOf('day')] }, { label: '7 ngày qua', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] }, { label: 'Tháng này', value: [dayjs().startOf('month'), dayjs().endOf('day')] }, { label: 'Tháng trước', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] }]} />
        <Select allowClear placeholder="Tất cả chi nhánh" value={branchId} onChange={setBranchId} style={{ width: 200 }} options={(me?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} />
      </div>
      <div className="km-summary three">
        <div className="km-tile"><div className="lbl">Chương trình có áp dụng</div><div className="val">{data?.totals.promotions ?? 0}</div></div>
        <div className="km-tile"><div className="lbl">Lượt áp dụng</div><div className="val">{data?.totals.uses ?? 0}</div></div>
        <div className="km-tile"><div className="lbl">Tổng tiền giảm</div><div className="val neg">{money(data?.totals.discount ?? 0)}</div></div>
      </div>
      {error && <Empty description={errMsg(error)} />}
      {isMobile ? (
        <div className="km-cards">
          {isLoading && <div className="muted">Đang tải…</div>}
          {!isLoading && !rows.length && !error && <div className="kv-card" style={{ padding: 16 }}><Empty description="Chưa có khuyến mãi nào được áp dụng trong kỳ" /></div>}
          {rows.map((r) => (
            <Link key={r.promotionId} to={`/promotions/${r.promotionId}`} className="km-card">
              <div className="km-card-head"><span><b>{r.code}</b> <Tag color={PROMOTION_TYPE_COLOR[r.type]}>{PROMOTION_TYPE_SHORT[r.type]}</Tag></span><span className="neg"><b>−{money(r.amount)}</b></span></div>
              <div className="km-card-name">{r.name}</div>
              <div className="km-card-meta">{r.uses} lượt · doanh thu {money(r.revenue)}{Number(r.gifts) > 0 ? ` · ${qty(r.gifts)} quà` : ''}</div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="kv-card">
          <Table<PromotionReportRow> size="small" rowKey="promotionId" loading={isLoading} dataSource={rows} pagination={false} locale={{ emptyText: <Empty description="Chưa có khuyến mãi nào được áp dụng trong kỳ" /> }}
            columns={[
              { title: 'Mã', dataIndex: 'code', width: 110, render: (v, r) => <Link to={`/promotions/${r.promotionId}`}><b>{v}</b></Link> },
              { title: 'Chương trình', dataIndex: 'name' },
              { title: 'Loại', dataIndex: 'type', width: 130, render: (v) => <Tag color={PROMOTION_TYPE_COLOR[v as keyof typeof PROMOTION_TYPE_COLOR]}>{PROMOTION_TYPE_SHORT[v as keyof typeof PROMOTION_TYPE_SHORT]}</Tag> },
              { title: 'Lượt áp dụng', dataIndex: 'uses', className: 'num', width: 110 },
              { title: 'Tiền giảm', dataIndex: 'amount', className: 'num', width: 130, render: (v) => <b className="neg">{money(v)}</b> },
              { title: 'SL quà tặng', dataIndex: 'gifts', className: 'num', width: 110, render: (v) => (Number(v) > 0 ? qty(v) : '') },
              { title: 'Doanh thu HĐ', dataIndex: 'revenue', className: 'num', width: 140, render: (v) => money(v) },
            ]}
            summary={() => rows.length ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3}><b>Tổng</b></Table.Summary.Cell>
                <Table.Summary.Cell index={3} className="num"><b>{data?.totals.uses ?? 0}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={4} className="num"><b className="neg">{money(data?.totals.discount ?? 0)}</b></Table.Summary.Cell>
                <Table.Summary.Cell index={5} className="num">{qty(rows.reduce((s, r) => s + Number(r.gifts), 0)) !== '0' ? qty(rows.reduce((s, r) => s + Number(r.gifts), 0)) : ''}</Table.Summary.Cell>
                <Table.Summary.Cell index={6} className="num"><b>{money(rows.reduce((s, r) => s + Number(r.revenue), 0))}</b></Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null} />
        </div>
      )}
    </div>
  );
}
