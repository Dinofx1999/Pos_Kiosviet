import { Alert, App, Button, DatePicker, Empty, Form, Input, InputNumber, Modal, Segmented, Switch, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, FireOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../api/client';
import { FLASH_STATE_COLOR, FLASH_STATE_LABEL, onlineApi, useFlashSales, useShopSettings, type FlashSaleDetail, type FlashSaleRow } from '../../api/online';
import type { SearchHit } from '../../api/types';
import { ProductSearch } from '../../components/ProductSearch';
import Table from '../../components/ResponsiveTable';
import { useIsMobile } from '../../hooks/useMedia';
import { dt, money, moneyFormatter, moneyParser, toNum } from '../../utils/format';
import './online.css';

const STATES = [{ value: '', label: 'Tất cả' }, { value: 'RUNNING', label: 'Đang diễn ra' }, { value: 'UPCOMING', label: 'Sắp diễn ra' }, { value: 'ENDED', label: 'Đã kết thúc' }, { value: 'OFF', label: 'Đang tắt' }];

/** Bán online → Flash Sale: danh sách chương trình, bật / tắt từng chương trình, tạo / sửa. */
export default function FlashSalesPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [state, setState] = useState('');
  const { data, isLoading, error } = useFlashSales(state || undefined);
  const { data: settings } = useShopSettings();
  const [editing, setEditing] = useState<string | null | undefined>(undefined); // undefined = đóng, null = tạo mới
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['flash-sales'] }); qc.invalidateQueries({ queryKey: ['flash-sale'] }); };

  const toggle = async (r: FlashSaleRow, v: boolean) => {
    setBusy(r.id);
    try { await onlineApi.toggleFlashSale(r.id, v); message.success(`${v ? 'Đã bật' : 'Đã tắt'} "${r.name}"`); refresh(); } catch (e) { message.error(errMsg(e)); } finally { setBusy(null); }
  };
  const remove = (r: FlashSaleRow) => modal.confirm({
    title: `Xóa chương trình "${r.name}"?`, content: r.soldQuantity > 0 ? `Đã có ${r.soldQuantity} suất được đặt. Các đơn đã đặt giữ nguyên giá.` : undefined, okText: 'Xóa', okButtonProps: { danger: true }, cancelText: 'Bỏ qua',
    onOk: async () => { try { await onlineApi.removeFlashSale(r.id); message.success('Đã xóa'); refresh(); } catch (e) { message.error(errMsg(e)); } },
  });
  const enableGlobal = async () => {
    try { const v = await onlineApi.saveSettings({ flashSaleEnabled: true }); qc.setQueryData(['shop-settings'], v); message.success('Đã bật Flash Sale trên web'); } catch (e) { message.error(errMsg(e)); }
  };

  return (
    <div className="ol-page wide">
      <h1 className="kv-page-title"><ThunderboltOutlined style={{ color: '#f5222d' }} /> Flash Sale</h1>
      {settings && !settings.config.flashSaleEnabled && (
        <Alert type="warning" showIcon className="ol-alert" message="Flash Sale đang tắt trên web" description="Các chương trình bên dưới tạm dừng cho tới khi bật lại." action={<Button size="small" type="primary" onClick={enableGlobal}>Bật Flash Sale</Button>} />
      )}
      {settings && !settings.config.enabled && (
        <Alert type="info" showIcon className="ol-alert" message="Website bán hàng đang đóng" action={<Link to="/online/settings"><Button size="small">Thiết lập web</Button></Link>} />
      )}
      <div className="kv-toolbar">
        <Segmented value={state} onChange={(v) => setState(String(v))} options={STATES} className="ol-seg" />
        <div className="spacer" />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>Tạo Flash Sale</Button>
      </div>
      <div className="kv-card">
        <Table<FlashSaleRow> className="kv-table" rowKey="id" size="small" loading={isLoading} dataSource={data ?? []} pagination={false}
          locale={{ emptyText: <Empty description={error ? errMsg(error) : 'Chưa có chương trình Flash Sale'} /> }}
          onRow={(r) => ({ onClick: () => setEditing(r.id), style: { cursor: 'pointer' } })}
          columns={[
            { title: 'Chương trình', dataIndex: 'name', render: (v, r) => <div><div style={{ fontWeight: 600 }}><FireOutlined style={{ color: '#f5222d' }} /> {v}</div>{r.note && <div className="kv-hint">{r.note}</div>}</div> },
            { title: 'Thời gian', key: 'time', render: (_, r) => <span className="kv-hint" style={{ color: 'inherit' }}>{dt(r.startsAt, 'DD/MM HH:mm')} → {dt(r.endsAt, 'DD/MM/YY HH:mm')}</span> },
            { title: 'Số hàng', dataIndex: 'itemCount', width: 80, className: 'num' },
            { title: 'Đã bán / suất', key: 'sold', width: 110, className: 'num', render: (_, r) => `${r.soldQuantity} / ${r.quantityLimit ?? '∞'}` },
            { title: 'Trạng thái', dataIndex: 'state', width: 120, mobile: 'right', render: (v: FlashSaleRow['state']) => <Tag color={FLASH_STATE_COLOR[v]}>{FLASH_STATE_LABEL[v]}</Tag> },
            { title: 'Bật', key: 'on', width: 70, render: (_, r) => <span onClick={(e) => e.stopPropagation()}><Switch size="small" checked={r.isActive} loading={busy === r.id} onChange={(v) => toggle(r, v)} /></span> },
            { title: '', key: 'act', width: 80, render: (_, r) => <span onClick={(e) => e.stopPropagation()}><Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(r.id)} /><Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(r)} /></span> },
          ]} />
      </div>
      <FlashSaleEditor id={editing} onClose={() => setEditing(undefined)} onSaved={() => { refresh(); setEditing(undefined); }} />
    </div>
  );
}

// ---------------------------------------------------------------- tạo / sửa
interface Row { variantId: string; name: string; sku: string; sellPrice: number; imageUrl?: string | null; salePrice: number | null; quantityLimit: number | null; perOrderLimit: number | null; soldQuantity: number }

function FlashSaleEditor({ id, onClose, onSaved }: { id: string | null | undefined; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const open = id !== undefined;
  const [form] = Form.useForm<{ name: string; range: [Dayjs, Dayjs]; isActive: boolean; note?: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkPct, setBulkPct] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setBulkPct(null);
    if (!id) {
      const start = dayjs().add(1, 'hour').startOf('hour');
      form.setFieldsValue({ name: `Flash Sale ${start.format('HH[h] DD/MM')}`, range: [start, start.add(2, 'hour')], isActive: true, note: undefined });
      setRows([]);
      return;
    }
    setLoading(true);
    onlineApi.flashSale(id).then((fs: FlashSaleDetail) => {
      form.setFieldsValue({ name: fs.name, range: [dayjs(fs.startsAt), dayjs(fs.endsAt)], isActive: fs.isActive, note: fs.note ?? undefined });
      setRows(fs.items.map((i) => ({ variantId: i.variantId, name: i.variant.name, sku: i.variant.sku, sellPrice: toNum(i.variant.sellPrice), imageUrl: i.variant.imageUrl ?? i.variant.product.imageUrl, salePrice: toNum(i.salePrice), quantityLimit: i.quantityLimit, perOrderLimit: i.perOrderLimit, soldQuantity: i.soldQuantity })));
    }).catch((e) => message.error(errMsg(e))).finally(() => setLoading(false));
  }, [open, id]);

  const add = (hit: SearchHit) => {
    if (hit.product.type === 'SERVICE') { message.warning('Dịch vụ không bán trên web'); return; }
    if (hit.product.trackBatch) { message.warning('Hàng quản lý theo lô chưa bán được trên web'); return; }
    if (rows.some((r) => r.variantId === hit.id)) { message.info('Hàng đã có trong chương trình'); return; }
    const sell = toNum(hit.sellPrice);
    setRows((rs) => [...rs, { variantId: hit.id, name: hit.name, sku: hit.sku, sellPrice: sell, imageUrl: hit.imageUrl ?? hit.product.imageUrl, salePrice: bulkPct ? Math.round((sell * (100 - bulkPct)) / 100 / 1000) * 1000 || null : null, quantityLimit: null, perOrderLimit: null, soldQuantity: 0 }]);
  };
  const patch = (vid: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.variantId === vid ? { ...r, ...p } : r)));
  const applyBulk = () => {
    if (!bulkPct) return;
    setRows((rs) => rs.map((r) => ({ ...r, salePrice: Math.max(0, Math.round((r.sellPrice * (100 - bulkPct)) / 100 / 1000) * 1000) })));
  };
  const invalid = useMemo(() => rows.filter((r) => r.salePrice === null || r.salePrice >= r.sellPrice || (r.quantityLimit !== null && r.perOrderLimit !== null && r.perOrderLimit > r.quantityLimit)), [rows]);

  const save = async () => {
    const v = await form.validateFields();
    if (!rows.length) { message.warning('Thêm ít nhất 1 hàng hóa'); return; }
    if (invalid.length) { message.warning(`Kiểm tra giá Flash Sale của "${invalid[0].name}" (phải thấp hơn giá bán)`); return; }
    setSaving(true);
    try {
      const body = {
        name: v.name.trim(), startsAt: v.range[0].second(0).toISOString(), endsAt: v.range[1].second(0).toISOString(), isActive: v.isActive, note: v.note?.trim() || undefined,
        items: rows.map((r) => ({ variantId: r.variantId, salePrice: String(r.salePrice), quantityLimit: r.quantityLimit, perOrderLimit: r.perOrderLimit })),
      };
      if (id) await onlineApi.updateFlashSale(id, body); else await onlineApi.createFlashSale(body);
      message.success(id ? 'Đã lưu Flash Sale' : 'Đã tạo Flash Sale');
      onSaved();
    } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <Modal className="ol-editor" title={id ? 'Sửa Flash Sale' : 'Tạo Flash Sale'} open={open} onCancel={onClose} width={900} destroyOnHidden
      style={isMobile ? { top: 0, maxWidth: '100vw', margin: 0, paddingBottom: 0 } : undefined}
      footer={[<Button key="c" onClick={onClose}>Bỏ qua</Button>, <Button key="s" type="primary" loading={saving} onClick={save}>Lưu</Button>]}>
      <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
        <div className="ol-grid">
          <Form.Item name="name" label="Tên chương trình" rules={[{ required: true, whitespace: true, message: 'Nhập tên chương trình' }]}><Input maxLength={200} /></Form.Item>
          <Form.Item name="range" label="Thời gian diễn ra" rules={[{ required: true, message: 'Chọn thời gian' }]}>
            <DatePicker.RangePicker showTime={{ format: 'HH:mm' }} format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} inputReadOnly={isMobile} placeholder={['Bắt đầu', 'Kết thúc']} />
          </Form.Item>
        </div>
        <div className="ol-grid">
          <Form.Item name="note" label="Ghi chú"><Input maxLength={500} /></Form.Item>
          <Form.Item name="isActive" label="Bật chương trình" valuePropName="checked"><Switch /></Form.Item>
        </div>
      </Form>
      <div className="ol-items-head">
        <div className="ol-items-search"><ProductSearch onPick={add} placeholder="Thêm hàng vào Flash Sale (tên, mã, mã vạch)" /></div>
        <div className="ol-bulk">
          <InputNumber min={1} max={99} value={bulkPct} onChange={(v) => setBulkPct(v)} addonAfter="%" placeholder="Giảm" style={{ width: 120 }} />
          <Button onClick={applyBulk} disabled={!bulkPct || !rows.length}>Áp dụng tất cả</Button>
        </div>
      </div>
      {!rows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có hàng – tìm và chọn hàng ở ô phía trên" />}
      <div className="ol-items">
        {rows.map((r) => {
          const pct = r.salePrice !== null && r.sellPrice > 0 ? Math.round((1 - r.salePrice / r.sellPrice) * 100) : null;
          const bad = r.salePrice === null || r.salePrice >= r.sellPrice;
          return (
            <div key={r.variantId} className={`ol-item ${bad ? 'bad' : ''}`}>
              <div className="ol-item-top">
                {r.imageUrl ? <img src={r.imageUrl} alt="" className="ol-item-img" /> : <div className="ol-item-img ph" />}
                <div className="ol-item-name"><div className="nm">{r.name}</div><div className="kv-hint">{r.sku} · Giá bán {money(r.sellPrice)}{r.soldQuantity > 0 ? ` · đã bán ${r.soldQuantity}` : ''}</div></div>
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => setRows((rs) => rs.filter((x) => x.variantId !== r.variantId))} />
              </div>
              <div className="ol-item-fields">
                <label><span>Giá Flash Sale</span><InputNumber min={0} value={r.salePrice ?? undefined} status={bad ? 'error' : undefined} formatter={moneyFormatter} parser={moneyParser} onChange={(v) => patch(r.variantId, { salePrice: v === null ? null : Number(v) })} style={{ width: '100%' }} inputMode="numeric" /></label>
                <label><span>Giảm</span><InputNumber min={1} max={99} value={pct ?? undefined} addonAfter="%" onChange={(v) => patch(r.variantId, { salePrice: v ? Math.round((r.sellPrice * (100 - Number(v))) / 100) : null })} style={{ width: '100%' }} inputMode="numeric" /></label>
                <label><span>Số suất</span><InputNumber min={Math.max(1, r.soldQuantity)} value={r.quantityLimit ?? undefined} placeholder="Không giới hạn" onChange={(v) => patch(r.variantId, { quantityLimit: v ? Number(v) : null })} style={{ width: '100%' }} inputMode="numeric" /></label>
                <label><span>Tối đa / đơn</span><InputNumber min={1} value={r.perOrderLimit ?? undefined} placeholder="Không giới hạn" onChange={(v) => patch(r.variantId, { perOrderLimit: v ? Number(v) : null })} style={{ width: '100%' }} inputMode="numeric" /></label>
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > 0 && <div className="kv-hint" style={{ marginTop: 8 }}>Khách đặt quá số suất hoặc quá tối đa mỗi đơn: phần vượt tính giá bán thường. Đơn bị hủy sẽ trả lại suất.</div>}
    </Modal>
  );
}
