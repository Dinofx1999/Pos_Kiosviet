import { App, Button, Card, Input, Switch, Tag } from 'antd';
import { GiftOutlined, SaveOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProducts } from '../../api/catalog';
import { errMsg } from '../../api/client';
import { onlineApi, type ShopConfig, type ShopSettingsView } from '../../api/online';
import { CatImage } from './WebCategoriesCard';

/**
 * Bán online → Thiết lập → "Combo trên web" (BR-189): ẩn / hiện mục Combo (khối ở trang chủ, ô đầu Danh mục, mục trên thanh danh mục),
 * tiêu đề khối, tên ô và ảnh ô Combo. Tắt thì combo vẫn bán như hàng thường trong danh mục của nó và khi tìm kiếm.
 */
export function ComboWebCard({ config, onSaved }: { config: ShopConfig; onSaved: (v: ShopSettingsView) => void }) {
  const { message } = App.useApp();
  const { data } = useProducts({ type: 'COMBO', isActive: 'true', pageSize: 1 });
  const total = data?.meta.total;
  const [title, setTitle] = useState('');
  const [label, setLabel] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'toggle' | 'save' | null>(null);
  const reset = () => { setTitle(config.comboTitle ?? ''); setLabel(config.comboLabel ?? ''); setImage(config.comboImageUrl ?? null); };
  useEffect(reset, [config.comboTitle, config.comboLabel, config.comboImageUrl]);
  const dirty = title.trim() !== (config.comboTitle ?? '') || label.trim() !== (config.comboLabel ?? '') || image !== (config.comboImageUrl ?? null);
  const on = config.showCombos !== false;

  const save = async (patch: Partial<ShopConfig>, kind: 'toggle' | 'save', ok: string) => {
    setBusy(kind);
    try { onSaved(await onlineApi.saveSettings(patch)); message.success(ok); } catch (e) { message.error(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <Card
      size="small" className="ol-card ol-combo"
      title={<>Combo trên web {dirty && <Tag color="orange">Chưa lưu</Tag>}</>}
      extra={<Switch checked={on} loading={busy === 'toggle'} checkedChildren="Hiện" unCheckedChildren="Ẩn" onChange={(v) => save({ showCombos: v }, 'toggle', v ? 'Đã hiện mục Combo trên web' : 'Đã ẩn mục Combo trên web')} />}
    >
      <div className="kv-hint">
        {on ? 'Web có khối combo ở trang chủ, ô Combo đầu mục Danh mục và mục Combo trên thanh danh mục.' : 'Đang ẩn mục Combo. Combo vẫn bán như hàng thường trong nhóm của nó và khi khách tìm kiếm.'}
        {total !== undefined && <> {total > 0 ? `Đang có ${total} combo.` : 'Chưa có combo nào đang bán.'} <Link to="/products/combos">Quản lý combo</Link></>}
      </div>
      <div className={`ol-combo-row ${on ? '' : 'off'}`}>
        <CatImage url={image} auto={null} onChange={setImage} autoLabel="Mặc định" placeholder={<GiftOutlined className="ol-combo-gift" />} />
        <div className="ol-combo-fields">
          <label><span>Tiêu đề khối ở trang chủ</span><Input value={title} maxLength={60} placeholder="Combo ưu đãi" onChange={(e) => setTitle(e.target.value)} /></label>
          <label><span>Tên ô trong Danh mục</span><Input value={label} maxLength={30} placeholder="Combo" onChange={(e) => setLabel(e.target.value)} /></label>
        </div>
      </div>
      <div className="kv-hint">Bấm vào ảnh để chọn ảnh riêng cho ô Combo (ảnh vuông, sẽ cắt tròn); để trống thì dùng biểu tượng hộp quà. Để trống tiêu đề / tên thì dùng "Combo ưu đãi" / "Combo".</div>
      {dirty && (
        <div className="ol-cat-foot">
          <Button onClick={reset}>Hoàn tác</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={busy === 'save'} onClick={() => save({ comboTitle: title.trim() || null, comboLabel: label.trim() || null, comboImageUrl: image }, 'save', 'Đã lưu mục Combo trên web')}>Lưu</Button>
        </div>
      )}
    </Card>
  );
}
