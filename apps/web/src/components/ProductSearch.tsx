import { AutoComplete, Input, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { catalogApi } from '../api/catalog';
import type { SearchHit } from '../api/types';
import { money, qty } from '../utils/format';
import { errMsg } from '../api/client';
import { App } from 'antd';
import { useIsMobile } from '../hooks/useMedia';

export interface ProductSearchHandle { focus: () => void }

/** Search box with debounce + barcode-scanner support (Enter with no highlighted option → lookup by barcode). */
export const ProductSearch = forwardRef<ProductSearchHandle, { onPick: (hit: SearchHit) => void; warehouseId?: string; placeholder?: string; goodsOnly?: boolean; autoFocus?: boolean; size?: 'middle' | 'large' }>(
  function ProductSearch({ onPick, warehouseId, placeholder = 'Tìm hàng hóa theo mã, tên hoặc quét mã vạch (F3)', goodsOnly, autoFocus, size = 'large' }, ref) {
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

    return (
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
    );
  },
);
