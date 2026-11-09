import { Button, Card, Drawer } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { ReactNode, useState } from 'react';

export function FilterCard({ title, children, extra }: { title: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return <Card size="small" title={title} extra={extra}>{children}</Card>;
}

/**
 * Left filter column (KiotViet style). Collapses into a drawer below 1024px.
 * `open` / `onOpenChange` cho trang tự điều khiển ngăn kéo (vd nút lọc trên thanh chip của điện thoại); `hideToggle` bỏ nút "Bộ lọc" nổi.
 */
export function FilterPanel({ children, open, onOpenChange, hideToggle }: { children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; hideToggle?: boolean }) {
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  const setOpen = (v: boolean) => { setInner(v); onOpenChange?.(v); };
  return (
    <>
      <div className="kv-filter">{children}</div>
      {!hideToggle && <Button className="kv-filter-toggle" icon={<FilterOutlined />} onClick={() => setOpen(true)}>Bộ lọc</Button>}
      <Drawer title="Bộ lọc" open={isOpen} onClose={() => setOpen(false)} width={320} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 10 } }}>{children}</Drawer>
    </>
  );
}
