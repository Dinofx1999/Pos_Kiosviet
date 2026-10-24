import { Injectable } from '@nestjs/common';
import { Prisma, PromotionStatus, PromotionType, VoucherStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { CreatePromotionDto, CreateVouchersDto, PromotionQueryDto, PromotionReportQueryDto, UpdatePromotionDto, UpdateVoucherDto, VoucherQueryDto } from './dto/promotions.dto';
import { AppliedPromotion, BuyXGetYConfig, evaluatePromotions, ineligibleReason, InvoiceDiscountConfig, InvoiceGiftConfig, ProductDiscountConfig, PromoContext, PromoDef, PromoLine, PromoResult, PromoVoucher, VoucherConfig, voucherProblem } from './promotion-engine';

const DEC = /^\d{1,13}(\.\d{1,6})?$/;
const isDec = (v: unknown, min = 0) => typeof v === 'string' && DEC.test(v) && D(v).greaterThanOrEqualTo(min);
const isUuidArr = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)));

export interface EvaluateParams { branchId: string; customerId: string | null; customerGroup: string | null; voucherCode: string | null; excludeIds: string[]; lines: PromoLine[]; now?: Date }

/** Khuyến mãi (BR-90..BR-96): CRUD, voucher, đánh giá cho giỏ hàng, trừ/hoàn lượt dùng khi hoàn thành/hủy hóa đơn. */
@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService, private readonly audit: AuditService, private readonly access: AccessService) {}

  // ---------------------------------------------------------------- config validation (per type)
  private async validateConfig(db: TxClient | PrismaService['db'], type: PromotionType, raw: Record<string, unknown>) {
    const bad = (m: string) => Errors.validation(`Cấu hình khuyến mãi không hợp lệ: ${m}`, { type });
    const variantIds = new Set<string>();
    const categoryIds = new Set<string>();
    const targets = (t: { variantIds?: unknown; categoryIds?: unknown }, where: string) => {
      if (!isUuidArr(t.variantIds) || !isUuidArr(t.categoryIds)) throw bad(`${where}: danh sách hàng hóa / nhóm hàng không hợp lệ`);
      ((t.variantIds as string[] | undefined) ?? []).forEach((v) => variantIds.add(v));
      ((t.categoryIds as string[] | undefined) ?? []).forEach((c) => categoryIds.add(c));
    };
    const reward = (r: { discountPercent?: unknown; discountAmount?: unknown; fixedPrice?: unknown; maxDiscount?: unknown }, where: string, allowFixed = false) => {
      const kinds = [r.discountPercent !== undefined, r.discountAmount !== undefined, allowFixed && r.fixedPrice !== undefined].filter(Boolean).length;
      if (kinds !== 1) throw bad(`${where}: chọn đúng một trong % giảm, số tiền giảm${allowFixed ? ', giá cố định' : ''}`);
      if (r.discountPercent !== undefined && (!isDec(r.discountPercent) || D(r.discountPercent as string).greaterThan(100) || D(r.discountPercent as string).lessThanOrEqualTo(0))) throw bad(`${where}: % giảm phải trong (0, 100]`);
      if (r.discountAmount !== undefined && (!isDec(r.discountAmount) || D(r.discountAmount as string).lessThanOrEqualTo(0))) throw bad(`${where}: số tiền giảm phải > 0`);
      if (r.fixedPrice !== undefined && !isDec(r.fixedPrice)) throw bad(`${where}: giá cố định không hợp lệ`);
      if (r.maxDiscount !== undefined && !isDec(r.maxDiscount)) throw bad(`${where}: giảm tối đa không hợp lệ`);
    };
    if (type === 'INVOICE_DISCOUNT') {
      const c = raw as unknown as InvoiceDiscountConfig;
      if (!Array.isArray(c.tiers) || !c.tiers.length || c.tiers.length > 20) throw bad('cần 1–20 mức hóa đơn');
      c.tiers.forEach((t, i) => { if (!isDec(t.minTotal)) throw bad(`mức ${i + 1}: tổng tiền tối thiểu không hợp lệ`); reward(t, `mức ${i + 1}`); });
    } else if (type === 'INVOICE_GIFT') {
      const c = raw as unknown as InvoiceGiftConfig;
      if (!Array.isArray(c.tiers) || !c.tiers.length || c.tiers.length > 20) throw bad('cần 1–20 mức hóa đơn');
      c.tiers.forEach((t, i) => {
        if (!isDec(t.minTotal)) throw bad(`mức ${i + 1}: tổng tiền tối thiểu không hợp lệ`);
        if (!Array.isArray(t.gifts) || !t.gifts.length) throw bad(`mức ${i + 1}: cần ít nhất một hàng tặng`);
        t.gifts.forEach((g) => { if (!isUuidArr([g.variantId]) || !isDec(g.quantity) || D(g.quantity).lessThanOrEqualTo(0)) throw bad(`mức ${i + 1}: hàng tặng / số lượng không hợp lệ`); variantIds.add(g.variantId); });
      });
    } else if (type === 'PRODUCT_DISCOUNT') {
      const c = raw as unknown as ProductDiscountConfig;
      targets(c, 'hàng áp dụng');
      if (!(c.variantIds?.length || c.categoryIds?.length)) throw bad('chọn hàng hóa hoặc nhóm hàng áp dụng');
      reward(c, 'giảm giá', true);
      if (c.minQuantity !== undefined && !isDec(c.minQuantity)) throw bad('số lượng tối thiểu không hợp lệ');
      if (c.maxQuantity !== undefined && (!isDec(c.maxQuantity) || D(c.maxQuantity).lessThanOrEqualTo(0))) throw bad('số lượng tối đa không hợp lệ');
    } else if (type === 'BUY_X_GET_Y') {
      const c = raw as unknown as BuyXGetYConfig;
      if (!c.buy || !c.get) throw bad('cần cả điều kiện mua (buy) và phần tặng (get)');
      targets(c.buy, 'hàng mua');
      if (!(c.buy.variantIds?.length || c.buy.categoryIds?.length)) throw bad('chọn hàng hóa / nhóm hàng phải mua');
      if (!isDec(c.buy.quantity) || D(c.buy.quantity).lessThanOrEqualTo(0)) throw bad('số lượng mua phải > 0');
      if (!isUuidArr(c.get.variantIds) || !c.get.variantIds?.length) throw bad('chọn hàng tặng');
      c.get.variantIds.forEach((v) => variantIds.add(v));
      if (!isDec(c.get.quantity) || D(c.get.quantity).lessThanOrEqualTo(0)) throw bad('số lượng tặng phải > 0');
      if (c.get.discountPercent !== undefined && (!isDec(c.get.discountPercent) || D(c.get.discountPercent).lessThanOrEqualTo(0) || D(c.get.discountPercent).greaterThan(100))) throw bad('% giảm hàng tặng phải trong (0, 100]');
      if (c.maxRepeats !== undefined && c.maxRepeats !== null && (!Number.isInteger(c.maxRepeats) || c.maxRepeats < 1)) throw bad('số lần lặp tối đa không hợp lệ');
    } else if (type === 'VOUCHER') {
      const c = raw as unknown as VoucherConfig;
      targets(c, 'hàng áp dụng');
      reward(c, 'voucher');
      if (c.minTotal !== undefined && !isDec(c.minTotal)) throw bad('tổng tiền tối thiểu không hợp lệ');
    }
    if (variantIds.size) {
      const n = await db.productVariant.count({ where: { id: { in: Array.from(variantIds) }, deletedAt: null } });
      if (n !== variantIds.size) throw bad('có hàng hóa không tồn tại');
    }
    if (categoryIds.size) {
      const n = await db.productCategory.count({ where: { id: { in: Array.from(categoryIds) } } });
      if (n !== categoryIds.size) throw bad('có nhóm hàng không tồn tại');
    }
  }

  // ---------------------------------------------------------------- CRUD
  async list(user: RequestUser, q: PromotionQueryDto) {
    const now = new Date();
    const where: Prisma.PromotionWhereInput = {
      ...(q.status ? { status: q.status as PromotionStatus } : {}),
      ...(q.type ? { type: q.type as PromotionType } : {}),
      ...(q.running === 'true' ? { status: 'ACTIVE', OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] } : {}),
      ...(q.branchId ? { OR: [{ branches: { none: {} } }, { branches: { some: { branchId: q.branchId } } }] } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.promotion.findMany({ where, include: { branches: { select: { branchId: true } }, _count: { select: { vouchers: true, uses: true } } }, ...skipTake(q), orderBy: orderBy(q, ['priority', 'createdAt', 'code', 'name', 'startsAt', 'endsAt'], 'createdAt') }),
      this.prisma.db.promotion.count({ where }),
    ]);
    return paginated(rows.map((r) => ({ ...r, branchIds: r.branches.map((b) => b.branchId), branches: undefined, running: r.status === 'ACTIVE' && (!r.startsAt || r.startsAt <= now) && (!r.endsAt || r.endsAt >= now) })), total, q);
  }

  async get(user: RequestUser, id: string) {
    const p = await this.prisma.db.promotion.findFirst({ where: { id }, include: { branches: { select: { branchId: true } }, _count: { select: { vouchers: true, uses: true } } } });
    if (!p) throw Errors.notFound('Chương trình khuyến mãi', id);
    const stats = await this.prisma.raw.$queryRaw<{ uses: bigint; amount: Prisma.Decimal; gifts: Prisma.Decimal }[]>`SELECT count(*)::bigint AS uses, COALESCE(SUM(ip.amount),0) AS amount, COALESCE(SUM(ip.gift_quantity),0) AS gifts FROM invoice_promotions ip JOIN invoices i ON i.id = ip.invoice_id WHERE ip.tenant_id = ${user.tenantId}::uuid AND ip.promotion_id = ${id}::uuid AND i.status = 'COMPLETED'`;
    const variantIds = this.variantIdsOf(p.type, p.config as Record<string, unknown>);
    const variants = variantIds.length ? await this.prisma.db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku: true, name: true, sellPrice: true } }) : [];
    return { ...p, branchIds: p.branches.map((b) => b.branchId), branches: undefined, stats: { uses: Number(stats[0]?.uses ?? 0), amount: D(stats[0]?.amount ?? 0), gifts: D(stats[0]?.gifts ?? 0) }, variants };
  }

  private variantIdsOf(type: PromotionType, c: Record<string, unknown>): string[] {
    const out = new Set<string>();
    const add = (xs: unknown) => Array.isArray(xs) && xs.forEach((x) => typeof x === 'string' && out.add(x));
    if (type === 'PRODUCT_DISCOUNT' || type === 'VOUCHER') add(c.variantIds);
    if (type === 'BUY_X_GET_Y') { add((c.buy as Record<string, unknown>)?.variantIds); add((c.get as Record<string, unknown>)?.variantIds); }
    if (type === 'INVOICE_GIFT') ((c.tiers as Array<{ gifts: Array<{ variantId: string }> }>) ?? []).forEach((t) => t.gifts?.forEach((g) => out.add(g.variantId)));
    return Array.from(out);
  }

  private async assertBranches(db: TxClient | PrismaService['db'], ids?: string[]) {
    if (!ids?.length) return;
    const n = await db.branch.count({ where: { id: { in: ids } } });
    if (n !== new Set(ids).size) throw Errors.validation('Chi nhánh không hợp lệ', { branchIds: ids });
  }

  async create(user: RequestUser, dto: CreatePromotionDto) {
    if (dto.startsAt && dto.endsAt && new Date(dto.startsAt) > new Date(dto.endsAt)) throw Errors.validation('Ngày bắt đầu phải trước ngày kết thúc');
    return this.prisma.tx(async (tx) => {
      await this.validateConfig(tx, dto.type, dto.config);
      await this.assertBranches(tx, dto.branchIds);
      const code = dto.code ?? (await this.numbering.next(tx, 'PROMOTION'));
      if (await tx.promotion.findFirst({ where: { code } })) throw Errors.duplicate('DUPLICATE_CODE', 'Mã khuyến mãi đã tồn tại', { code });
      const p = await tx.promotion.create({
        data: {
          tenantId: user.tenantId, code, name: dto.name, type: dto.type, status: dto.status ?? 'ACTIVE', description: dto.description, startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          daysOfWeek: dto.daysOfWeek ?? [], timeFrom: dto.timeFrom ?? null, timeTo: dto.timeTo ?? null, customerGroups: dto.customerGroups ?? [], priority: dto.priority ?? 0, stackable: dto.stackable ?? false,
          usageLimit: dto.usageLimit ?? null, perCustomerLimit: dto.perCustomerLimit ?? null, config: dto.config as Prisma.InputJsonValue, createdById: user.id,
          branches: { create: (dto.branchIds ?? []).map((branchId) => ({ branchId })) },
        },
      });
      await this.audit.log(tx, { action: 'promotion.create', entityType: 'Promotion', entityId: p.id, entityCode: code, after: { type: p.type, name: p.name } });
      return p.id;
    }).then((id) => this.get(user, id));
  }

  async update(user: RequestUser, id: string, dto: UpdatePromotionDto) {
    await this.prisma.tx(async (tx) => {
      const before = await tx.promotion.findFirst({ where: { id } });
      if (!before) throw Errors.notFound('Chương trình khuyến mãi', id);
      if (dto.config) await this.validateConfig(tx, before.type, dto.config);
      await this.assertBranches(tx, dto.branchIds);
      const startsAt = dto.startsAt === undefined ? before.startsAt : dto.startsAt ? new Date(dto.startsAt) : null;
      const endsAt = dto.endsAt === undefined ? before.endsAt : dto.endsAt ? new Date(dto.endsAt) : null;
      if (startsAt && endsAt && startsAt > endsAt) throw Errors.validation('Ngày bắt đầu phải trước ngày kết thúc');
      await tx.promotion.update({
        where: { id },
        data: {
          name: dto.name, description: dto.description, status: dto.status, startsAt, endsAt, daysOfWeek: dto.daysOfWeek, timeFrom: dto.timeFrom === undefined ? undefined : dto.timeFrom, timeTo: dto.timeTo === undefined ? undefined : dto.timeTo,
          customerGroups: dto.customerGroups, priority: dto.priority, stackable: dto.stackable, usageLimit: dto.usageLimit === undefined ? undefined : dto.usageLimit, perCustomerLimit: dto.perCustomerLimit === undefined ? undefined : dto.perCustomerLimit,
          config: dto.config === undefined ? undefined : (dto.config as Prisma.InputJsonValue),
          ...(dto.branchIds ? { branches: { deleteMany: {}, create: dto.branchIds.map((branchId) => ({ branchId })) } } : {}),
        },
      });
      await this.audit.log(tx, { action: 'promotion.update', entityType: 'Promotion', entityId: id, entityCode: before.code, before: { status: before.status, config: before.config }, after: { status: dto.status ?? before.status, config: dto.config ?? before.config } });
    });
    return this.get(user, id);
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const p = await tx.promotion.findFirst({ where: { id }, include: { _count: { select: { uses: true } } } });
      if (!p) throw Errors.notFound('Chương trình khuyến mãi', id);
      if (p._count.uses > 0) throw Errors.conflict('PROMOTION_IN_USE', 'Chương trình đã được áp dụng trên hóa đơn; hãy ngừng kích hoạt thay vì xóa', { uses: p._count.uses });
      await tx.promotion.delete({ where: { id } });
      await this.audit.log(tx, { action: 'promotion.delete', entityType: 'Promotion', entityId: id, entityCode: p.code });
    });
  }

  // ---------------------------------------------------------------- vouchers
  async createVouchers(user: RequestUser, promotionId: string, dto: CreateVouchersDto) {
    return this.prisma.tx(async (tx) => {
      const p = await tx.promotion.findFirst({ where: { id: promotionId } });
      if (!p) throw Errors.notFound('Chương trình khuyến mãi', promotionId);
      if (p.type !== 'VOUCHER') throw Errors.validation('Chỉ chương trình loại VOUCHER mới phát hành mã');
      if (dto.customerId && !(await tx.customer.findFirst({ where: { id: dto.customerId } }))) throw Errors.notFound('Khách hàng', dto.customerId);
      let codes: string[];
      if (dto.codes?.length) codes = dto.codes.map((c) => c.toUpperCase());
      else {
        const n = dto.count ?? 1; const prefix = (dto.prefix ?? '').toUpperCase(); const set = new Set<string>();
        while (set.size < n) set.add(prefix + randomBytes(5).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8).padEnd(8, 'X'));
        codes = Array.from(set);
      }
      const dup = await tx.promotionVoucher.findMany({ where: { code: { in: codes } }, select: { code: true } });
      if (dup.length) throw Errors.duplicate('DUPLICATE_CODE', 'Mã voucher đã tồn tại', { codes: dup.map((d) => d.code) });
      await tx.promotionVoucher.createMany({ data: codes.map((code) => ({ tenantId: user.tenantId, promotionId, code, maxUses: dto.maxUses ?? 1, customerId: dto.customerId ?? null, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null, note: dto.note ?? null })) });
      await this.audit.log(tx, { action: 'promotion.vouchers.create', entityType: 'Promotion', entityId: promotionId, entityCode: p.code, after: { count: codes.length } });
      return { count: codes.length, codes };
    });
  }

  async listVouchers(user: RequestUser, promotionId: string, q: VoucherQueryDto) {
    const where: Prisma.PromotionVoucherWhereInput = { promotionId, ...(q.status ? { status: q.status as VoucherStatus } : {}), ...(q.search ? { code: { contains: q.search, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([this.prisma.db.promotionVoucher.findMany({ where, ...skipTake(q), orderBy: { createdAt: 'desc' } }), this.prisma.db.promotionVoucher.count({ where })]);
    return paginated(rows, total, q);
  }

  async updateVoucher(user: RequestUser, voucherId: string, dto: UpdateVoucherDto) {
    const v = await this.prisma.db.promotionVoucher.findFirst({ where: { id: voucherId } });
    if (!v) throw Errors.notFound('Voucher', voucherId);
    if (dto.status === 'ACTIVE' && v.usedCount >= v.maxUses) throw Errors.conflict('VOUCHER_USED', 'Voucher đã dùng hết lượt, không kích hoạt lại được');
    return this.prisma.db.promotionVoucher.update({ where: { id: voucherId }, data: { status: dto.status, expiresAt: dto.expiresAt === undefined ? undefined : dto.expiresAt ? new Date(dto.expiresAt) : null, note: dto.note } });
  }

  /** POS: is this code usable right now? */
  async lookupVoucher(user: RequestUser, code: string, branchId?: string, customerId?: string) {
    const v = await this.prisma.db.promotionVoucher.findFirst({ where: { code: code.toUpperCase() }, include: { promotion: { include: { branches: { select: { branchId: true } } } } } });
    if (!v) return { valid: false, reason: 'Mã voucher không tồn tại' };
    const customer = customerId ? await this.prisma.db.customer.findFirst({ where: { id: customerId }, select: { groupName: true } }) : null;
    const ctx: PromoContext = { now: new Date(), branchId: branchId ?? '', customerId: customerId ?? null, customerGroup: customer?.groupName ?? null, voucher: v, voucherCode: code, excludeIds: new Set() };
    const def = this.toDef(v.promotion, 0);
    const problem = voucherProblem(v, ctx) ?? (v.promotion.status !== 'ACTIVE' ? 'Chương trình đã ngừng' : null) ?? (branchId ? ineligibleReason(def, ctx) : null);
    return { valid: !problem, reason: problem, voucher: { id: v.id, code: v.code, status: v.status, maxUses: v.maxUses, usedCount: v.usedCount, expiresAt: v.expiresAt }, promotion: { id: v.promotion.id, code: v.promotion.code, name: v.promotion.name, config: v.promotion.config, stackable: v.promotion.stackable } };
  }

  // ---------------------------------------------------------------- engine glue
  private toDef(p: Prisma.PromotionGetPayload<{ include: { branches: { select: { branchId: true } } } }>, customerUses: number): PromoDef {
    return { id: p.id, code: p.code, name: p.name, type: p.type, priority: p.priority, stackable: p.stackable, config: p.config as never, startsAt: p.startsAt, endsAt: p.endsAt, daysOfWeek: p.daysOfWeek, timeFrom: p.timeFrom, timeTo: p.timeTo, customerGroups: p.customerGroups, branchIds: p.branches.map((b) => b.branchId), usageLimit: p.usageLimit, usageCount: p.usageCount, perCustomerLimit: p.perCustomerLimit, customerUses, createdAt: p.createdAt };
  }

  /** Active promotions for a branch (+ per-customer usage) and the voucher named by the cart. */
  async evaluate(tx: TxClient | PrismaService['db'], tenantId: string, params: EvaluateParams): Promise<{ result: PromoResult; defs: Map<string, PromoDef>; voucher: PromoVoucher | null }> {
    const promos = await tx.promotion.findMany({ where: { status: 'ACTIVE', OR: [{ branches: { none: {} } }, { branches: { some: { branchId: params.branchId } } }] }, include: { branches: { select: { branchId: true } } } });
    const uses = new Map<string, number>();
    if (params.customerId && promos.some((p) => p.perCustomerLimit !== null)) {
      const rows = await tx.$queryRaw<{ promotion_id: string; n: bigint }[]>`SELECT ip.promotion_id, count(*)::bigint AS n FROM invoice_promotions ip JOIN invoices i ON i.id = ip.invoice_id WHERE ip.tenant_id = ${tenantId}::uuid AND i.customer_id = ${params.customerId}::uuid AND i.status = 'COMPLETED' GROUP BY ip.promotion_id`;
      rows.forEach((r) => uses.set(r.promotion_id, Number(r.n)));
    }
    const defs = promos.map((p) => this.toDef(p, uses.get(p.id) ?? 0));
    const voucher = params.voucherCode ? await tx.promotionVoucher.findFirst({ where: { code: params.voucherCode.toUpperCase() } }) : null;
    const ctx: PromoContext = { now: params.now ?? new Date(), branchId: params.branchId, customerId: params.customerId, customerGroup: params.customerGroup, voucher, voucherCode: params.voucherCode, excludeIds: new Set(params.excludeIds) };
    const result = evaluatePromotions(defs, params.lines, ctx);
    return { result, defs: new Map(defs.map((d) => [d.id, d])), voucher };
  }

  /** Completion: re-check limits under row locks and count the uses (lock order: promotions by id → vouchers). */
  async consume(tx: TxClient, user: RequestUser, invoiceId: string) {
    const rows = await tx.invoicePromotion.findMany({ where: { invoiceId } });
    if (!rows.length) return;
    const promoIds = Array.from(new Set(rows.map((r) => r.promotionId))).sort();
    for (const pid of promoIds) {
      const locked = await tx.$queryRaw<{ usage_limit: number | null; usage_count: number; status: string; code: string }[]>`SELECT usage_limit, usage_count, status, code FROM promotions WHERE id = ${pid}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
      const p = locked[0];
      if (!p) throw Errors.notFound('Chương trình khuyến mãi', pid);
      if (p.status !== 'ACTIVE') throw Errors.conflict('PROMOTION_INACTIVE', `Khuyến mãi ${p.code} đã ngừng, vui lòng tính lại đơn`, { promotionId: pid });
      if (p.usage_limit !== null && p.usage_count >= p.usage_limit) throw Errors.conflict('PROMOTION_EXHAUSTED', `Khuyến mãi ${p.code} đã hết lượt áp dụng`, { promotionId: pid });
      await tx.promotion.update({ where: { id: pid }, data: { usageCount: { increment: 1 } } });
    }
    const voucherIds = Array.from(new Set(rows.map((r) => r.voucherId).filter((x): x is string => !!x))).sort();
    for (const vid of voucherIds) {
      const locked = await tx.$queryRaw<{ status: string; used_count: number; max_uses: number; code: string; expires_at: Date | null }[]>`SELECT status, used_count, max_uses, code, expires_at FROM promotion_vouchers WHERE id = ${vid}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
      const v = locked[0];
      if (!v) throw Errors.notFound('Voucher', vid);
      if (v.status !== 'ACTIVE' || v.used_count >= v.max_uses || (v.expires_at && v.expires_at < new Date())) throw Errors.conflict('VOUCHER_INVALID', `Voucher ${v.code} không còn sử dụng được`, { voucherId: vid });
      await tx.promotionVoucher.update({ where: { id: vid }, data: { usedCount: { increment: 1 }, status: v.used_count + 1 >= v.max_uses ? 'USED' : 'ACTIVE' } });
    }
  }

  /** Cancellation: give the uses back (promotion counters and voucher uses). */
  async release(tx: TxClient, user: RequestUser, invoiceId: string) {
    const rows = await tx.invoicePromotion.findMany({ where: { invoiceId } });
    for (const pid of Array.from(new Set(rows.map((r) => r.promotionId))).sort()) {
      await tx.$queryRaw`SELECT id FROM promotions WHERE id = ${pid}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
      await tx.$executeRaw`UPDATE promotions SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = ${pid}::uuid AND tenant_id = ${user.tenantId}::uuid`;
    }
    for (const vid of Array.from(new Set(rows.map((r) => r.voucherId).filter((x): x is string => !!x))).sort()) {
      await tx.$queryRaw`SELECT id FROM promotion_vouchers WHERE id = ${vid}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
      await tx.$executeRaw`UPDATE promotion_vouchers SET used_count = GREATEST(used_count - 1, 0), status = CASE WHEN status = 'USED' THEN 'ACTIVE'::"VoucherStatus" ELSE status END WHERE id = ${vid}::uuid AND tenant_id = ${user.tenantId}::uuid`;
    }
  }

  /** Persist what was applied on a (draft) invoice. */
  async record(tx: TxClient, tenantId: string, invoiceId: string, applied: AppliedPromotion[]) {
    await tx.invoicePromotion.deleteMany({ where: { invoiceId } });
    if (applied.length) await tx.invoicePromotion.createMany({ data: applied.map((a) => ({ tenantId, invoiceId, promotionId: a.promotionId, voucherId: a.voucherId, type: a.type, amount: a.amount, giftQuantity: a.giftQuantity })) });
  }

  // ---------------------------------------------------------------- report
  async report(user: RequestUser, q: PromotionReportQueryDto) {
    const scope = this.access.branchWhere(user);
    const branchIds = q.branchId ? [q.branchId] : scope.branchId ? scope.branchId.in : null;
    const from = q.from ? new Date(q.from) : new Date(new Date().setDate(1));
    const to = q.to ? new Date(q.to) : new Date();
    const branchSql = branchIds ? Prisma.sql`AND i.branch_id IN (${Prisma.join(branchIds.length ? branchIds.map((id) => Prisma.sql`${id}::uuid`) : [Prisma.sql`'00000000-0000-0000-0000-000000000000'::uuid`])})` : Prisma.empty;
    const rows = await this.prisma.raw.$queryRaw<Array<{ promotion_id: string; code: string; name: string; type: string; uses: bigint; amount: Prisma.Decimal; gifts: Prisma.Decimal; revenue: Prisma.Decimal }>>`
      SELECT p.id AS promotion_id, p.code, p.name, p.type::text AS type, count(DISTINCT ip.invoice_id)::bigint AS uses, COALESCE(SUM(ip.amount),0) AS amount, COALESCE(SUM(ip.gift_quantity),0) AS gifts, COALESCE(SUM(i.total_amount),0) AS revenue
      FROM invoice_promotions ip JOIN invoices i ON i.id = ip.invoice_id JOIN promotions p ON p.id = ip.promotion_id
      WHERE ip.tenant_id = ${user.tenantId}::uuid AND i.status = 'COMPLETED' AND i.invoice_date BETWEEN ${from} AND ${to} ${branchSql}
      GROUP BY p.id, p.code, p.name, p.type ORDER BY amount DESC`;
    const totalDiscount = rows.reduce((s, r) => s.plus(D(r.amount)), ZERO);
    return { from, to, totals: { promotions: rows.length, uses: rows.reduce((s, r) => s + Number(r.uses), 0), discount: totalDiscount }, rows: rows.map((r) => ({ promotionId: r.promotion_id, code: r.code, name: r.name, type: r.type, uses: Number(r.uses), amount: D(r.amount), gifts: D(r.gifts), revenue: D(r.revenue) })) };
  }
}
