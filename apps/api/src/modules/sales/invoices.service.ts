import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';
import { hasPermission, TENANT_SETTING_KEYS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, money, qty as toQty, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../finance/ledger.service';
import { PaymentInput, PaymentsService } from '../finance/payments.service';
import { BankTransfersService } from '../finance/bank-transfers.service';
import { StockEngineService } from '../inventory/stock-engine.service';
import { CompleteInvoiceDto, CreateInvoiceDto, InvoiceLineDto, InvoicePaymentDto, InvoiceQueryDto, PosPriceQueryDto, UpdateInvoiceDto } from './dto/sales.dto';
import { AppliedPromotion, GiftOffer, PromoLine } from './promotion-engine';
import { LoyaltyService } from './loyalty.service';
import { PromotionsService } from './promotions.service';
import { computeInvoice } from './sales-calc';
import { ShiftsService } from './shifts.service';

const invoiceInclude = {
  customer: { select: { id: true, code: true, name: true, phone: true } },
  seller: { select: { id: true, username: true, fullName: true } },
  branch: { select: { id: true, code: true, name: true, address: true, phone: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  shift: { select: { id: true, code: true } },
  lines: { orderBy: { lineNo: 'asc' as const }, include: { variant: { select: { id: true, sku: true, barcode: true, name: true, product: { select: { id: true, code: true, name: true, type: true, baseUnit: true, trackBatch: true } } } }, batch: { select: { id: true, batchNo: true } } } },
  returns: { select: { id: true, code: true, status: true, returnDate: true, totalRefund: true, refundedAmount: true, exchangeInvoiceId: true }, orderBy: { createdAt: 'asc' as const } },
  promotions: { include: { promotion: { select: { id: true, code: true, name: true, type: true } }, voucher: { select: { id: true, code: true } } } },
  salesOrder: { select: { id: true, code: true, status: true, depositAmount: true } },
  deliveries: { select: { id: true, code: true, status: true, receiverName: true, receiverPhone: true, address: true, carrier: true, trackingCode: true, codAmount: true, codCollected: true }, orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.InvoiceInclude;

interface ResolvedLine {
  variantId: string; batchId: string | null; productUnitId: string | null; unitName: string | null; conversionFactor: Prisma.Decimal;
  quantity: Prisma.Decimal; baseQuantity: Prisma.Decimal; listPrice: Prisma.Decimal; unitPrice: Prisma.Decimal; discountAmount: Prisma.Decimal; taxRate: Prisma.Decimal; note: string | null;
  productType: 'GOODS' | 'SERVICE' | 'COMBO'; trackBatch: boolean; categoryId: string | null;
  comboItems: Array<{ componentVariantId: string; quantity: Prisma.Decimal }>;
  /** promotions (BR-90): gift lines are claimed by a promotion; promotionDiscount is set by the engine */
  isGift: boolean; giftPromotionId: string | null; promotionDiscount: Prisma.Decimal; promotionId: string | null;
}
interface PromoOutcome { promoDoc: Prisma.Decimal; applied: AppliedPromotion[]; gifts: GiftOffer[]; voucherCode: string | null }

/** Hóa đơn bán hàng / POS (BR-50..BR-56). */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService, private readonly engine: StockEngineService, private readonly numbering: NumberingService,
    private readonly audit: AuditService, private readonly outbox: OutboxService, private readonly access: AccessService,
    private readonly ledger: LedgerService, private readonly payments: PaymentsService, private readonly shifts: ShiftsService, private readonly promotions: PromotionsService, private readonly loyalty: LoyaltyService, private readonly bankTransfers: BankTransfersService,
  ) {}

  // ---------------------------------------------------------------- queries
  async list(user: RequestUser, q: InvoiceQueryDto) {
    const filters: Prisma.InvoiceWhereInput = {
      ...(q.status ? { status: q.status as InvoiceStatus } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.sellerId ? { sellerId: q.sellerId } : {}),
      ...(q.shiftId ? { shiftId: q.shiftId } : {}),
      ...(q.from || q.to ? { invoiceDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { note: { contains: q.search, mode: 'insensitive' } }, { customer: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }] } }, { lines: { some: { variant: { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } } } }] } : {}),
    };
    const where: Prisma.InvoiceWhereInput = { AND: [this.access.branchWhere(user), filters] };
    const include = { customer: { select: { id: true, code: true, name: true, phone: true } }, seller: { select: { id: true, fullName: true } }, branch: { select: { id: true, name: true } }, _count: { select: { lines: true } } };
    const order = orderBy(q, ['invoiceDate', 'createdAt', 'code', 'totalAmount', 'status'], 'invoiceDate');
    if (q.unpaid === 'true') {
      const all = await this.prisma.db.invoice.findMany({ where: { AND: [where, { status: 'COMPLETED' }] }, include, orderBy: order });
      const due = all.filter((r) => D(r.totalAmount).minus(D(r.paidAmount)).greaterThan(0));
      return paginated(due.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((r) => this.listView(r, user)), due.length, q);
    }
    const [rows, total] = await Promise.all([this.prisma.db.invoice.findMany({ where, include, ...skipTake(q), orderBy: order }), this.prisma.db.invoice.count({ where })]);
    return paginated(rows.map((r) => this.listView(r, user)), total, q);
  }

  private listView<T extends { totalAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; costTotal: Prisma.Decimal }>(r: T, user: RequestUser) {
    const canCost = user.permissions.has('*') || user.permissions.has('sales.report.view');
    return { ...r, dueAmount: D(r.totalAmount).minus(D(r.paidAmount)), costTotal: canCost ? r.costTotal : undefined };
  }

  async get(user: RequestUser, id: string) {
    const inv = await this.prisma.db.invoice.findFirst({ where: { id, ...this.access.branchWhere(user) }, include: invoiceInclude });
    if (!inv) throw Errors.notFound('Hóa đơn', id);
    return this.decorate(this.prisma.db, user, inv);
  }

  private async decorate(db: TxClient | PrismaService['db'], user: RequestUser, inv: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>) {
    const [allocations, movements] = await Promise.all([
      db.paymentAllocation.findMany({ where: { documentType: 'INVOICE', documentId: inv.id }, include: { payment: { select: { id: true, code: true, status: true, method: true, paymentDate: true, amount: true, reference: true } } } }),
      inv.status === 'DRAFT' ? [] : db.stockMovement.findMany({ where: { documentType: 'INVOICE', documentId: inv.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const canCost = user.permissions.has('*') || user.permissions.has('sales.report.view');
    return {
      ...inv, dueAmount: D(inv.totalAmount).minus(D(inv.paidAmount)), costTotal: canCost ? inv.costTotal : undefined,
      lines: inv.lines.map((l) => ({ ...l, unitCost: canCost ? l.unitCost : undefined, costTotal: canCost ? l.costTotal : undefined })),
      payments: allocations.filter((a) => a.payment.status === 'POSTED'), movements: canCost ? movements : undefined,
    };
  }

  /** Price a variant for the POS: list price from the price book (if any) or the product, per selling unit. */
  async price(user: RequestUser, q: PosPriceQueryDto) {
    const v = await this.prisma.db.productVariant.findFirst({ where: { id: q.variantId, deletedAt: null }, include: { product: { include: { units: true } } } });
    if (!v) throw Errors.notFound('Hàng hóa', q.variantId);
    if (!v.isActive || !v.product.isActive || !v.product.allowSale) throw Errors.conflict('PRODUCT_NOT_SELLABLE', 'Hàng hóa ngừng kinh doanh hoặc không cho phép bán', { variantId: v.id });
    const unit = q.productUnitId ? v.product.units.find((u) => u.id === q.productUnitId) : undefined;
    if (q.productUnitId && !unit) throw Errors.notFound('Đơn vị quy đổi', q.productUnitId);
    if (unit && !unit.isDirectSale) throw Errors.validation('Đơn vị này không bán trực tiếp', { productUnitId: unit.id });
    if (q.priceBookId) { const anyBranch = await this.prisma.db.priceBook.findFirst({ where: { id: q.priceBookId }, select: { branches: { select: { branchId: true } } } }); await this.assertPriceBook(this.prisma.db, user, q.priceBookId, anyBranch?.branches[0]?.branchId ?? ''); }
    const resolved = await this.resolvePrice(this.prisma.db, v, unit ?? null, toQty(q.quantity ?? 1), q.priceBookId ?? null);
    return { variantId: v.id, productUnitId: unit?.id ?? null, unitName: unit?.unitName ?? v.product.baseUnit, conversionFactor: unit ? unit.conversionFactor : D(1), ...resolved, taxRate: v.product.taxRate ?? ZERO };
  }

  // ---------------------------------------------------------------- drafts (giữ đơn)
  async create(user: RequestUser, dto: CreateInvoiceDto) {
    return this.prisma.tx(async (tx) => this.decorate(tx, user, await this.createInTx(tx, user, dto)));
  }

  /** Draft inside the caller's transaction (exchanges create the replacement invoice here; the code may be pre-fetched to keep the lock order). */
  async createInTx(tx: TxClient, user: RequestUser, dto: CreateInvoiceDto, allowPayments = false, code?: string, opts: { trustedPrices?: boolean } = {}) {
    if (!allowPayments && dto.payments?.length) throw Errors.validation('Giữ đơn không nhận thanh toán; dùng checkout hoặc complete');
    this.access.assertBranch(user, dto.branchId);
    await this.access.assertWarehouse(user, dto.warehouseId, dto.branchId, tx);
    const customer = dto.customerId ? await this.assertCustomer(tx, dto.customerId) : null;
    const sellerId = await this.resolveSeller(tx, user, dto.sellerId, opts.trustedPrices);
    if (dto.priceBookId && !opts.trustedPrices) await this.assertPriceBook(tx, user, dto.priceBookId, dto.branchId, customer?.groupName ?? null);
    const resolved = await this.resolveLines(tx, user, dto.lines, dto.priceBookId ?? null, undefined, opts.trustedPrices);
    const docDiscount = money(dto.discountAmount ?? 0);
    if (docDiscount.greaterThan(0) && !opts.trustedPrices && !hasPermission(user.permissions, 'invoice.discount')) throw Errors.forbidden('Thiếu quyền: invoice.discount');
    const promo = await this.applyPromotions(tx, user, { branchId: dto.branchId, customer, voucherCode: dto.voucherCode ?? null, excludeIds: dto.excludePromotionIds ?? [], enabled: dto.applyPromotions !== false }, resolved);
    const calc = await this.compute(tx, resolved, docDiscount.plus(promo.promoDoc));
    await this.assertDiscountCeiling(tx, resolved, docDiscount, calc.subtotal);
    const redeem = await this.planPoints(tx, customer, dto.redeemPoints, calc.totalAmount);
    code = code ?? (await this.numbering.next(tx, 'INVOICE'));
    const inv = await tx.invoice.create({
      data: {
        tenantId: user.tenantId, branchId: dto.branchId, warehouseId: dto.warehouseId, customerId: customer?.id ?? null, sellerId, priceBookId: dto.priceBookId ?? null, code,
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : new Date(), note: dto.note, createdById: user.id,
        subtotal: calc.subtotal, discountAmount: docDiscount, promotionDiscount: promo.promoDoc, voucherCode: promo.voucherCode, taxAmount: calc.taxAmount, totalAmount: calc.totalAmount, pointsRedeemed: redeem.points, pointsValue: redeem.value,
        lines: { create: resolved.map((l, i) => this.lineData(user, l, i, calc.lines[i])) },
      },
    });
    await this.promotions.record(tx, user.tenantId, inv.id, promo.applied);
    return tx.invoice.findFirstOrThrow({ where: { id: inv.id }, include: invoiceInclude });
  }

  private lineData(user: RequestUser, l: ResolvedLine, i: number, c: { taxAmount: Prisma.Decimal; lineTotal: Prisma.Decimal }) {
    return { tenantId: user.tenantId, lineNo: i + 1, variantId: l.variantId, batchId: l.batchId, productUnitId: l.productUnitId, unitName: l.unitName, conversionFactor: l.conversionFactor, quantity: l.quantity, baseQuantity: l.baseQuantity, listPrice: l.listPrice, unitPrice: l.unitPrice, discountAmount: l.discountAmount, promotionDiscount: l.promotionDiscount, promotionId: l.promotionId, isGift: l.isGift, taxRate: l.taxRate, taxAmount: c.taxAmount, lineTotal: c.lineTotal, note: l.note };
  }

  /**
   * Runs the promotion engine over the resolved lines (BR-90..BR-96): sets promotionDiscount/promotionId per line, returns the
   * invoice-level promotion discount. Gift lines must be fully granted; an unknown/invalid voucher is an error.
   */
  private async applyPromotions(tx: TxClient, user: RequestUser, o: { branchId: string; customer: { id: string; groupName: string | null } | null; voucherCode: string | null; excludeIds: string[]; enabled: boolean }, resolved: ResolvedLine[]): Promise<PromoOutcome> {
    for (const l of resolved) { l.promotionDiscount = ZERO; l.promotionId = null; }
    if (!o.enabled) {
      if (resolved.some((l) => l.isGift)) throw Errors.validation('Không áp dụng khuyến mãi thì không thể có dòng hàng tặng');
      if (o.voucherCode) throw Errors.validation('Không áp dụng khuyến mãi thì không dùng được voucher');
      return { promoDoc: ZERO, applied: [], gifts: [], voucherCode: null };
    }
    const lines: PromoLine[] = resolved.map((l, i) => ({ key: String(i), variantId: l.variantId, categoryId: l.categoryId, quantity: l.quantity, unitPrice: l.unitPrice, manualDiscount: l.discountAmount, isGift: l.isGift, giftPromotionId: l.giftPromotionId }));
    const { result, voucher } = await this.promotions.evaluate(tx, user.tenantId, { branchId: o.branchId, customerId: o.customer?.id ?? null, customerGroup: o.customer?.groupName ?? null, voucherCode: o.voucherCode, excludeIds: o.excludeIds, lines });
    const err = result.errors[0];
    if (err) throw err.code === 'VOUCHER_INVALID' ? Errors.conflict('VOUCHER_INVALID', err.message, err.details) : Errors.validation(err.message, err.details);
    resolved.forEach((l, i) => { const d = result.lineDiscounts.get(String(i)); if (d) { l.promotionDiscount = d.amount; l.promotionId = d.promotionId; } });
    return { promoDoc: result.invoiceDiscount, applied: result.applied, gifts: result.gifts, voucherCode: voucher ? voucher.code : null };
  }

  /** Redemption request → { points, value } validated against config, balance and payable (BR-141); drafts store the intent. */
  private async planPoints(tx: TxClient, customer: { id: string } | null, requested: string | undefined | null, payable: Prisma.Decimal) {
    const pts = D(requested ?? 0);
    if (pts.lessThanOrEqualTo(0)) return { points: ZERO, value: ZERO };
    if (!customer) throw Errors.validation('Dùng điểm cần chọn khách hàng');
    const cfg = await this.loyalty.config(tx);
    const c = await tx.customer.findFirstOrThrow({ where: { id: customer.id }, select: { points: true } });
    return this.loyalty.plan(cfg, D(c.points), pts, payable);
  }

  /** POS live totals: same pipeline as checkout without writing anything. */
  async preview(user: RequestUser, dto: CreateInvoiceDto) {
    return this.prisma.tx(async (tx) => {
      this.access.assertBranch(user, dto.branchId);
      const customer = dto.customerId ? await this.assertCustomer(tx, dto.customerId) : null;
      if (dto.priceBookId) await this.assertPriceBook(tx, user, dto.priceBookId, dto.branchId, customer?.groupName ?? null);
      const resolved = await this.resolveLines(tx, user, dto.lines, dto.priceBookId ?? null);
      const docDiscount = money(dto.discountAmount ?? 0);
      const promo = await this.applyPromotions(tx, user, { branchId: dto.branchId, customer, voucherCode: dto.voucherCode ?? null, excludeIds: dto.excludePromotionIds ?? [], enabled: dto.applyPromotions !== false }, resolved);
      const calc = await this.compute(tx, resolved, docDiscount.plus(promo.promoDoc));
      const redeem = await this.planPoints(tx, customer, dto.redeemPoints, calc.totalAmount);
      const cfg = await this.loyalty.config(tx);
      const balance = customer ? D((await tx.customer.findFirstOrThrow({ where: { id: customer.id }, select: { points: true } })).points) : ZERO;
      const loyalty = { enabled: cfg.enabled, pointValue: cfg.redeemValue, minRedeem: cfg.minRedeem, balance, maxRedeemPoints: customer ? this.loyalty.maxRedeem(cfg, balance, calc.totalAmount) : ZERO, redeemPoints: redeem.points, redeemValue: redeem.value, payableAfterPoints: calc.totalAmount.minus(redeem.value), earnPreview: customer ? this.loyalty.earnFor(cfg, calc.totalAmount.minus(redeem.value)) : ZERO };
      const names = promo.applied.length || promo.gifts.length ? await tx.promotion.findMany({ where: { id: { in: Array.from(new Set([...promo.applied.map((a) => a.promotionId), ...promo.gifts.map((g) => g.promotionId)])) } }, select: { id: true, code: true, name: true, type: true } }) : [];
      const giftVariants = promo.gifts.length ? await tx.productVariant.findMany({ where: { id: { in: Array.from(new Set(promo.gifts.flatMap((g) => g.variantIds))) } }, select: { id: true, sku: true, name: true, sellPrice: true } }) : [];
      return {
        subtotal: calc.subtotal, discountAmount: docDiscount, promotionDiscount: promo.promoDoc, taxAmount: calc.taxAmount, totalAmount: calc.totalAmount, voucherCode: promo.voucherCode, loyalty,
        lines: resolved.map((l, i) => ({ variantId: l.variantId, productUnitId: l.productUnitId, quantity: l.quantity, listPrice: l.listPrice, unitPrice: l.unitPrice, discountAmount: l.discountAmount, promotionDiscount: l.promotionDiscount, promotionId: l.promotionId, isGift: l.isGift, taxAmount: calc.lines[i].taxAmount, lineTotal: calc.lines[i].lineTotal })),
        promotions: promo.applied.map((a) => ({ ...a, name: names.find((n) => n.id === a.promotionId)?.name ?? a.name })),
        gifts: promo.gifts.map((g) => ({ ...g, remaining: g.quantity.minus(g.claimed), variants: giftVariants.filter((v) => g.variantIds.includes(v.id)) })),
      };
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateInvoiceDto) {
    return this.prisma.tx(async (tx) => {
      const inv = await this.lock(tx, user, id);
      if (inv.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ sửa được đơn đang giữ', { status: inv.status });
      if (inv.version !== dto.version) throw Errors.conflict('VERSION_CONFLICT', 'Đơn đã được người khác thay đổi, vui lòng tải lại', { current: inv.version });
      if (dto.warehouseId) await this.access.assertWarehouse(user, dto.warehouseId, inv.branchId, tx);
      if (dto.customerId) await this.assertCustomer(tx, dto.customerId);
      const sellerId = dto.sellerId ? await this.resolveSeller(tx, user, dto.sellerId) : undefined;
      const priceBookId = dto.priceBookId === undefined ? inv.priceBookId : dto.priceBookId;
      if (priceBookId && dto.priceBookId !== undefined) await this.assertPriceBook(tx, user, priceBookId, inv.branchId);
      const existing = await tx.invoiceLine.findMany({ where: { invoiceId: id }, orderBy: { lineNo: 'asc' } });
      // lines not resent are kept exactly as stored (prices were authorised when they were set); resent lines whose
      // price equals the stored price of the same item are not treated as a price edit (M4)
      const previous = new Map(existing.map((l) => [`${l.variantId}|${l.productUnitId ?? ''}`, { unitPrice: D(l.unitPrice), listPrice: D(l.listPrice) }]));
      let resolved: ResolvedLine[];
      if (dto.lines) resolved = await this.resolveLines(tx, user, dto.lines, priceBookId, previous);
      else {
        const cats = await tx.productVariant.findMany({ where: { id: { in: existing.map((l) => l.variantId) } }, select: { id: true, product: { select: { categoryId: true } } } });
        const catOf = new Map(cats.map((c) => [c.id, c.product.categoryId]));
        resolved = existing.map((l) => ({ variantId: l.variantId, batchId: l.batchId, productUnitId: l.productUnitId, unitName: l.unitName, conversionFactor: D(l.conversionFactor), quantity: D(l.quantity), baseQuantity: D(l.baseQuantity), listPrice: D(l.listPrice), unitPrice: D(l.unitPrice), discountAmount: D(l.discountAmount), taxRate: D(l.taxRate), note: l.note, productType: 'GOODS' as const, trackBatch: false, categoryId: catOf.get(l.variantId) ?? null, comboItems: [], isGift: l.isGift, giftPromotionId: l.isGift ? l.promotionId : null, promotionDiscount: ZERO, promotionId: null }));
      }
      const docDiscount = money(dto.discountAmount ?? inv.discountAmount);
      if (docDiscount.greaterThan(0) && dto.discountAmount !== undefined && !hasPermission(user.permissions, 'invoice.discount')) throw Errors.forbidden('Thiếu quyền: invoice.discount');
      const customerId = dto.customerId === undefined ? inv.customerId : dto.customerId;
      const customer = customerId ? await tx.customer.findFirst({ where: { id: customerId }, select: { id: true, groupName: true } }) : null;
      const promo = await this.applyPromotions(tx, user, { branchId: inv.branchId, customer, voucherCode: dto.voucherCode === undefined ? inv.voucherCode : dto.voucherCode, excludeIds: dto.excludePromotionIds ?? [], enabled: dto.applyPromotions !== false }, resolved);
      const calc = await this.compute(tx, resolved, docDiscount.plus(promo.promoDoc));
      if (dto.lines || dto.discountAmount !== undefined) await this.assertDiscountCeiling(tx, resolved, docDiscount, calc.subtotal);
      await this.promotions.record(tx, user.tenantId, id, promo.applied);
      const redeem = await this.planPoints(tx, customer, dto.redeemPoints === undefined ? inv.pointsRedeemed.toString() : dto.redeemPoints, calc.totalAmount);
      const after = await tx.invoice.update({
        where: { id },
        data: {
          warehouseId: dto.warehouseId, customerId: dto.customerId === undefined ? undefined : dto.customerId, sellerId, priceBookId: dto.priceBookId === undefined ? undefined : dto.priceBookId, note: dto.note, version: { increment: 1 },
          subtotal: calc.subtotal, discountAmount: docDiscount, promotionDiscount: promo.promoDoc, voucherCode: promo.voucherCode, taxAmount: calc.taxAmount, totalAmount: calc.totalAmount, pointsRedeemed: redeem.points, pointsValue: redeem.value,
          lines: { deleteMany: {}, create: resolved.map((l, i) => this.lineData(user, l, i, calc.lines[i])) },
        },
        include: invoiceInclude,
      });
      await this.audit.log(tx, { action: 'invoice.update', entityType: 'Invoice', entityId: id, entityCode: inv.code, before: { version: inv.version }, after: { version: after.version, totalAmount: after.totalAmount } });
      return this.decorate(tx, user, after);
    });
  }

  async remove(user: RequestUser, id: string) {
    await this.prisma.tx(async (tx) => {
      const inv = await this.lock(tx, user, id);
      if (inv.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_EDITABLE', 'Chỉ xóa được đơn đang giữ', { status: inv.status });
      await tx.invoice.delete({ where: { id } });
      await this.audit.log(tx, { action: 'invoice.delete', entityType: 'Invoice', entityId: id, entityCode: inv.code });
    });
  }

  // ---------------------------------------------------------------- checkout / complete (BR-53)
  async checkout(user: RequestUser, dto: CreateInvoiceDto) {
    return this.prisma.tx(async (tx) => {
      const inv = await this.createInTx(tx, user, dto, true);
      return this.completeInTx(tx, user, inv.id, dto.payments ?? []);
    });
  }

  async complete(user: RequestUser, id: string, dto: CompleteInvoiceDto) {
    return this.prisma.tx((tx) => this.completeInTx(tx, user, id, dto.payments ?? [], dto.version));
  }

  /** Completes a draft inside the caller's transaction; `extraPayments` are system vouchers (OFFSET from an exchange) allocated to the invoice. */
  async completeInTx(tx: TxClient, user: RequestUser, id: string, paymentsIn: InvoicePaymentDto[], expectedVersion?: number, prefetchedCodes?: string[], extraPayments: PaymentInput[] = [], prepaid: Prisma.Decimal = ZERO) {
    const inv = await this.lock(tx, user, id);
    if (inv.status !== 'DRAFT') throw Errors.conflict('DOCUMENT_NOT_DRAFT', 'Hóa đơn không ở trạng thái giữ đơn', { status: inv.status });
    if (expectedVersion !== undefined && inv.version !== expectedVersion) throw Errors.conflict('VERSION_CONFLICT', 'Đơn đã được thay đổi ở nơi khác, vui lòng tải lại trước khi thanh toán', { current: inv.version });
    const wh = await tx.warehouse.findFirst({ where: { id: inv.warehouseId } });
    if (!wh?.isActive) throw Errors.validation('Kho không hoạt động', { warehouseId: inv.warehouseId });
    const customer = inv.customerId ? await this.assertCustomer(tx, inv.customerId) : null;
    const settings = await this.settings(tx);
    const shiftId = await this.shifts.openShiftId(tx, user, inv.branchId);
    if (settings.requireShift && !shiftId) throw Errors.conflict('SHIFT_REQUIRED', 'Bạn cần mở ca bán hàng trước khi thanh toán');

    // lock order: invoice → sequences (payment codes) → promotions/vouchers → stock → party balance
    const paymentCodes: string[] = [];
    for (const [i, p] of paymentsIn.entries()) { if (!money(p.amount).greaterThan(0)) throw Errors.validation('Số tiền thanh toán phải lớn hơn 0'); paymentCodes.push(prefetchedCodes?.[i] ?? (await this.payments.nextCode(tx, 'IN'))); }
    const pointsValue = D(inv.pointsValue);
    const pointsCode = pointsValue.greaterThan(0) ? await this.payments.nextCode(tx, 'IN') : undefined;
    const paid = paymentsIn.reduce((s, p) => s.plus(money(p.amount)), ZERO).plus(extraPayments.reduce((s, p) => s.plus(p.amount), ZERO)).plus(prepaid).plus(pointsValue); // prepaid = deposits moved from a sales order; points pay like money
    const total = D(inv.totalAmount);
    if (paid.greaterThan(total)) throw Errors.conflict('OVERPAYMENT', 'Tổng thanh toán vượt quá tổng hóa đơn', { total: total.toString(), paid: paid.toString() });
    const due = total.minus(paid);
    if (due.greaterThan(0)) {
      if (!customer) throw Errors.validation('Bán nợ (thanh toán thiếu) phải chọn khách hàng', { due: due.toString() });
      if (!settings.allowCredit) throw Errors.conflict('CREDIT_NOT_ALLOWED', 'Cửa hàng không cho phép bán nợ', { due: due.toString() });
    }

    // promotions: usage limits / voucher uses are counted here under row locks (BR-95)
    await this.promotions.consume(tx, user, id);
    // loyalty: spend the points now, under the customer row lock (BR-141)
    if (pointsValue.greaterThan(0)) {
      if (!customer) throw Errors.validation('Dùng điểm cần chọn khách hàng');
      await this.loyalty.post(tx, user, { customerId: customer.id, type: 'REDEEM', points: D(inv.pointsRedeemed).negated(), documentType: 'INVOICE', documentId: inv.id, documentCode: inv.code, note: `Thanh toán bằng điểm hóa đơn ${inv.code}` });
    }

    // stock + COGS (BR-54): expand combos, sort by (variant,batch), apply SALE at average cost
    const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id }, orderBy: { lineNo: 'asc' } });
    const variants = await tx.productVariant.findMany({ where: { id: { in: lines.map((l) => l.variantId) } }, include: { product: { include: { comboItems: true } } } });
    const vById = new Map(variants.map((v) => [v.id, v]));
    const ops: Array<{ lineId: string; variantId: string; batchId: string | null; quantity: Prisma.Decimal }> = [];
    for (const l of lines) {
      const v = vById.get(l.variantId);
      if (!v) throw Errors.notFound('Hàng hóa', l.variantId);
      if (v.product.type === 'GOODS') ops.push({ lineId: l.id, variantId: l.variantId, batchId: l.batchId, quantity: D(l.baseQuantity) });
      else if (v.product.type === 'COMBO') for (const ci of v.product.comboItems) ops.push({ lineId: l.id, variantId: ci.componentVariantId, batchId: null, quantity: D(l.baseQuantity).times(D(ci.quantity)) });
    }
    ops.sort(StockEngineService.sortKey);
    const allowNegative = await this.engine.allowNegative(tx);
    const costByLine = new Map<string, Prisma.Decimal>();
    for (const op of ops) {
      const r = await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: inv.warehouseId, variantId: op.variantId, batchId: op.batchId, quantity: op.quantity.negated(), unitCost: null, type: 'SALE', documentType: 'INVOICE', documentId: inv.id, documentCode: inv.code, lineId: op.lineId, userId: user.id, allowNegative });
      costByLine.set(op.lineId, (costByLine.get(op.lineId) ?? ZERO).plus(r.totalCost));
    }
    let costTotal = ZERO;
    for (const l of lines) {
      const c = costByLine.get(l.id) ?? ZERO;
      costTotal = costTotal.plus(c);
      await tx.invoiceLine.update({ where: { id: l.id }, data: { costTotal: c, unitCost: D(l.baseQuantity).isZero() ? ZERO : c.dividedBy(D(l.baseQuantity)).toDecimalPlaces(4) } });
    }

    // customer ledger: SALE (+total); credit limit checked on the balance after this sale minus what is paid now (BR-56)
    if (customer && total.greaterThan(0)) {
      const entry = await this.ledger.post(tx, { tenantId: user.tenantId, partyType: 'CUSTOMER', partyId: customer.id, branchId: inv.branchId, type: 'SALE', amount: total, documentType: 'INVOICE', documentId: inv.id, documentCode: inv.code, userId: user.id });
      const projected = D(entry.balanceAfter).minus(paid);
      if (due.greaterThan(0) && customer.creditLimit !== null && projected.greaterThan(D(customer.creditLimit))) throw Errors.conflict('CREDIT_LIMIT_EXCEEDED', 'Vượt hạn mức nợ của khách hàng', { creditLimit: customer.creditLimit.toString(), projectedBalance: projected.toString() });
    }

    await tx.invoice.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), shiftId, costTotal, version: { increment: 1 } } });
    for (const [i, p] of paymentsIn.entries()) {
      // chuyển khoản qua mã VietQR/SePay: chỉ dùng được phần tiền đã thực nhận cho mã đó (BR-173)
      const bankReq = p.bankRequestId ? await this.bankTransfers.lockPosRequestInTx(tx, user, p.bankRequestId, inv.branchId, money(p.amount)) : null;
      const payment = await this.payments.createInTx(tx, user, { branchId: inv.branchId, direction: 'IN', method: (bankReq ? 'BANK_TRANSFER' : p.method) as PaymentMethod, partyType: customer ? 'CUSTOMER' : null, partyId: customer?.id ?? null, shiftId, amount: money(p.amount), reference: p.reference ?? (bankReq ? `SePay ${bankReq.code}` : undefined), cashAccountId: bankReq ? bankReq.cashAccountId : p.cashAccountId, note: `Thanh toán hóa đơn ${inv.code}`, allocations: [{ documentType: 'INVOICE', documentId: inv.id, amount: money(p.amount) }], code: paymentCodes[i], permissionChecked: true });
      if (bankReq) await this.bankTransfers.markConsumedInTx(tx, bankReq, money(p.amount), { id: inv.id, code: inv.code }, payment.id);
    }
    if (pointsValue.greaterThan(0) && customer) {
      await this.payments.createInTx(tx, user, { branchId: inv.branchId, direction: 'IN', method: 'POINTS', partyType: 'CUSTOMER', partyId: customer.id, shiftId, amount: pointsValue, note: `Thanh toán bằng ${inv.pointsRedeemed.toString()} điểm`, allocations: [{ documentType: 'INVOICE', documentId: inv.id, amount: pointsValue }], code: pointsCode, permissionChecked: true, allowOffset: true });
    }
    // loyalty: earn on the part paid with money (BR-140)
    if (customer) {
      const cfg = await this.loyalty.config(tx);
      const earned = this.loyalty.earnFor(cfg, total.minus(pointsValue));
      if (earned.greaterThan(0)) {
        await this.loyalty.post(tx, user, { customerId: customer.id, type: 'EARN', points: earned, documentType: 'INVOICE', documentId: inv.id, documentCode: inv.code, note: `Tích điểm hóa đơn ${inv.code}` });
        await tx.invoice.update({ where: { id }, data: { pointsEarned: earned } });
      }
    }
    // system vouchers (e.g. OFFSET from an exchange) are allocated to this invoice as well
    for (const extra of extraPayments) {
      await this.payments.createInTx(tx, user, { ...extra, branchId: inv.branchId, direction: 'IN', partyType: customer ? 'CUSTOMER' : null, partyId: customer?.id ?? null, shiftId, allocations: [{ documentType: 'INVOICE', documentId: inv.id, amount: extra.amount }], permissionChecked: true, allowOffset: true });
    }
    await this.audit.log(tx, { action: 'invoice.complete', entityType: 'Invoice', entityId: id, entityCode: inv.code, after: { status: 'COMPLETED', totalAmount: total.toString(), paid: paid.toString(), costTotal: costTotal.toString(), shiftId } });
    await this.outbox.enqueue(tx, { eventType: 'invoice.completed', aggregateType: 'Invoice', aggregateId: id, payload: { code: inv.code, branchId: inv.branchId, customerId: customer?.id ?? null, totalAmount: total.toString(), paid: paid.toString() } });
    return this.decorate(tx, user, await tx.invoice.findFirstOrThrow({ where: { id }, include: invoiceInclude }));
  }

  // ---------------------------------------------------------------- cancel (hủy giao dịch, BR-57)
  async cancel(user: RequestUser, id: string, reason: string) {
    return this.prisma.tx(async (tx) => {
      const inv = await this.lock(tx, user, id);
      if (inv.status !== 'COMPLETED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ hủy được hóa đơn đã hoàn thành', { status: inv.status });
      if (D(inv.returnedAmount).greaterThan(0)) throw Errors.conflict('INVOICE_HAS_RETURNS', 'Hóa đơn đã có trả hàng, không thể hủy');
      const activeDelivery = await tx.delivery.findFirst({ where: { invoiceId: id, status: { in: ['PICKING', 'DELIVERING', 'RETURNING'] } }, select: { code: true } });
      if (activeDelivery) throw Errors.conflict('INVOICE_HAS_DELIVERY', `Vận đơn ${activeDelivery.code} đang giao, hãy hủy vận đơn trước`, { deliveryCode: activeDelivery.code });
      // lock order identical to completeInTx: invoice → stock (variant/balance) → party balance (payments, ledger) — see BR-48/H2
      const allocs = await tx.paymentAllocation.findMany({ where: { documentType: 'INVOICE', documentId: id }, include: { payment: { select: { id: true, status: true, amount: true, allocated: true } } } });
      const postedPayments = allocs.filter((a) => a.payment.status === 'POSTED');
      // a voucher shared with other documents or carrying a prepayment must be cancelled manually first (fail before touching stock)
      for (const a of postedPayments) if (!D(a.payment.allocated).equals(D(a.payment.amount))) throw Errors.conflict('PAYMENT_SHARED', 'Phiếu thu có phần trả trước, hãy hủy phiếu thu thủ công trước', { paymentId: a.paymentId });
      const allowNegative = await this.engine.allowNegative(tx);
      const movements = await tx.stockMovement.findMany({ where: { documentType: 'INVOICE', documentId: id, type: { not: 'REVERSAL' } } });
      movements.sort(StockEngineService.sortKey);
      for (const m of movements) await this.engine.apply(tx, { tenantId: user.tenantId, warehouseId: m.warehouseId, variantId: m.variantId, batchId: m.batchId, quantity: D(m.quantity).negated(), unitCost: D(m.unitCost), type: 'REVERSAL', documentType: 'INVOICE', documentId: id, documentCode: inv.code, lineId: m.lineId, reason: 'CANCEL', note: reason, userId: user.id, allowNegative });
      const paymentIds = Array.from(new Set(postedPayments.map((a) => a.paymentId))).sort();
      for (const pid of paymentIds) await this.payments.cancelInTx(tx, user, pid, `Hủy hóa đơn ${inv.code}: ${reason}`, { onlyDocument: { type: 'INVOICE', id } });
      // an exchange settled part of a return with an OFFSET pair (BR-65): cancelling the replacement invoice re-opens that part of the
      // refund on the return (OFFSET OUT cancelled → refundedAmount drops, customer credit restored; walk-ins get dueRefund to pay out)
      const exchanged = await tx.salesReturn.findMany({ where: { exchangeInvoiceId: id, status: 'COMPLETED' }, select: { id: true, code: true }, orderBy: { id: 'asc' } });
      for (const ret of exchanged) {
        const offsets = await tx.payment.findMany({ where: { method: 'OFFSET', direction: 'OUT', status: 'POSTED', allocations: { some: { documentType: 'SALES_RETURN', documentId: ret.id } } }, select: { id: true }, orderBy: { id: 'asc' } });
        for (const o of offsets) await this.payments.cancelInTx(tx, user, o.id, `Hủy hóa đơn đổi hàng ${inv.code}: ${reason}`, { onlyDocument: { type: 'SALES_RETURN', id: ret.id } });
      }
      await this.ledger.reverseDocument(tx, user.tenantId, 'INVOICE', id, inv.code, `Hủy hóa đơn: ${reason}`, user.id);
      await this.promotions.release(tx, user, id);
      await this.loyalty.reverseDocument(tx, user, 'INVOICE', id, inv.code, `Hủy hóa đơn ${inv.code}`);
      await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason, version: { increment: 1 } } });
      await this.audit.log(tx, { action: 'invoice.cancel', entityType: 'Invoice', entityId: id, entityCode: inv.code, before: { status: 'COMPLETED' }, after: { status: 'CANCELLED', reason, cancelledPayments: paymentIds.length, reopenedReturns: exchanged.map((r) => r.code) } });
      await this.outbox.enqueue(tx, { eventType: 'invoice.cancelled', aggregateType: 'Invoice', aggregateId: id, payload: { code: inv.code, reason } });
      return this.decorate(tx, user, await tx.invoice.findFirstOrThrow({ where: { id }, include: invoiceInclude }));
    });
  }

  // ---------------------------------------------------------------- helpers
  async lock(tx: TxClient, user: RequestUser, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Hóa đơn', id);
    const inv = await tx.invoice.findFirstOrThrow({ where: { id } });
    this.access.assertBranch(user, inv.branchId);
    await this.access.assertWarehouse(user, inv.warehouseId, inv.branchId, tx);
    return inv;
  }

  async settings(tx: TxClient) {
    const rows = await tx.tenantSetting.findMany({ where: { key: { in: [TENANT_SETTING_KEYS.PRICE_INCLUDES_TAX, TENANT_SETTING_KEYS.POS_REQUIRE_SHIFT, TENANT_SETTING_KEYS.POS_ALLOW_CREDIT, TENANT_SETTING_KEYS.POS_MAX_DISCOUNT_PERCENT] } } });
    const get = (k: string, d: boolean) => { const r = rows.find((x) => x.key === k); return r ? r.value === true : d; };
    const maxRow = rows.find((x) => x.key === TENANT_SETTING_KEYS.POS_MAX_DISCOUNT_PERCENT);
    return { priceIncludesTax: get(TENANT_SETTING_KEYS.PRICE_INCLUDES_TAX, true), requireShift: get(TENANT_SETTING_KEYS.POS_REQUIRE_SHIFT, false), allowCredit: get(TENANT_SETTING_KEYS.POS_ALLOW_CREDIT, true), maxDiscountPercent: typeof maxRow?.value === 'number' ? maxRow.value : 100 };
  }

  /** pos.maxDiscountPercent caps every line discount and the document discount (M3). */
  private async assertDiscountCeiling(tx: TxClient, lines: ResolvedLine[], docDiscount: Prisma.Decimal, subtotal: Prisma.Decimal) {
    const { maxDiscountPercent } = await this.settings(tx);
    if (maxDiscountPercent >= 100) return;
    const cap = D(maxDiscountPercent);
    for (const [i, l] of lines.entries()) {
      const gross = l.quantity.times(l.unitPrice);
      if (gross.greaterThan(0) && l.discountAmount.times(100).dividedBy(gross).greaterThan(cap)) throw Errors.conflict('DISCOUNT_LIMIT_EXCEEDED', `Dòng ${i + 1}: giảm giá vượt trần ${maxDiscountPercent}%`, { maxDiscountPercent });
    }
    if (subtotal.greaterThan(0) && docDiscount.times(100).dividedBy(subtotal).greaterThan(cap)) throw Errors.conflict('DISCOUNT_LIMIT_EXCEEDED', `Giảm giá hóa đơn vượt trần ${maxDiscountPercent}%`, { maxDiscountPercent });
  }

  async assertCustomer(tx: TxClient, id: string) {
    const c = await tx.customer.findFirst({ where: { id } });
    if (!c) throw Errors.notFound('Khách hàng', id);
    if (!c.isActive) throw Errors.validation('Khách hàng đã ngừng giao dịch', { customerId: id });
    return c;
  }

  async resolveSeller(tx: TxClient, user: RequestUser, sellerId?: string, trusted = false) {
    if (!sellerId || sellerId === user.id) return user.id;
    if (!trusted && !hasPermission(user.permissions, 'invoice.seller.change')) throw Errors.forbidden('Thiếu quyền: invoice.seller.change');
    const u = await tx.user.findFirst({ where: { id: sellerId, status: 'ACTIVE' } });
    if (!u) throw Errors.notFound('Nhân viên bán', sellerId);
    return sellerId;
  }

  /** Price books usable for this branch / customer right now, best first (BR-97). */
  async applicablePriceBooks(user: RequestUser, branchId: string, customerId?: string) {
    this.access.assertBranch(user, branchId);
    const customer = customerId ? await this.prisma.db.customer.findFirst({ where: { id: customerId }, select: { groupName: true } }) : null;
    const now = new Date();
    const books = await this.prisma.db.priceBook.findMany({ where: { status: 'ACTIVE', OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }, { OR: [{ branches: { none: {} } }, { branches: { some: { branchId } } }] }] }, include: { _count: { select: { items: true } } }, orderBy: [{ priority: 'desc' }, { name: 'asc' }] });
    return books.filter((b) => !b.customerGroups.length || (customer?.groupName && b.customerGroups.includes(customer.groupName))).map((b) => ({ id: b.id, code: b.code, name: b.name, priority: b.priority, customerGroups: b.customerGroups, items: b._count.items, suggested: b.customerGroups.length > 0 }));
  }

  async assertPriceBook(tx: TxClient | PrismaService['db'], user: RequestUser, id: string, branchId: string, customerGroup?: string | null) {
    if (!hasPermission(user.permissions, 'invoice.pricebook.select')) throw Errors.forbidden('Thiếu quyền: invoice.pricebook.select');
    const pb = await tx.priceBook.findFirst({ where: { id }, include: { branches: true } });
    if (!pb) throw Errors.notFound('Bảng giá', id);
    if (customerGroup !== undefined && pb.customerGroups.length && (!customerGroup || !pb.customerGroups.includes(customerGroup))) throw Errors.validation('Bảng giá chỉ áp dụng cho nhóm khách hàng khác', { priceBookId: id, customerGroups: pb.customerGroups });
    const now = new Date();
    if (pb.status !== 'ACTIVE' || (pb.startsAt && pb.startsAt > now) || (pb.endsAt && pb.endsAt < now)) throw Errors.validation('Bảng giá không còn hiệu lực', { priceBookId: id });
    if (pb.branches.length && !pb.branches.some((b) => b.branchId === branchId)) throw Errors.validation('Bảng giá không áp dụng cho chi nhánh này', { priceBookId: id });
    return pb;
  }

  /** List price per selling unit: price book item (highest minQuantity ≤ qty) × factor, else unit/product sell price. */
  private async resolvePrice(db: TxClient | PrismaService['db'], v: { id: string; sellPrice: Prisma.Decimal }, unit: { id: string; conversionFactor: Prisma.Decimal; sellPrice: Prisma.Decimal | null } | null, quantity: Prisma.Decimal, priceBookId: string | null) {
    const factor = unit ? D(unit.conversionFactor) : D(1);
    let listPrice = unit ? (unit.sellPrice !== null ? D(unit.sellPrice) : D(v.sellPrice).times(factor)) : D(v.sellPrice);
    let source: 'PRODUCT' | 'UNIT' | 'PRICE_BOOK' = unit ? 'UNIT' : 'PRODUCT';
    if (priceBookId) {
      const items = await db.priceBookItem.findMany({ where: { priceBookId, variantId: v.id }, orderBy: { minQuantity: 'desc' } });
      const item = items.find((i) => D(i.minQuantity).lessThanOrEqualTo(quantity.times(factor)));
      if (item) { listPrice = money(D(item.price).times(factor)); source = 'PRICE_BOOK'; }
    }
    return { listPrice: money(listPrice), source };
  }

  async resolveLines(tx: TxClient, user: RequestUser, input: InvoiceLineDto[], priceBookId: string | null, previous?: Map<string, { unitPrice: Prisma.Decimal; listPrice: Prisma.Decimal }>, trusted = false): Promise<ResolvedLine[]> {
    const ids = Array.from(new Set(input.map((l) => l.variantId)));
    const variants = await tx.productVariant.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { product: { include: { units: true, comboItems: { include: { componentVariant: { select: { id: true, isActive: true, product: { select: { type: true, trackBatch: true, isActive: true, allowSale: true } } } } } } } } } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    // trusted = prices already authorised on the source document (order → invoice conversion, BR-104)
    const canEditPrice = trusted || hasPermission(user.permissions, 'invoice.price.edit');
    const canDiscount = trusted || hasPermission(user.permissions, 'invoice.discount');
    const out: ResolvedLine[] = [];
    for (const [i, l] of input.entries()) {
      const v = byId.get(l.variantId);
      if (!v) throw Errors.validation(`Dòng ${i + 1}: hàng hóa không tồn tại`, { variantId: l.variantId });
      if (!v.isActive || !v.product.isActive || !v.product.allowSale) throw Errors.conflict('PRODUCT_NOT_SELLABLE', `Dòng ${i + 1}: hàng hóa ngừng kinh doanh hoặc không cho phép bán`, { variantId: l.variantId });
      const unit = l.productUnitId ? v.product.units.find((u) => u.id === l.productUnitId) : undefined;
      if (l.productUnitId && !unit) throw Errors.validation(`Dòng ${i + 1}: đơn vị quy đổi không thuộc hàng hóa`, { productUnitId: l.productUnitId });
      if (unit && v.product.type !== 'GOODS') throw Errors.validation(`Dòng ${i + 1}: chỉ hàng hóa mới bán theo đơn vị quy đổi`);
      if (v.product.type === 'GOODS') {
        if (v.product.trackBatch && !l.batchId) throw Errors.conflict('BATCH_REQUIRED', `Dòng ${i + 1}: hàng theo lô bắt buộc chọn lô`, { variantId: l.variantId });
        if (!v.product.trackBatch && l.batchId) throw Errors.conflict('BATCH_NOT_ALLOWED', `Dòng ${i + 1}: hàng không theo dõi lô`, { variantId: l.variantId });
        if (l.batchId && !(await tx.productBatch.findFirst({ where: { id: l.batchId, variantId: v.id } }))) throw Errors.validation(`Dòng ${i + 1}: lô không thuộc hàng hóa này`);
      } else if (l.batchId) throw Errors.validation(`Dòng ${i + 1}: dịch vụ / combo không có lô`);
      if (v.product.type === 'COMBO') {
        if (v.product.comboItems.length === 0) throw Errors.validation(`Dòng ${i + 1}: combo chưa có thành phần`);
        const bad = v.product.comboItems.find((c) => c.componentVariant.product.type !== 'GOODS' || c.componentVariant.product.trackBatch || !c.componentVariant.isActive || !c.componentVariant.product.isActive);
        if (bad) throw Errors.conflict('PRODUCT_NOT_SELLABLE', `Dòng ${i + 1}: combo có thành phần không bán được (ngừng kinh doanh, dịch vụ hoặc hàng theo lô)`, { variantId: l.variantId, componentVariantId: bad.componentVariantId });
      }
      if (unit && !unit.isDirectSale) throw Errors.validation(`Dòng ${i + 1}: đơn vị này không bán trực tiếp`, { productUnitId: unit.id });
      const quantity = toQty(l.quantity);
      const factor = unit ? D(unit.conversionFactor) : D(1);
      const { listPrice } = await this.resolvePrice(tx, v, unit ?? null, quantity, priceBookId);
      const isGift = !!l.isGift;
      if (isGift && !l.promotionId) throw Errors.validation(`Dòng ${i + 1}: hàng tặng phải ghi chương trình khuyến mãi (promotionId)`);
      if (isGift && l.discountAmount) throw Errors.validation(`Dòng ${i + 1}: hàng tặng không giảm giá thủ công`);
      const unitPrice = isGift ? listPrice : l.unitPrice !== undefined ? money(l.unitPrice) : listPrice;
      const prev = previous?.get(`${v.id}|${unit?.id ?? ''}`);
      const unchanged = prev !== undefined && unitPrice.equals(prev.unitPrice);
      if (!unitPrice.equals(listPrice) && !unchanged && !canEditPrice) throw Errors.forbidden(`Dòng ${i + 1}: cần quyền invoice.price.edit để đổi giá bán (niêm yết ${listPrice.toString()})`);
      const discountAmount = money(l.discountAmount ?? 0);
      if (discountAmount.greaterThan(0) && !canDiscount) throw Errors.forbidden(`Dòng ${i + 1}: cần quyền invoice.discount để giảm giá`);
      out.push({
        variantId: v.id, batchId: l.batchId ?? null, productUnitId: unit?.id ?? null, unitName: unit?.unitName ?? v.product.baseUnit ?? null, conversionFactor: factor,
        quantity, baseQuantity: toQty(quantity.times(factor)), listPrice, unitPrice, discountAmount, taxRate: D(v.product.taxRate ?? 0), note: l.note ?? null,
        productType: v.product.type, trackBatch: v.product.trackBatch, categoryId: v.product.categoryId, comboItems: v.product.comboItems.map((c) => ({ componentVariantId: c.componentVariantId, quantity: D(c.quantity) })),
        isGift, giftPromotionId: isGift ? l.promotionId ?? null : null, promotionDiscount: ZERO, promotionId: null,
      });
    }
    return out;
  }

  async compute(tx: TxClient, lines: ResolvedLine[], docDiscount: Prisma.Decimal) {
    const { priceIncludesTax } = await this.settings(tx);
    try {
      return computeInvoice(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount.plus(l.promotionDiscount), taxRate: l.taxRate })), docDiscount, priceIncludesTax);
    } catch (e) { throw Errors.validation((e as Error).message); }
  }
}
