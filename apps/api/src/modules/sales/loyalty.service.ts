import { Injectable } from '@nestjs/common';
import { PointEntryType, Prisma } from '@prisma/client';
import { TENANT_SETTING_KEYS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';

export interface LoyaltyConfig { enabled: boolean; earnPoints: number; earnPerAmount: number; redeemValue: number; minRedeem: number; maxRedeemPercent: number }
type Db = TxClient | PrismaService['db'];
const KEYS = [TENANT_SETTING_KEYS.LOYALTY_ENABLED, TENANT_SETTING_KEYS.LOYALTY_EARN_POINTS, TENANT_SETTING_KEYS.LOYALTY_EARN_PER_AMOUNT, TENANT_SETTING_KEYS.LOYALTY_REDEEM_VALUE, TENANT_SETTING_KEYS.LOYALTY_MIN_REDEEM, TENANT_SETTING_KEYS.LOYALTY_MAX_REDEEM_PERCENT];

/** Điểm tích lũy (BR-140..BR-144): tích khi hoàn thành hóa đơn, tiêu như một khoản thanh toán, đảo khi hủy / trả hàng. */
@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async config(db: Db): Promise<LoyaltyConfig> {
    const rows = await db.tenantSetting.findMany({ where: { key: { in: KEYS } } });
    const num = (k: string, d: number) => { const r = rows.find((x) => x.key === k); return typeof r?.value === 'number' && r.value >= 0 ? r.value : d; };
    const en = rows.find((x) => x.key === TENANT_SETTING_KEYS.LOYALTY_ENABLED);
    return { enabled: en?.value === true, earnPoints: num(TENANT_SETTING_KEYS.LOYALTY_EARN_POINTS, 1), earnPerAmount: num(TENANT_SETTING_KEYS.LOYALTY_EARN_PER_AMOUNT, 10000) || 10000, redeemValue: num(TENANT_SETTING_KEYS.LOYALTY_REDEEM_VALUE, 1000), minRedeem: num(TENANT_SETTING_KEYS.LOYALTY_MIN_REDEEM, 0), maxRedeemPercent: Math.min(100, num(TENANT_SETTING_KEYS.LOYALTY_MAX_REDEEM_PERCENT, 100)) };
  }

  /** Whole points earned for an amount actually paid with money (BR-140). */
  earnFor(cfg: LoyaltyConfig, amount: Prisma.Decimal): Prisma.Decimal {
    if (!cfg.enabled || cfg.earnPoints <= 0 || amount.lessThanOrEqualTo(0)) return ZERO;
    return amount.dividedBy(cfg.earnPerAmount).times(cfg.earnPoints).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
  }

  /** Highest number of points the customer may spend on this payable amount. */
  maxRedeem(cfg: LoyaltyConfig, balance: Prisma.Decimal, payable: Prisma.Decimal): Prisma.Decimal {
    if (!cfg.enabled || cfg.redeemValue <= 0) return ZERO;
    const byAmount = payable.times(cfg.maxRedeemPercent).dividedBy(100).dividedBy(cfg.redeemValue).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
    const cap = Prisma.Decimal.min(balance.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN), byAmount);
    return cap.lessThan(cfg.minRedeem) ? ZERO : cap;
  }

  /** Validates a redemption (BR-141) → { points, value }. */
  plan(cfg: LoyaltyConfig, balance: Prisma.Decimal, requested: Prisma.Decimal, payable: Prisma.Decimal) {
    const points = requested.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
    if (points.lessThanOrEqualTo(0)) return { points: ZERO, value: ZERO };
    if (!cfg.enabled) throw Errors.validation('Cửa hàng chưa bật tích điểm');
    if (points.lessThan(cfg.minRedeem)) throw Errors.validation(`Tối thiểu ${cfg.minRedeem} điểm mỗi lần sử dụng`, { minRedeem: cfg.minRedeem });
    if (points.greaterThan(balance)) throw Errors.conflict('POINTS_INSUFFICIENT', 'Khách hàng không đủ điểm', { balance: balance.toString(), requested: points.toString() });
    const max = this.maxRedeem(cfg, balance, payable);
    if (points.greaterThan(max)) throw Errors.conflict('POINTS_MAX_REDEEM', `Chỉ được dùng tối đa ${max.toString()} điểm cho hóa đơn này`, { maxPoints: max.toString(), maxRedeemPercent: cfg.maxRedeemPercent });
    return { points, value: money(points.times(cfg.redeemValue)) };
  }

  /** Appends a point entry under the customer row lock and refreshes the cached balance. */
  async post(tx: TxClient, user: RequestUser, p: { customerId: string; type: PointEntryType; points: Prisma.Decimal; documentType?: string; documentId?: string; documentCode?: string; note?: string | null }) {
    const points = p.points.toDecimalPlaces(2);
    if (points.isZero()) return null;
    // NO KEY UPDATE: invoices/orders referencing the customer hold KEY SHARE on this row
    const rows = await tx.$queryRaw<{ points: Prisma.Decimal }[]>`SELECT points FROM customers WHERE id = ${p.customerId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR NO KEY UPDATE`;
    if (!rows[0]) throw Errors.notFound('Khách hàng', p.customerId);
    const after = D(rows[0].points).plus(points);
    if (p.type === 'REDEEM' && after.isNegative()) throw Errors.conflict('POINTS_INSUFFICIENT', 'Khách hàng không đủ điểm', { balance: rows[0].points.toString(), requested: points.abs().toString() });
    await tx.$executeRaw`UPDATE customers SET points = ${after.toString()}::numeric, updated_at = now() WHERE id = ${p.customerId}::uuid AND tenant_id = ${user.tenantId}::uuid`;
    return tx.customerPointEntry.create({ data: { tenantId: user.tenantId, customerId: p.customerId, type: p.type, points, balanceAfter: after, documentType: p.documentType ?? null, documentId: p.documentId ?? null, documentCode: p.documentCode ?? null, note: p.note ?? null, createdById: user.id } });
  }

  /** REVERSAL of every non-reversal entry of a document (invoice cancel, return cancel). */
  async reverseDocument(tx: TxClient, user: RequestUser, documentType: string, documentId: string, documentCode: string, note: string) {
    const entries = await tx.customerPointEntry.findMany({ where: { documentType, documentId } });
    if (!entries.length) return null;
    const net = entries.reduce((s, e) => s.plus(D(e.points)), ZERO);
    if (net.isZero()) return null;
    return this.post(tx, user, { customerId: entries[0].customerId, type: 'REVERSAL', points: net.negated(), documentType, documentId, documentCode, note });
  }

  async ledger(user: RequestUser, customerId: string, q: { page: number; pageSize: number }) {
    const c = await this.prisma.db.customer.findFirst({ where: { id: customerId }, select: { id: true, code: true, name: true, points: true } });
    if (!c) throw Errors.notFound('Khách hàng', customerId);
    const where = { customerId };
    const [rows, total, agg] = await Promise.all([
      this.prisma.db.customerPointEntry.findMany({ where, ...skipTake(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.db.customerPointEntry.count({ where }),
      this.prisma.db.customerPointEntry.groupBy({ by: ['type'], where, _sum: { points: true } }),
    ]);
    const sum = (t: PointEntryType) => D(agg.find((a) => a.type === t)?._sum.points ?? 0);
    return { customer: c, balance: D(c.points), earned: sum('EARN'), redeemed: sum('REDEEM').abs(), adjusted: sum('ADJUST'), config: await this.config(this.prisma.db), ...paginated(rows, total, q) };
  }

  async adjust(user: RequestUser, customerId: string, points: Prisma.Decimal, note: string) {
    if (points.isZero()) throw Errors.validation('Số điểm điều chỉnh phải khác 0');
    return this.prisma.tx(async (tx) => {
      const entry = await this.post(tx, user, { customerId, type: 'ADJUST', points, documentType: 'MANUAL', note });
      await this.audit.log(tx, { action: 'loyalty.adjust', entityType: 'Customer', entityId: customerId, after: { points: points.toString(), note } });
      return entry;
    });
  }
}
