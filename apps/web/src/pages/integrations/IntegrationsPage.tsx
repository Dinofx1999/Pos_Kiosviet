import { Tabs } from 'antd';
import { ApiOutlined, AuditOutlined, FileExcelOutlined, HistoryOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ExcelImportTab } from './ExcelImportTab';
import { JobsTab } from './JobsTab';
import { KiotVietTab } from './KiotVietTab';
import { ReconcileTab } from './ReconcileTab';
import './integrations.css';

const TABS = [
  { key: 'excel', label: 'Nhập từ Excel KiotViet', icon: <FileExcelOutlined /> },
  { key: 'kiotviet', label: 'Kết nối KiotViet', icon: <ApiOutlined /> },
  { key: 'reconcile', label: 'Đối soát', icon: <AuditOutlined /> },
  { key: 'jobs', label: 'Lịch sử nhập', icon: <HistoryOutlined /> },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/** Module 13 — Tích hợp & chuyển dữ liệu từ KiotViet (BR-130..BR-134). URL: /integrations/:tab */
export default function IntegrationsPage() {
  const { tab } = useParams();
  const nav = useNavigate();
  const active: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : 'excel';
  useEffect(() => { if (tab !== active) nav(`/integrations/${active}`, { replace: true }); }, [tab, active]);
  return (
    <div className="ig-page">
      <h1 className="kv-page-title">Tích hợp &amp; chuyển dữ liệu từ KiotViet</h1>
      <Tabs className="ig-tabs" activeKey={active} onChange={(k) => nav(`/integrations/${k}`)} destroyOnHidden
        items={TABS.map((t) => ({ key: t.key, label: <span>{t.icon} {t.label}</span>, children: t.key === 'excel' ? <ExcelImportTab /> : t.key === 'kiotviet' ? <KiotVietTab /> : t.key === 'reconcile' ? <ReconcileTab /> : <JobsTab /> }))} />
    </div>
  );
}
