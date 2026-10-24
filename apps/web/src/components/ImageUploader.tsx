import { App, Image, Upload } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { catalogApi } from '../api/catalog';
import { errMsg } from '../api/client';

export interface ImageItem { url: string }

/**
 * Multi-image picker for products: uploads to POST /uploads/images, shows thumbnails (first = ảnh đại diện),
 * supports preview, "đặt đại diện" and removal. `value` is the ordered list of image URLs.
 */
export function ImageUploader({ value, onChange, max = 20, disabled }: { value: ImageItem[]; onChange: (v: ImageItem[]) => void; max?: number; disabled?: boolean }) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);

  const fileList: UploadFile[] = value.map((img, i) => ({ uid: img.url, name: img.url.split('/').pop() ?? `anh-${i + 1}`, status: 'done', url: img.url, thumbUrl: img.url }));

  const beforeUpload: UploadProps['beforeUpload'] = (file, batch) => {
    const okType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type);
    if (!okType) { message.error(`"${file.name}" không phải ảnh JPEG/PNG/GIF/WebP`); return Upload.LIST_IGNORE; }
    if (file.size > 5 * 1024 * 1024) { message.error(`"${file.name}" vượt quá 5MB`); return Upload.LIST_IGNORE; }
    if (value.length + batch.length > max) { message.error(`Tối đa ${max} ảnh`); return Upload.LIST_IGNORE; }
    return true;
  };

  const customRequest: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    setUploading((n) => n + 1);
    try {
      const [img] = await catalogApi.uploadImages([file as File]);
      onChange([...value, { url: img.url }]);
      onSuccess?.(img);
    } catch (e) { message.error(errMsg(e)); onError?.(e as Error); } finally { setUploading((n) => n - 1); }
  };

  const onRemove = (f: UploadFile) => {
    onChange(value.filter((v) => v.url !== f.uid));
    if (f.uid.startsWith('/uploads/')) catalogApi.deleteImage(f.uid).catch(() => undefined);
    return true;
  };

  const makePrimary = (url: string) => onChange([{ url }, ...value.filter((v) => v.url !== url)]);

  return (
    <div className="kv-images">
      <Upload listType="picture-card" multiple accept="image/*" fileList={fileList} beforeUpload={beforeUpload} customRequest={customRequest} onRemove={onRemove} disabled={disabled}
        onPreview={(f) => setPreview(f.url ?? null)}
        itemRender={(node, file) => (
          <div className="kv-image-item" title={file.uid === value[0]?.url ? 'Ảnh đại diện' : 'Đặt làm ảnh đại diện'}>
            {node}
            {file.uid === value[0]?.url ? <span className="kv-image-badge">Đại diện</span> : <a className="kv-image-set" onClick={(e) => { e.preventDefault(); makePrimary(file.uid); }}>Đặt đại diện</a>}
          </div>
        )}>
        {value.length < max && !disabled && (
          <div><PlusOutlined /><div style={{ marginTop: 6, fontSize: 12 }}>{uploading ? 'Đang tải…' : 'Thêm ảnh'}</div></div>
        )}
      </Upload>
      <div className="kv-hint">Tối đa {max} ảnh, mỗi ảnh ≤ 5MB (JPEG/PNG/GIF/WebP). Ảnh đầu tiên là ảnh đại diện; rê chuột vào ảnh và bấm "Đặt đại diện" để đổi.</div>
      {preview && <Image style={{ display: 'none' }} preview={{ visible: true, src: preview, onVisibleChange: (v) => { if (!v) setPreview(null); } }} />}
    </div>
  );
}
