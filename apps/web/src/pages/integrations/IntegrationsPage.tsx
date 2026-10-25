import { Tabs } from 'antd';
import { ApiOutlined, AuditOutlined, FileExcelOutlined, HistoryOutlined, QrcodeOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ExcelImportTab } from './ExcelImportTab';
import { JobsTab } from './JobsTab';
import { KiotVietTab } from './KiotVietTab';
import { ReconcileTab } from './ReconcileTab';
import { SepayTab } from './SepayTab';
import './integrations.css';

const TABS = [
  { key: 'excel', label: 'Nhập từ Excel KiotViet', icon: <FileExcelOutlined /> },
  { key: 'kiotviet', label: 'Kết nối KiotViet', icon: <ApiOutlined /> },
  { key: 'reconcile', label: 'Đối soát', icon: <AuditOutlined /> },
  { key: 'jobs', label: 'Lịch sử nhập', icon: <HistoryOutlined /> },
  { key: 'sepay', label: 'Chuyển khoản tự động (SePay)', icon: <QrcodeOutlined /> },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** Module 13 — Tích hợp & chuyển dữ liệu từ KiotViet (BR-130..BR-134) + nhận tiền chuyển khoản tự động qua SePay (BR-170..). URL: /integrations/:tab */
export default function IntegrationsPage() {
  const { tab } = useParams();
  const nav = useNavigate();
  const active: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : 'excel';
  useEffect(() => { if (tab !== active) nav(`/integrations/${active}`, { replace: true }); }, [tab, active]);
  // phones: the tab strip scrolls sideways – bring the active tab into view (e.g. /integrations/sepay opened from a link)
  useEffect(() => {
    const t = window.setTimeout(() => {
      const list = document.querySelector<HTMLElement>('.ig-tabs .ant-tabs-nav-list');
      const el = list?.querySelector<HTMLElement>('.ant-tabs-tab-active');
      if (list && el && list.scrollWidth > list.clientWidth) list.scrollTo({ left: Math.max(0, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2) });
    }, 250);
    return () => window.clearTimeout(t);
  }, [active]);
  return (
    <div className="ig-page">
      <h1 className="kv-page-title">{active === 'sepay' ? 'Tích hợp · Chuyển khoản tự động' : 'Tích hợp & chuyển dữ liệu từ KiotViet'}</h1>
      <Tabs className="ig-tabs" activeKey={active} onChange={(k) => nav(`/integrations/${k}`)} destroyOnHidden
        items={TABS.map((t) => ({ key: t.key, label: <span>{t.icon} {t.label}</span>, children: t.key === 'excel' ? <ExcelImportTab /> : t.key === 'kiotviet' ? <KiotVietTab /> : t.key === 'reconcile' ? <ReconcileTab /> : t.key === 'sepay' ? <SepayTab /> : <JobsTab /> }))} />
    </div>
  );
}
