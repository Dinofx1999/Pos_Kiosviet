import { Injectable } from '@nestjs/common';
import { PlanCode, PLANS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';

export type LimitKey = 'branches' | 'warehouses' | 'users' | 'products';

/** Gói dịch vụ & hạn mức (BR-160..BR-162). */
@Injectable()
export class PlanService {
  constructor(private readonly prisma: PrismaService) {}

  plan(code: string) { return PLANS[(code in PLANS ? code : 'FREE') as PlanCode]; }

  async usage(tenantId: string, db: TxClient | PrismaService['raw'] = this.prisma.raw) {
    const [branches, warehouses, users, products] = await Promise.all([
      db.branch.count({ where: { tenantId, isActive: true } }),
      db.warehouse.count({ where: { tenantId, isActive: true } }),
      db.user.count({ where: { tenantId, status: 'ACTIVE' } }),
      db.product.count({ where: { tenantId, deletedAt: null } }),
    ]);
    return { branches, warehouses, users, products };
  }

  /** Throws PLAN_LIMIT_REACHED when creating one more `key` would exceed the plan (null limit = unlimited). */
  async assertLimit(tx: TxClient, tenantId: string, key: LimitKey, adding = 1) {
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId }, select: { planCode: true } });
    const plan = this.plan(tenant?.planCode ?? 'FREE');
    const limit = plan[key] as number | null;
    if (limit === null || limit === undefined) return;
    const usage = await this.usage(tenantId, tx);
    if (usage[key] + adding > limit) {
      const label: Record<LimitKey, string> = { branches: 'chi nhánh', warehouses: 'kho', users: 'người dùng', products: 'hàng hóa' };
      throw Errors.conflict('PLAN_LIMIT_REACHED', `Gói ${plan.name} cho phép tối đa ${limit} ${label[key]}; hãy nâng cấp gói để thêm`, { key, limit, current: usage[key], planCode: tenant?.planCode ?? 'FREE' });
    }
  }

  async subscription(tenantId: string) {
    const t = await this.prisma.raw.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { id: true, code: true, name: true, status: true, planCode: true, trialEndsAt: true, planExpiresAt: true, planNote: true, createdAt: true } });
    const plan = this.plan(t.planCode);
    const usage = await this.usage(tenantId);
    const now = Date.now();
    const trialDaysLeft = t.status === 'TRIAL' && t.trialEndsAt ? Math.ceil((t.trialEndsAt.getTime() - now) / 86400_000) : null;
    return { tenant: t, plan: { code: t.planCode in PLANS ? t.planCode : 'FREE', ...plan }, usage, limits: { branches: plan.branches, warehouses: plan.warehouses, users: plan.users, products: plan.products }, trialDaysLeft, readOnly: this.isReadOnly(t), plans: Object.entries(PLANS).map(([code, p]) => ({ code, ...p })) };
  }

  /** Trial expired or plan expired → the tenant may read but not write (BR-161). */
  isReadOnly(t: { status: string; trialEndsAt: Date | null; planExpiresAt: Date | null }) {
    const now = new Date();
    if (t.status === 'TRIAL' && t.trialEndsAt && t.trialEndsAt < now) return true;
    if (t.status === 'ACTIVE' && t.planExpiresAt && t.planExpiresAt < new Date(now.getTime() - 7 * 86400_000)) return true; // 7-day grace
    return false;
  }
}
