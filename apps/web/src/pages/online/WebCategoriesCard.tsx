import { Alert, App, Button, Card, Input, Segmented, Skeleton, Switch, Tag, TreeSelect, Upload } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CameraOutlined, LoadingOutlined, PictureOutlined, SaveOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { catalogApi } from '../../api/catalog';
import { errMsg } from '../../api/client';
import { onlineApi, useShopCategories, type ShopAdminCategory, type ShopConfig, type ShopSettingsView } from '../../api/online';
import { catName } from '../../shop/format';

interface Row extends ShopAdminCategory { imageUrl: string | null; webName: string }

/** Thứ tự tự động giống web: danh mục nhiều hàng trước, danh mục chưa có hàng cuối. */
const byCount = (a: Row, b: Row) => b.count - a.count || a.name.localeCompare(b.name, 'vi');

function buildRows(cats: ShopAdminCategory[], cfg: ShopConfig): Row[] {
  const over = new Map(cfg.webCategories.map((w, i) => [w.id, { ...w, pos: i }]));
  const rows = cats.map((c) => ({ ...c, imageUrl: over.get(c.id)?.imageUrl ?? null, webName: over.get(c.id)?.name ?? '' }));
  if (!cfg.customCategoryOrder) return rows.sort(byCount);
  const pos = (id: string) => over.get(id)?.pos ?? Number.MAX_SAFE_INTEGER;
  return rows.sort((a, b) => pos(a.id) - pos(b.id) || byCount(a, b));
}

/**
 * Bán online → Thiết lập → "Danh mục trên web": ẩn / hiện từng danh mục, sắp xếp thứ tự (thanh danh mục + ô danh mục trang chủ),
 * ảnh đại diện riêng và tên hiển thị ngắn. Lưu một lần cho cả danh sách.
 */
export function WebCategoriesCard({ config, catTree, onSaved }: { config: ShopConfig; catTree: any[]; onSaved: (v: ShopSettingsView) => void }) {
  const { message } = App.useApp();
  const { data: cats, isLoading, error, refetch } = useShopCategories();
  const [rows, setRows] = useState<Row[]>([]);
  const [custom, setCustom] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // nạp lại khi danh sách danh mục hoặc phần cấu hình danh mục đổi (bật / tắt nút khác không làm mất chỉnh sửa đang dở)
  const sig = JSON.stringify([config.webCategories, config.customCategoryOrder, config.hiddenCategoryIds]);
  const reset = () => { if (!cats) return; setRows(buildRows(cats, config)); setCustom(config.customCategoryOrder); setHidden(config.hiddenCategoryIds); };
  useEffect(reset, [cats, sig]);

  const payload = useMemo(() => ({
    customCategoryOrder: custom, hiddenCategoryIds: hidden,
    webCategories: rows.map((r) => ({ id: r.id, imageUrl: r.imageUrl, name: r.webName.trim() || null })),
  }), [rows, custom, hidden]);
  const saved = useMemo(() => (cats ? JSON.stringify({ customCategoryOrder: config.customCategoryOrder, hiddenCategoryIds: config.hiddenCategoryIds, webCategories: buildRows(cats, config).map((r) => ({ id: r.id, imageUrl: r.imageUrl, name: r.webName.trim() || null })) }) : ''), [cats, sig]);
  const dirty = !!cats && JSON.stringify(payload) !== saved;

  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const n = [...rs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const setMode = (v: string) => { const c = v === 'custom'; setCustom(c); if (!c) setRows((rs) => [...rs].sort(byCount)); };

  const save = async () => {
    setSaving(true);
    try { onSaved(await onlineApi.saveSettings(payload)); refetch(); message.success('Đã lưu danh mục trên web'); } catch (e) { message.error(errMsg(e)); } finally { setSaving(false); }
  };

  const shown = rows.filter((r) => !hidden.includes(r.id) && r.count > 0).length;
  return (
    <Card
      size="small" className="ol-card" title={<>Danh mục trên web {dirty && <Tag color="orange">Chưa lưu</Tag>}</>}
      extra={<Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>Lưu</Button>}
    >
      {isLoading ? <Skeleton active /> : error ? <Alert type="error" message={errMsg(error)} /> : (
        <>
          <div className="ol-cat-head">
            <Segmented size="small" value={custom ? 'custom' : 'auto'} onChange={(v) => setMode(String(v))} options={[{ value: 'auto', label: 'Tự động (nhiều hàng trước)' }, { value: 'custom', label: 'Tự sắp xếp' }]} />
            <span className="kv-hint">Hiện {shown}/{rows.length} danh mục. {custom ? 'Bấm ↑ ↓ để đổi thứ tự.' : 'Bấm ↑ ↓ để chuyển sang tự sắp xếp.'}</span>
          </div>
          <div className="kv-hint ol-cat-note">Thứ tự dùng cho thanh danh mục đầu trang (8 danh mục đầu) và mục Danh mục ở trang chủ. Ảnh: bấm vào ảnh để chọn ảnh riêng (ảnh vuông, sẽ cắt tròn); chưa chọn thì web lấy ảnh hàng bán chạy.</div>
          <div className="ol-cats">
            {rows.map((r, i) => {
              const off = hidden.includes(r.id);
              return (
                <div key={r.id} className={`ol-cat ${off || r.count === 0 ? 'off' : ''}`}>
                  <div className="ol-cat-ord">
                    <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} aria-label="Lên" onClick={() => { setCustom(true); move(i, -1); }} />
                    <span className="no">{i + 1}</span>
                    <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={i === rows.length - 1} aria-label="Xuống" onClick={() => { setCustom(true); move(i, 1); }} />
                  </div>
                  <CatImage url={r.imageUrl} auto={r.autoImageUrl} onChange={(u) => patch(r.id, { imageUrl: u })} />
                  <div className="ol-cat-main">
                    <div className="ol-cat-title">
                      <b>{catName(r.name)}</b>
                      <span className="kv-hint">{r.count.toLocaleString('vi-VN')} hàng{r.children ? ` · ${r.children} nhóm con` : ''}</span>
                      {r.count === 0 && <Tag className="ol-cat-tag">Chưa có hàng hiện được</Tag>}
                    </div>
                    <Input size="small" value={r.webName} maxLength={60} placeholder="Tên trên web (tùy chọn)" onChange={(e) => patch(r.id, { webName: e.target.value })} />
                  </div>
                  <Switch size="small" checked={!off} checkedChildren="Hiện" unCheckedChildren="Ẩn" onChange={(v) => setHidden((h) => (v ? h.filter((x) => x !== r.id) : [...h, r.id]))} />
                </div>
              );
            })}
          </div>
          <div className="ol-cat-sub">
            <div className="ol-toggle-title">Ẩn nhóm hàng con</div>
            <div className="kv-hint">Ẩn riêng một nhóm con (ẩn danh mục cấp 1 thì ẩn cả nhóm con). Hàng ngừng kinh doanh, hàng theo lô và dịch vụ luôn không hiện trên web.</div>
            <TreeSelect
              multiple treeCheckable showCheckedStrategy={TreeSelect.SHOW_PARENT} treeData={catTree} value={hidden} onChange={(v) => setHidden(v as string[])}
              placeholder="Chọn nhóm hàng cần ẩn" allowClear treeNodeFilterProp="title" maxTagCount="responsive" style={{ width: '100%' }}
            />
          </div>
          {dirty && <div className="ol-cat-foot"><Button onClick={reset}>Hoàn tác</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>Lưu danh mục</Button></div>}
        </>
      )}
    </Card>
  );
}

/** Ảnh đại diện danh mục: ảnh riêng (viền màu) hoặc ảnh tự động (mờ); bấm để tải ảnh mới. */
function CatImage({ url, auto, onChange }: { url: string | null; auto: string | null; onChange: (u: string | null) => void }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const pick = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) { message.error('Chọn ảnh JPEG / PNG / WebP'); return; }
    if (file.size > 5 * 1024 * 1024) { message.error('Ảnh tối đa 5MB'); return; }
    setBusy(true);
    try { const [img] = await catalogApi.uploadImages([file]); onChange(img.url); } catch (e) { message.error(errMsg(e)); } finally { setBusy(false); }
  };
  const src = url ?? auto;
  return (
    <div className="ol-cat-img">
      <Upload accept="image/jpeg,image/png,image/webp,image/gif" showUploadList={false} beforeUpload={(f) => { void pick(f); return false; }}>
        <button type="button" className={`ol-cat-pic ${url ? 'own' : 'auto'}`} title={url ? 'Đổi ảnh' : 'Chọn ảnh riêng'}>
          <span className="circle">{src ? <img src={src} alt="" /> : <PictureOutlined />}</span>
          <span className="cam">{busy ? <LoadingOutlined /> : <CameraOutlined />}</span>
        </button>
      </Upload>
      {url ? <button type="button" className="ol-cat-clear" onClick={() => onChange(null)}>Bỏ ảnh</button> : <span className="ol-cat-auto">Tự động</span>}
    </div>
  );
}
