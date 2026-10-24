import { Alert, Button, Card, Progress, Skeleton, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { errMsg } from '../../api/client';
import { PLAN_LIMIT_LABEL, PlanInfo, PlanLimitKey, TENANT_STATUS_LABEL, useSubscription } from '../../api/loyalty';
import { d } from '../../utils/format';
import './loyalty.css';

const LIMIT_KEYS: PlanLimitKey[] = ['branches', 'warehouses', 'users', 'products'];
const fmtLimit = (v: number | null | undefined) => (v === null || v === undefined ? 'Không giới hạn' : v.toLocaleString('vi-VN'));
const STATUS_COLOR: Record<string, string> = { TRIAL: 'gold', ACTIVE: 'green', SUSPENDED: 'red', CLOSED: 'default' };

/** Thiết lập › Gói dịch vụ (BR-160, BR-161): plan, usage vs limits, trial countdown, read-only state, plan comparison. */
export function SubscriptionTab() {
  const { data, isLoading, isFetching, error, refetch } = useSubscription();
  if (isLoading && !data) return <Card size="small" title="Gói dịch vụ"><Skeleton active /></Card>;
  if (!data) return <Card size="small" title="Gói dịch vụ"><Alert type="error" showIcon message={errMsg(error)} action={<Button size="small" onClick={() => refetch()}>Thử lại</Button>} /></Card>;
  const { tenant, plan, usage, limits, trialDaysLeft, readOnly, plans } = data;
  const trial = tenant.status === 'TRIAL';
  const expired = trial ? trialDaysLeft !== null && trialDaysLeft <= 0 : !!tenant.planExpiresAt && dayjs(tenant.planExpiresAt).isBefore(dayjs());
  const graceLeft = !trial && tenant.planExpiresAt ? 7 - dayjs().diff(dayjs(tenant.planExpiresAt), 'day') : null;
  const pct = (k: PlanLimitKey) => { const l = limits[k]; return l ? Math.min(100, Math.round((usage[k] / l) * 100)) : 0; };
  const status = (k: PlanLimitKey): 'exception' | 'normal' | 'active' => { const l = limits[k]; if (!l) return 'normal'; return usage[k] >= l ? 'exception' : usage[k] / l >= 0.8 ? 'active' : 'normal'; };
  const full = LIMIT_KEYS.filter((k) => limits[k] !== null && usage[k] >= (limits[k] as number));
  return (
    <>
      {readOnly && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={trial ? 'Hết hạn dùng thử – gian hàng đang ở chế độ chỉ đọc' : 'Gói dịch vụ đã hết hạn quá 7 ngày – gian hàng đang ở chế độ chỉ đọc'} description="Bạn vẫn xem được mọi dữ liệu nhưng không thể tạo / sửa / xóa. Liên hệ nhà cung cấp để gia hạn hoặc nâng cấp gói." />}
      {!readOnly && trial && trialDaysLeft !== null && trialDaysLeft <= 7 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Còn ${trialDaysLeft} ngày dùng thử`} description="Sau khi hết hạn dùng thử, gian hàng chuyển sang chế độ chỉ đọc cho đến khi được kích hoạt gói." />}
      {!readOnly && !trial && expired && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Gói đã hết hạn ngày ${d(tenant.planExpiresAt)}`} description={`Còn ${Math.max(0, graceLeft ?? 0)} ngày ân hạn trước khi chuyển sang chế độ chỉ đọc.`} />}
      <div className="lp-plan">
        <div>
          <div className="code">Gói dịch vụ hiện tại</div>
          <div className="nm">{plan.name}</div>
          <div className="code">Mã gói {plan.code}</div>
        </div>
        <div className="st">
          <Tag color={STATUS_COLOR[tenant.status] ?? 'default'}>{TENANT_STATUS_LABEL[tenant.status] ?? tenant.status}</Tag>
          {trial && trialDaysLeft !== null && <div className="days">{trialDaysLeft > 0 ? <>còn <b>{trialDaysLeft}</b> ngày dùng thử</> : 'đã hết hạn dùng thử'}</div>}
          {!trial && tenant.planExpiresAt && <div className="days">{expired ? 'hết hạn' : 'hết hạn'} {d(tenant.planExpiresAt)}</div>}
          {!trial && !tenant.planExpiresAt && <div className="days">không thời hạn</div>}
        </div>
        <div className="tenant"><span>Gian hàng: <b>{tenant.name}</b> ({tenant.code})</span>{trial && tenant.trialEndsAt && <span>Dùng thử đến {d(tenant.trialEndsAt)}</span>}<span>Tạo ngày {d(tenant.createdAt)}</span>{tenant.planNote && <span>Ghi chú: {tenant.planNote}</span>}</div>
      </div>
      <Card size="small" title="Mức sử dụng so với hạn mức" extra={<Button size="small" icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />}>
        <div className="lp-usage">
          {LIMIT_KEYS.map((k) => (
            <div className="lp-bar" key={k}>
              <span className="k">{PLAN_LIMIT_LABEL[k]}</span>
              <Progress percent={pct(k)} status={status(k)} showInfo={false} strokeColor={status(k) === 'exception' ? '#dc2626' : status(k) === 'active' ? '#d97706' : undefined} />
              <span className="v">{usage[k].toLocaleString('vi-VN')} <span className="lim">/ {fmtLimit(limits[k])}</span></span>
            </div>
          ))}
        </div>
        {full.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 10 }} message={`Đã dùng hết hạn mức ${full.map((k) => PLAN_LIMIT_LABEL[k].toLowerCase()).join(', ')} của gói ${plan.name}`} description="Thêm mới sẽ bị từ chối với thông báo “Gói … cho phép tối đa …; hãy nâng cấp gói để thêm”. Bản ghi ngừng hoạt động không tính vào hạn mức." />}
        <div className="kv-hint" style={{ marginTop: 8 }}>Chỉ đếm chi nhánh / kho đang hoạt động, người dùng đang hoạt động và hàng hóa chưa xóa.</div>
      </Card>
      <Card size="small" title="So sánh các gói" style={{ marginTop: 12 }}>
        <div className="lp-plans">
          {plans.map((p: PlanInfo) => (
            <div key={p.code} className={`lp-plan-card${p.code === plan.code ? ' cur' : ''}`}>
              <div className="nm"><span>{p.name}</span>{p.code === plan.code ? <Tag color="blue">Hiện tại</Tag> : <span className="kv-hint">{p.code}</span>}</div>
              {LIMIT_KEYS.map((k) => <div className="row" key={k}><span className="k">{PLAN_LIMIT_LABEL[k]}</span><span className="v">{fmtLimit(p[k])}</span></div>)}
              {p.trialDays > 0 && <div className="row"><span className="k">Dùng thử</span><span className="v">{p.trialDays} ngày</span></div>}
            </div>
          ))}
        </div>
        <Alert className="lp-contact" type="info" showIcon message="Nâng cấp hoặc gia hạn gói" description="Việc đổi gói do nhà cung cấp phần mềm thực hiện. Vui lòng liên hệ bộ phận hỗ trợ kèm mã gian hàng ở trên; gói mới có hiệu lực ngay sau khi được kích hoạt." />
      </Card>
    </>
  );
}
