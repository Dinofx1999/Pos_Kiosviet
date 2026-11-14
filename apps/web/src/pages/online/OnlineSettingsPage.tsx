import { Alert, App, Button, Card, ColorPicker, Form, Input, QRCode, Select, Skeleton, Switch, Tag } from 'antd';
import { CopyOutlined, ExportOutlined, FireOutlined, GlobalOutlined, SaveOutlined, ShoppingOutlined, TagOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { errMsg } from '../../api/client';
import { copyText } from '../../api/bankTransfers';
import { useCategories } from '../../api/catalog';
import { useBranches, useWarehouses } from '../../api/org';
import { onlineApi, shopUrl, useShopSettings, type ShopConfig, type ShopSettingsView } from '../../api/online';
import { ImageUploader, type ImageItem } from '../../components/ImageUploader';
import type { Category } from '../../api/types';
import { WebCategoriesCard } from './WebCategoriesCard';
import { ComboWebCard } from './ComboWebCard';
import './online.css';

type ToggleKey = 'enabled' | 'showPrice' | 'showFlashPrice' | 'flashSaleEnabled' | 'allowOrder' | 'showStock' | 'hideOutOfStock' | 'onlyWithImage';
const TOGGLES: Array<{ key: ToggleKey; title: string; on: string; off: string; icon?: React.ReactNode }> = [
  { key: 'showPrice', title: 'Hiển thị giá hàng hóa', on: 'Khách thấy giá bán của hàng hóa (giá Flash Sale bật / tắt riêng ở nút bên dưới).', off: 'Giá hàng hóa được ẩn, khách thấy "Liên hệ". Đơn đặt vẫn lưu đúng giá.', icon: <TagOutlined style={{ color: '#1677ff' }} /> },
  { key: 'showFlashPrice', title: 'Hiển thị giá Flash Sale', on: 'Khách thấy giá sốc của hàng đang Flash Sale.', off: 'Hàng Flash Sale chỉ hiện mức giảm % và "Giá sốc · Liên hệ". Đơn đặt vẫn lưu đúng giá Flash Sale.', icon: <ThunderboltOutlined style={{ color: '#fa541c' }} /> },
  { key: 'flashSaleEnabled', title: 'Flash Sale', on: 'Các chương trình Flash Sale đang bật sẽ chạy theo khung giờ.', off: 'Tạm dừng mọi chương trình Flash Sale trên web (không xóa chương trình).', icon: <FireOutlined style={{ color: '#f5222d' }} /> },
  { key: 'allowOrder', title: 'Nhận đặt hàng online', on: 'Khách cho hàng vào giỏ và gửi đơn; đơn về mục Đặt hàng (nguồn Website).', off: 'Khách chỉ xem hàng, bấm gọi hotline / nhắn Zalo để mua.' },
  { key: 'showStock', title: 'Hiện số lượng còn lại', on: 'Hiện "Còn 5 sản phẩm" (tối đa hiện 99).', off: 'Chỉ hiện trạng thái Hết hàng.' },
  { key: 'hideOutOfStock', title: 'Ẩn hàng đã hết', on: 'Hàng hết tồn ở kho web không hiện trong danh sách.', off: 'Hàng hết vẫn hiện (cuối danh sách, không đặt được).' },
  { key: 'onlyWithImage', title: 'Chỉ hiện hàng có ảnh', on: 'Hàng chưa có ảnh bị ẩn khỏi web.', off: 'Hiện cả hàng chưa có ảnh.' },
];
const COLORS = ['#d6336c', '#e64980', '#f76707', '#0ca678', '#1c7ed6', '#7048e8', '#212529'];

interface InfoForm {
  shopName?: string; hotline?: string; zalo?: string; facebook?: string; address?: string; intro?: string; themeColor: string;
  logo: Array<{ url: string }>; banner: Array<{ url: string }>; branchId?: string; warehouseId?: string; stockWarehouseIds: string[];
}

const toTree = (cats: Category[]): any[] => {
  const by = new Map<string | null, Category[]>();
  for (const c of cats) by.set(c.parentId ?? null, [...(by.get(c.parentId ?? null) ?? []), c]);
  const build = (pid: string | null): any[] => (by.get(pid) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi')).map((c) => ({ value: c.id, title: c.name, children: build(c.id) }));
  return build(null);
};

/** Bán online → Thiết lập web bán hàng: mở / đóng web, bật / tắt hiển thị giá, Flash Sale, nhận đơn; thông tin cửa hàng; kho nhận đơn. */
export default function OnlineSettingsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data: view, isLoading, error } = useShopSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const [form] = Form.useForm<InfoForm>();
  const { data: branches } = useBranches();
  const branchId = Form.useWatch('branchId', form);
  const { data: warehouses } = useWarehouses(branchId || undefined);
  const { data: allWarehouses } = useWarehouses();
  const { data: cats } = useCategories();
  const catTree = useMemo(() => toTree(Array.isArray(cats) ? flatten(cats) : []), [cats]);

  useEffect(() => {
    if (!view) return;
    const c = view.config;
    form.setFieldsValue({
      shopName: c.shopName ?? undefined, hotline: c.hotline ?? undefined, zalo: c.zalo ?? undefined, facebook: c.facebook ?? undefined, address: c.address ?? undefined, intro: c.intro ?? undefined,
      themeColor: c.themeColor, logo: c.logoUrl ? [{ url: c.logoUrl }] : [], banner: c.bannerUrl ? [{ url: c.bannerUrl }] : [], branchId: c.branchId ?? undefined, warehouseId: c.warehouseId ?? undefined, stockWarehouseIds: c.stockWarehouseIds ?? [],
    });
  }, [view]);

  const apply = (v: ShopSettingsView) => { qc.setQueryData(['shop-settings'], v); qc.invalidateQueries({ queryKey: ['online-summary'] }); };

  const toggle = async (key: ToggleKey, value: boolean) => {
    setBusy(key);
    try {
      apply(await onlineApi.saveSettings({ [key]: value } as Partial<ShopConfig>));
      const title = TOGGLES.find((x) => x.key === key)?.title ?? '';
      const t = key === 'enabled' ? 'website bán hàng' : title.startsWith('Flash') ? title : title.charAt(0).toLowerCase() + title.slice(1);
      message.success(`Đã ${value ? (key === 'enabled' ? 'mở' : 'bật') : key === 'enabled' ? 'đóng' : 'tắt'} ${t}`);
    } catch (e) { message.error(errMsg(e)); } finally { setBusy(null); }
  };

  const saveInfo = async () => {
    const v = await form.validateFields();
    setBusy('info');
    try {
      apply(await onlineApi.saveSettings({
        shopName: v.shopName?.trim() || null, hotline: v.hotline?.trim() || null, zalo: v.zalo?.trim() || null, facebook: v.facebook?.trim() || null,
        address: v.address?.trim() || null, intro: v.intro?.trim() || null, themeColor: v.themeColor, logoUrl: v.logo?.[0]?.url ?? null, bannerUrl: v.banner?.[0]?.url ?? null,
        branchId: v.branchId ?? null, warehouseId: v.warehouseId ?? null, stockWarehouseIds: v.stockWarehouseIds ?? [],
      }));
      message.success('Đã lưu thông tin web bán hàng');
    } catch (e) { message.error(errMsg(e)); } finally { setBusy(null); }
  };

  if (isLoading) return <Skeleton active />;
  if (error || !view) return <Alert type="error" message={errMsg(error)} />;
  const c = view.config;
  const url = shopUrl(view);
  const copy = async () => { if (await copyText(url)) message.success('Đã sao chép đường dẫn web'); else message.warning('Không sao chép được'); };

  return (
    <div className="ol-page">
      <h1 className="kv-page-title">Web bán hàng</h1>

      <Card size="small" className={`ol-status ${c.enabled ? 'on' : ''}`}>
        <div className="ol-status-row">
          <GlobalOutlined className="ol-status-icon" />
          <div className="ol-status-text">
            <div className="ol-status-title">Website bán hàng {c.enabled ? <Tag color="green">Đang mở</Tag> : <Tag>Đang đóng</Tag>}</div>
            <div className="kv-hint">{c.enabled ? 'Khách xem hàng và đặt hàng tại đường dẫn bên dưới.' : 'Bật để khách xem hàng, Flash Sale và đặt hàng online.'}</div>
          </div>
          <Switch checked={c.enabled} loading={busy === 'enabled'} onChange={(v) => toggle('enabled', v)} />
        </div>
        <div className="ol-link">
          <div className="ol-link-main">
            <Input readOnly value={url} />
            <div className="ol-link-btns">
              <Button icon={<CopyOutlined />} onClick={copy}>Sao chép</Button>
              <Button icon={<ExportOutlined />} href={url} target="_blank" rel="noreferrer">Mở web</Button>
            </div>
            {view.pendingOrders > 0 && <Link to="/orders?source=ONLINE&status=DRAFT" className="ol-pending"><ShoppingOutlined /> {view.pendingOrders} đơn web đang chờ xử lý →</Link>}
          </div>
          <QRCode value={url} size={112} bordered={false} className="ol-qr" />
        </div>
      </Card>

      <Card size="small" title="Bật / tắt trên web" className="ol-card">
        {TOGGLES.map((t) => (
          <div key={t.key} className="ol-toggle">
            <div className="ol-toggle-text">
              <div className="ol-toggle-title">{t.icon} {t.title}</div>
              <div className="kv-hint">{c[t.key] ? t.on : t.off}</div>
              {t.key === 'flashSaleEnabled' && <Link to="/online/flash-sales" className="ol-sub-link">Quản lý chương trình Flash Sale →</Link>}
            </div>
            <Switch checked={c[t.key]} loading={busy === t.key} onChange={(v) => toggle(t.key, v)} />
          </div>
        ))}
      </Card>

      <Card size="small" title="Thông tin hiển thị & nhận đơn" className="ol-card" extra={<Button type="primary" icon={<SaveOutlined />} loading={busy === 'info'} onClick={saveInfo}>Lưu</Button>}>
        <Form form={form} layout="vertical" className="ol-form" requiredMark={false}>
          <div className="ol-grid">
            <Form.Item name="shopName" label="Tên cửa hàng trên web" extra={`Để trống: ${view.tenantName}`}><Input maxLength={200} /></Form.Item>
            <Form.Item name="hotline" label="Hotline" rules={[{ pattern: /^[0-9+().\s-]{0,30}$/, message: 'Số điện thoại không hợp lệ' }]}><Input inputMode="tel" maxLength={30} /></Form.Item>
            <Form.Item name="zalo" label="Zalo" extra="Số điện thoại Zalo hoặc link zalo.me/…"><Input maxLength={200} /></Form.Item>
            <Form.Item name="facebook" label="Facebook" rules={[{ pattern: /^(https?:\/\/|$)/, message: 'Link phải bắt đầu bằng https://' }]}><Input placeholder="https://facebook.com/…" maxLength={500} /></Form.Item>
          </div>
          <Form.Item name="address" label="Địa chỉ cửa hàng"><Input maxLength={500} /></Form.Item>
          <Form.Item name="intro" label="Giới thiệu ngắn / thông báo trên đầu trang"><Input.TextArea rows={2} maxLength={1000} showCount /></Form.Item>
          <div className="ol-grid">
            <Form.Item name="logo" label="Logo"><OneImage /></Form.Item>
            <Form.Item name="banner" label="Ảnh bìa (ngang, ~1200×400)"><OneImage /></Form.Item>
          </div>
          <Form.Item name="themeColor" label="Màu chủ đạo" getValueFromEvent={(col) => (typeof col === 'string' ? col : col.toHexString())}>
            <ColorPicker disabledAlpha presets={[{ label: 'Gợi ý', colors: COLORS }]} showText />
          </Form.Item>
          <div className="ol-grid">
            <Form.Item name="branchId" label="Chi nhánh nhận đơn web" extra="Để trống: chi nhánh mặc định">
              <Select allowClear options={(branches ?? []).filter((b: any) => b.isActive !== false).map((b: any) => ({ value: b.id, label: b.name }))} onChange={() => form.setFieldValue('warehouseId', undefined)} />
            </Form.Item>
            <Form.Item name="warehouseId" label="Kho nhận đơn web" extra="Để trống: kho mặc định. Đơn tự chuyển sang kho khác cùng chi nhánh nếu kho này không đủ hàng.">
              <Select allowClear options={(warehouses ?? []).filter((w: any) => w.isActive !== false && (!branchId || w.branchId === branchId)).map((w: any) => ({ value: w.id, label: w.name }))} />
            </Form.Item>
          </div>
          <Form.Item name="stockWarehouseIds" label="Kho tính còn hàng trên web" extra="Cộng tồn các kho đã chọn. Để trống: cộng tất cả kho đang hoạt động.">
            <Select mode="multiple" allowClear placeholder="Tất cả kho" options={(allWarehouses ?? []).filter((w: any) => w.isActive !== false).map((w: any) => ({ value: w.id, label: w.branch?.name ? `${w.name} (${w.branch.name})` : w.name }))} />
          </Form.Item>
        </Form>
      </Card>

      <WebCategoriesCard config={c} catTree={catTree} onSaved={apply} />
      <ComboWebCard config={c} onSaved={apply} />
    </div>
  );
}

function OneImage({ value, onChange }: { value?: ImageItem[]; onChange?: (v: ImageItem[]) => void }) {
  return <ImageUploader value={value ?? []} onChange={(v) => onChange?.(v)} max={1} />;
}

function flatten(cats: Category[]): Category[] {
  const out: Category[] = [];
  const walk = (list: Category[]) => { for (const c of list) { out.push(c); if (c.children?.length) walk(c.children); } };
  walk(cats);
  return out;
}
