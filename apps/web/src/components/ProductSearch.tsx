import { AutoComplete, Input, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { catalogApi } from '../api/catalog';
import type { SearchHit } from '../api/types';
import { money, qty } from '../utils/format';
import { errMsg } from '../api/client';
import { App } from 'antd';
import { useIsMobile } from '../hooks/useMedia';
import { BarcodeScanButton } from './BarcodeScanner';

export interface ProductSearchHandle { focus: () => void }

/** Search box with debounce + barcode-scanner support (Enter with no highlighted option → lookup by barcode). */
/** scanContinuous: nút camera quét liên tục (bán hàng) – mỗi mã quét được thêm ngay, camera giữ mở. */
export const ProductSearch = forwardRef<ProductSearchHandle, { onPick: (hit: SearchHit) => void; warehouseId?: string; placeholder?: string; goodsOnly?: boolean; autoFocus?: boolean; size?: 'middle' | 'large'; scanContinuous?: boolean }>(
  function ProductSearch({ onPick, warehouseId, placeholder = 'Tìm hàng hóa theo mã, tên hoặc quét mã vạch (F3)', goodsOnly, autoFocus, size = 'large', scanContinuous }, ref) {
    const { message } = App.useApp();
    const [value, setValue] = useState('');
    const [options, setOptions] = useState<{ value: string; label: React.ReactNode; hit: SearchHit }[]>([]);
    const timer = useRef<number>();
    const seq = useRef(0); // search sequence: results of a search started before the last pick/clear are ignored
    const inputRef = useRef<any>(null);
    const isMobile = useIsMobile(); // phones: the popup must not be wider than the input (520px overflows a 375px screen)
    useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus?.() }));

    const runSearch = (q: string) => {
      window.clearTimeout(timer.current);
      const my = ++seq.current;
      if (!q.trim()) { setOptions([]); return; }
      timer.current = window.setTimeout(async () => {
        try {
          const hits = await catalogApi.search(q, warehouseId);
          if (my !== seq.current) return; // a pick or a newer query happened meanwhile
          setOptions(hits.filter((h) => !goodsOnly || h.product.type === 'GOODS').map((h) => ({
            value: h.id, hit: h,
            label: (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, whiteSpace: 'normal' }}>{h.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{h.sku}{h.barcode ? ` · ${h.barcode}` : ''}{h.product.baseUnit ? ` · ${h.product.baseUnit}` : ''} {h.product.type !== 'GOODS' && <Tag>{h.product.type}</Tag>}</div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div>{money(h.sellPrice)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>Tồn: {qty(h.onHand ?? h.onHandTotal)}</div>
                </div>
              </div>
            ),
          })));
        } catch (e) { message.error(errMsg(e)); }
      }, 250);
    };

    const pick = (hit: SearchHit) => { window.clearTimeout(timer.current); seq.current++; onPick(hit); setValue(''); setOptions([]); };
    /** camera: mã vạch / mã hàng khớp đúng → chọn ngay; không khớp → đưa mã vào ô tìm để xem gợi ý */
    const onCameraScan = async (code: string) => {
      try {
        const hit = await catalogApi.byBarcode(code);
        if (goodsOnly && hit.product.type !== 'GOODS') throw new Error('not goods');
        pick(hit);
        message.success({ content: `Đã chọn: ${hit.name}`, duration: 1.2 });
      } catch {
        setValue(code); runSearch(code);
        message.warning(`Không tìm thấy hàng hóa có mã vạch/mã "${code}"`);
      }
    };

    return (
      <div className="input-with-scan">
      <AutoComplete
        value={value} options={options} style={{ width: '100%' }} popupMatchSelectWidth={isMobile ? true : 520}
        onSearch={(q) => { setValue(q); runSearch(q); }}
        onSelect={(_v, opt: any) => pick(opt.hit)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && value.trim()) {
            // barcode scanner path: exact barcode → add immediately
            if (options.length === 1) { pick(options[0].hit); return; }
            try { const hit = await catalogApi.byBarcode(value.trim()); pick(hit); } catch { if (options.length === 0) message.warning(`Không tìm thấy hàng hóa có mã vạch/mã "${value.trim()}"`); }
          }
        }}
      >
        <Input ref={inputRef} size={size} prefix={<SearchOutlined />} placeholder={placeholder} allowClear autoFocus={autoFocus} />
      </AutoComplete>
      <BarcodeScanButton size={size} onScan={(c) => void onCameraScan(c)} continuous={scanContinuous} title={scanContinuous ? 'Quét mã vạch – thêm vào giỏ' : 'Quét mã vạch'} />
      </div>
    );
  },
);
