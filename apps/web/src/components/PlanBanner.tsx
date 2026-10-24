import { Alert } from 'antd';
import { Link } from 'react-router-dom';
import { useSubscription } from '../api/loyalty';
import { useCan } from '../store/auth';

/**
 * Read-only / trial banner (BR-161). Drop it under the app header: shows when the tenant is read-only
 * (TRIAL_EXPIRED / PLAN_EXPIRED) or the trial ends within 7 days. Renders nothing otherwise.
 */
export function PlanBanner() {
  const can = useCan();
  const { data } = useSubscription(can('subscription.view'));
  if (!data) return null;
  const trial = data.tenant.status === 'TRIAL';
  if (data.readOnly) return <Alert type="error" banner showIcon message={<span>{trial ? 'Hết hạn dùng thử' : 'Gói dịch vụ đã hết hạn'} – gian hàng ở chế độ chỉ đọc, không thể tạo / sửa dữ liệu. <Link to="/settings/subscription">Xem gói dịch vụ</Link></span>} />;
  if (trial && data.trialDaysLeft !== null && data.trialDaysLeft <= 7) return <Alert type="warning" banner showIcon message={<span>Còn {data.trialDaysLeft} ngày dùng thử gói {data.plan.name}. <Link to="/settings/subscription">Xem gói dịch vụ</Link></span>} />;
  return null;
}
