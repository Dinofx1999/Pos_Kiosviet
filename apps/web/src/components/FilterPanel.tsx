import { Button, Card, Drawer } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { ReactNode, useState } from 'react';

export function FilterCard({ title, children, extra }: { title: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return <Card size="small" title={title} extra={extra}>{children}</Card>;
}

/** Left filter column (KiotViet style). Collapses into a drawer below 1024px. */
export function FilterPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="kv-filter">{children}</div>
      <Button className="kv-filter-toggle" icon={<FilterOutlined />} onClick={() => setOpen(true)}>Bộ lọc</Button>
      <Drawer title="Bộ lọc" open={open} onClose={() => setOpen(false)} width={320} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 10 } }}>{children}</Drawer>
    </>
  );
}
