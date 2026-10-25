import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { hasPermission, sepayQrUrl, VIETQR_BANKS } from '@erp/shared';
import { AppError, Errors } from '../../common/errors/app-error';
import { paginated, skipTake } from '../../common/pagination';
import { D, money, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { CTX, RequestUser } from '../../infra/cls/request-context';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { ApplyBankTransactionDto, BankRequestQueryDto, BankTransactionQueryDto, CreateBankRequestDto, SepayConfigDto } from './dto/bank-transfers.dto';
import { CashbookService } from './cashbook.service';
import { PaymentsService } from './payments.service';

const PROVIDER = 'SEPAY';
export const SEPAY_WEBHOOK_PATH = '/api/v1/webhooks/sepay';
const INVOICE_REQUEST_TTL_MS = 7 * 86400_000;

type RequestRow = Prisma.BankTransferRequestGetPayload<object>;
export interface SepayWebhookResult { result: 'matched' | 'unmatched' | 'ignored' | 'duplicate'; transactionId?: string; requestCode?: string; paymentId?: string | null; note?: string | null }

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * Thanh toán chuyển khoản tự động qua SePay (BR-170..BR-176).
 * - Mỗi khoản cần thu có một yêu cầu với mã riêng (tiền tố + 8 số, vd BA12345678) in trong nội dung VietQR.
 * - SePay gọi webhook khi tài khoản nhận tiền; giao dịch được lưu duy nhất theo id SePay (gửi lặp không ghi trùng),
 *   mã thanh toán được tìm trong `code` / `content` / `description` để khớp yêu cầu.
 * - POS: tiền về → yêu cầu PAID, màn bán hàng tự hoàn tất hóa đơn bằng phiếu thu BANK_TRANSFER gắn yêu cầu (usedAmount).
 * - Hóa đơn còn nợ / cọc đơn đặt hàng: tiền về → hệ thống tự lập phiếu thu BANK_TRANSFER phân bổ vào chứng từ.
 * - Giao dịch không khớp được giữ lại (UNMATCHED) để gắn tay vào hóa đơn / đơn / khách hàng hoặc bỏ qua.
 * Thứ tự khóa: yêu cầu (FOR UPDATE) → chứng từ → số dư đối tác → quỹ (như phiếu thu thường).
 */
@Injectable()
export class BankTransfersService {
  private readonly log = new Logger('SePay');
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentsService, private readonly cashbook: CashbookService, private readonly audit: AuditService, private readonly access: AccessService, private readonly cls: ClsService) {}

  // ================================================================ cấu hình
  private configRow(db: TxClient | PrismaService['db'] = this.prisma.db) {
    return db.bankGatewayConfig.findFirst({ where: { provider: PROVIDER }, include: { cashAccount: { select: { id: true, code: true, name: true, type: true, branchId: true } } } });
  }

  async getConfig() {
    const c = await this.configRow();
    const since = new Date(Date.now() - 30 * 86400_000);
    const stats = await this.prisma.db.bankTransaction.groupBy({ by: ['status'], where: { provider: PROVIDER, createdAt: { gte: since } }, _count: { _all: true }, _sum: { amount: true } });
    return {
      provider: PROVIDER, enabled: c?.enabled ?? false, bankCode: c?.bankCode ?? null, accountNumber: c?.accountNumber ?? null, accountName: c?.accountName ?? null,
      cashAccountId: c?.cashAccountId ?? null, cashAccount: c?.cashAccount ?? null, codePrefix: c?.codePrefix ?? 'BA', posTtlMinutes: c?.posTtlMinutes ?? 15,
      hasWebhookKey: !!c?.webhookKeyHash, webhookKeyLast4: c?.webhookKeyLast4 ?? null, webhookPath: SEPAY_WEBHOOK_PATH, lastWebhookAt: c?.lastWebhookAt ?? null,
      ready: !!(c?.enabled && c.bankCode && c.accountNumber),
      stats30d: Object.fromEntries(stats.map((s) => [s.status, { count: s._count._all, amount: D(s._sum.amount ?? 0).toFixed(0) }])),
    };
  }

  /** Trạng thái tối thiểu cho thu ngân: có dùng được QR không, ngân hàng nào (không lộ khóa / quỹ). */
  async status() {
    const c = await this.configRow();
    const ready = !!(c?.enabled && c.bankCode && c.accountNumber);
    return { ready, bankCode: ready ? c!.bankCode : null, bankName: ready ? VIETQR_BANKS.find((b) => b.shortName === c!.bankCode)?.name ?? c!.bankCode : null, posTtlMinutes: c?.posTtlMinutes ?? 15 };
  }

  async saveConfig(user: RequestUser, dto: SepayConfigDto) {
    const existing = await this.configRow();
    const bankCode = dto.bankCode === undefined ? existing?.bankCode ?? null : dto.bankCode;
    if (bankCode && !VIETQR_BANKS.some((b) => b.shortName === bankCode)) throw Errors.validation('Ngân hàng không có trong danh sách hỗ trợ VietQR', { bankCode });
    const accountNumber = dto.accountNumber === undefined ? existing?.accountNumber ?? null : dto.accountNumber;
    const enabled = dto.enabled ?? existing?.enabled ?? false;
    if (enabled && (!bankCode || !accountNumber)) throw Errors.validation('Cần chọn ngân hàng và nhập số tài khoản trước khi bật');
    if (dto.cashAccountId) {
      const acc = await this.prisma.db.cashAccount.findFirst({ where: { id: dto.cashAccountId, isActive: true } });
      if (!acc) throw Errors.notFound('Quỹ tiền', dto.cashAccountId);
      if (acc.type !== 'BANK') throw Errors.validation('Quỹ nhận tiền chuyển khoản phải là tài khoản ngân hàng', { cashAccountId: dto.cashAccountId });
    }
    // bật nhận chuyển khoản mà gian hàng chưa có quỹ ngân hàng nào → tạo quỹ cho đúng tài khoản này,
    // nếu không tiền về sẽ không được ghi vào quỹ nào trong sổ quỹ
    let autoFundId: string | undefined;
    if (enabled && !dto.cashAccountId && !existing?.cashAccountId && bankCode && accountNumber) {
      const sameAccount = await this.prisma.db.cashAccount.findFirst({ where: { type: 'BANK', isActive: true, accountNumber }, orderBy: { createdAt: 'asc' } });
      if (sameAccount) autoFundId = sameAccount.id;
      else if (!(await this.prisma.db.cashAccount.findFirst({ where: { type: 'BANK', isActive: true } }))) {
        const bank = VIETQR_BANKS.find((b) => b.shortName === bankCode);
        const holder = dto.accountName !== undefined ? dto.accountName?.toUpperCase() ?? null : existing?.accountName ?? null;
        const fund = await this.cashbook.createAccount(user, { name: `${bankCode} - ${accountNumber}`.slice(0, 200), type: 'BANK', bankName: bank?.name ?? bankCode, accountNumber, accountHolder: holder ?? undefined, isDefault: true });
        autoFundId = fund.id;
      }
    }
    const data = {
      enabled, bankCode, accountNumber,
      ...(dto.accountName !== undefined ? { accountName: dto.accountName?.toUpperCase() ?? null } : {}),
      ...(dto.cashAccountId !== undefined ? { cashAccountId: dto.cashAccountId } : {}),
      ...(autoFundId ? { cashAccountId: autoFundId } : {}),
      ...(dto.codePrefix ? { codePrefix: dto.codePrefix.toUpperCase() } : {}),
      ...(dto.posTtlMinutes ? { posTtlMinutes: dto.posTtlMinutes } : {}),
    };
    const saved = existing
      ? await this.prisma.db.bankGatewayConfig.update({ where: { id: existing.id }, data })
      : await this.prisma.db.bankGatewayConfig.create({ data: { tenantId: user.tenantId, provider: PROVIDER, ...data } });
    await this.audit.log(this.prisma.db as never, { action: 'sepay.config.save', entityType: 'BankGatewayConfig', entityId: saved.id, after: { enabled, bankCode, accountNumber, codePrefix: saved.codePrefix, cashAccountId: saved.cashAccountId } });
    return this.getConfig();
  }

  /** Sinh khóa webhook mới (chỉ trả về một lần; máy chủ chỉ lưu hash). Khóa cũ hết hiệu lực ngay. */
  async rotateKey(user: RequestUser) {
    const key = `sp_${randomBytes(24).toString('base64url')}`;
    const existing = await this.configRow();
    const data = { webhookKeyHash: hashKey(key), webhookKeyLast4: key.slice(-4) };
    const saved = existing
      ? await this.prisma.db.bankGatewayConfig.update({ where: { id: existing.id }, data })
      : await this.prisma.db.bankGatewayConfig.create({ data: { tenantId: user.tenantId, provider: PROVIDER, ...data } });
    await this.audit.log(this.prisma.db as never, { action: 'sepay.key.rotate', entityType: 'BankGatewayConfig', entityId: saved.id, after: { last4: saved.webhookKeyLast4 } });
    return { apiKey: key, webhookKeyLast4: saved.webhookKeyLast4, webhookPath: SEPAY_WEBHOOK_PATH };
  }

  // ================================================================ yêu cầu thanh toán
  private view(r: RequestRow & { transactions?: Array<Prisma.BankTransactionGetPayload<object>> }) {
    const expired = r.status === 'PENDING' && r.expiresAt.getTime() < Date.now();
    return {
      id: r.id, code: r.code, purpose: r.purpose, status: r.status, expired, branchId: r.branchId, documentId: r.documentId, documentCode: r.documentCode, customerId: r.customerId,
      amount: D(r.amount).toFixed(0), paidAmount: D(r.paidAmount).toFixed(0), usedAmount: D(r.usedAmount).toFixed(0), remaining: Prisma.Decimal.max(D(r.amount).minus(D(r.paidAmount)), ZERO).toFixed(0),
      available: Prisma.Decimal.max(D(r.paidAmount).minus(D(r.usedAmount)), ZERO).toFixed(0),
      bankCode: r.bankCode, bankName: VIETQR_BANKS.find((b) => b.shortName === r.bankCode)?.name ?? r.bankCode, accountNumber: r.accountNumber, accountName: r.accountName,
      transferContent: r.code, qrUrl: sepayQrUrl({ bankCode: r.bankCode, accountNumber: r.accountNumber, amount: D(r.amount).minus(D(r.paidAmount)).greaterThan(0) ? D(r.amount).minus(D(r.paidAmount)).toFixed(0) : D(r.amount).toFixed(0), content: r.code }),
      expiresAt: r.expiresAt, paidAt: r.paidAt, consumedAt: r.consumedAt, cancelledAt: r.cancelledAt, note: r.note, createdAt: r.createdAt,
      transactions: r.transactions?.map((t) => ({ id: t.id, amount: D(t.amount).toFixed(0), referenceCode: t.referenceCode, transactionDate: t.transactionDate, gateway: t.gateway, status: t.status, paymentId: t.paymentId })),
    };
  }

  private async readyConfig() {
    const c = await this.configRow();
    if (!c?.enabled || !c.bankCode || !c.accountNumber) throw Errors.conflict('SEPAY_NOT_CONFIGURED', 'Chưa bật / chưa cấu hình nhận tiền chuyển khoản tự động (Tích hợp → SePay)');
    return c;
  }

  private async newCode(prefix: string) {
    for (let i = 0; i < 8; i++) {
      const code = `${prefix}${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
      if (!(await this.prisma.db.bankTransferRequest.findFirst({ where: { code }, select: { id: true } }))) return code;
    }
    throw Errors.conflict('CODE_EXHAUSTED', 'Không sinh được mã thanh toán, vui lòng thử lại');
  }

  async createRequest(user: RequestUser, dto: CreateBankRequestDto) {
    const cfg = await this.readyConfig();
    let branchId: string; let amount: Prisma.Decimal; let documentId: string | null = null; let documentCode: string | null = null; let customerId: string | null = null;
    if (dto.purpose === 'POS') {
      if (!hasPermission(user.permissions, 'invoice.create')) throw Errors.forbidden('Thiếu quyền: invoice.create');
      if (!dto.branchId) throw Errors.validation('Thiếu chi nhánh');
      if (!dto.amount) throw Errors.validation('Thiếu số tiền');
      this.access.assertBranch(user, dto.branchId);
      branchId = dto.branchId; amount = money(dto.amount);
    } else {
      if (!hasPermission(user.permissions, 'payment.create')) throw Errors.forbidden('Thiếu quyền: payment.create');
      if (!dto.documentId) throw Errors.validation('Thiếu chứng từ');
      let due: Prisma.Decimal;
      if (dto.purpose === 'INVOICE') {
        const inv = await this.prisma.db.invoice.findFirst({ where: { id: dto.documentId } });
        if (!inv) throw Errors.notFound('Hóa đơn', dto.documentId);
        if (inv.status !== 'COMPLETED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ thu chuyển khoản cho hóa đơn đã hoàn thành', { code: inv.code });
        branchId = inv.branchId; documentCode = inv.code; customerId = inv.customerId; due = D(inv.totalAmount).minus(D(inv.paidAmount));
      } else {
        const o = await this.prisma.db.salesOrder.findFirst({ where: { id: dto.documentId } });
        if (!o) throw Errors.notFound('Đơn đặt hàng', dto.documentId);
        if (o.status !== 'DRAFT' && o.status !== 'CONFIRMED') throw Errors.conflict('DOCUMENT_NOT_POSTED', 'Chỉ nhận cọc cho đơn đang xử lý', { code: o.code });
        branchId = o.branchId; documentCode = o.code; customerId = o.customerId; due = D(o.totalAmount).minus(D(o.depositAmount));
      }
      this.access.assertBranch(user, branchId);
      if (!due.greaterThan(0)) throw Errors.conflict('NOTHING_DUE', `${documentCode} không còn khoản phải thu`, { documentCode });
      amount = dto.amount ? money(dto.amount) : due;
      if (amount.greaterThan(due)) throw Errors.conflict('OVERPAYMENT', `${documentCode} chỉ còn phải thu ${due.toFixed(0)}`, { due: due.toFixed(0) });
      documentId = dto.documentId;
      // còn yêu cầu đang chờ cùng chứng từ và số tiền → dùng lại (khách có thể đã chụp QR cũ)
      const open = await this.prisma.db.bankTransferRequest.findFirst({ where: { documentId, status: 'PENDING', amount, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
      if (open) return this.view(open);
    }
    if (!amount.greaterThan(0)) throw Errors.validation('Số tiền phải lớn hơn 0');
    const code = await this.newCode(cfg.codePrefix);
    const ttl = dto.purpose === 'POS' ? cfg.posTtlMinutes * 60_000 : INVOICE_REQUEST_TTL_MS;
    const r = await this.prisma.db.bankTransferRequest.create({
      data: {
        tenantId: user.tenantId, code, purpose: dto.purpose, branchId, documentId, documentCode, customerId, amount, cashAccountId: cfg.cashAccountId,
        bankCode: cfg.bankCode!, accountNumber: cfg.accountNumber!, accountName: cfg.accountName, note: dto.note ?? null, createdById: user.id, expiresAt: new Date(Date.now() + ttl),
      },
    });
    return this.view(r);
  }

  async getRequest(user: RequestUser, id: string) {
    const r = await this.prisma.db.bankTransferRequest.findFirst({ where: { id }, include: { transactions: { orderBy: { transactionDate: 'asc' } } } });
    if (!r) throw Errors.notFound('Yêu cầu thanh toán', id);
    this.access.assertBranch(user, r.branchId);
    return this.view(r);
  }

  async listRequests(user: RequestUser, q: BankRequestQueryDto) {
    const where: Prisma.BankTransferRequestWhereInput = {
      ...this.access.branchWhere(user),
      ...(q.status ? { status: q.status as never } : {}), ...(q.purpose ? { purpose: q.purpose as never } : {}), ...(q.documentId ? { documentId: q.documentId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.bankTransferRequest.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(q) }),
      this.prisma.db.bankTransferRequest.count({ where }),
    ]);
    return paginated(rows.map((r) => this.view(r)), total, q);
  }

  async cancelRequest(user: RequestUser, id: string) {
    return this.prisma.tx(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bank_transfer_requests WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
      const r = await tx.bankTransferRequest.findFirst({ where: { id } });
      if (!r) throw Errors.notFound('Yêu cầu thanh toán', id);
      this.access.assertBranch(user, r.branchId);
      if (r.createdById !== user.id && !hasPermission(user.permissions, 'payment.create')) throw Errors.forbidden();
      if (r.status !== 'PENDING') throw Errors.conflict('REQUEST_NOT_PENDING', 'Đã nhận tiền cho mã này – không hủy được; xử lý hoàn tiền nếu cần', { status: r.status });
      return this.view(await tx.bankTransferRequest.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } }));
    });
  }

  // ================================================================ POS: dùng tiền đã nhận để hoàn tất hóa đơn
  /** Khóa và kiểm tra yêu cầu POS trước khi lập phiếu thu cho hóa đơn (gọi trong giao dịch hoàn tất hóa đơn). */
  async lockPosRequestInTx(tx: TxClient, user: RequestUser, requestId: string, branchId: string, amount: Prisma.Decimal) {
    await tx.$queryRaw`SELECT id FROM bank_transfer_requests WHERE id = ${requestId}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    const r = await tx.bankTransferRequest.findFirst({ where: { id: requestId } });
    if (!r) throw Errors.notFound('Yêu cầu thanh toán', requestId);
    if (r.purpose !== 'POS') throw Errors.validation('Mã thanh toán này không dùng cho bán hàng tại quầy', { code: r.code });
    if (r.branchId !== branchId) throw Errors.validation('Mã thanh toán thuộc chi nhánh khác', { code: r.code });
    const available = D(r.paidAmount).minus(D(r.usedAmount));
    if (!available.greaterThan(0)) throw Errors.conflict('BANK_PAYMENT_NOT_RECEIVED', `Chưa nhận được tiền chuyển khoản cho mã ${r.code}`, { code: r.code, status: r.status });
    if (amount.greaterThan(available)) throw Errors.conflict('BANK_PAYMENT_INSUFFICIENT', `Mã ${r.code} mới nhận ${available.toFixed(0)}`, { code: r.code, available: available.toFixed(0), requested: amount.toFixed(0) });
    return r;
  }

  async markConsumedInTx(tx: TxClient, r: RequestRow, amount: Prisma.Decimal, doc: { id: string; code: string }, paymentId: string) {
    await tx.bankTransferRequest.update({ where: { id: r.id }, data: { usedAmount: D(r.usedAmount).plus(amount), consumedAt: new Date(), documentId: doc.id, documentCode: doc.code } });
    await tx.bankTransaction.updateMany({ where: { requestId: r.id, paymentId: null, status: 'MATCHED' }, data: { paymentId } });
  }

  // ================================================================ webhook SePay
  private extractCode(prefix: string, ...texts: Array<string | null | undefined>) {
    const re = new RegExp(`${prefix}[\\s._-]?(\\d{8})(?!\\d)`, 'i');
    for (const t of texts) {
      if (!t) continue;
      const m = re.exec(String(t));
      if (m) return `${prefix}${m[1]}`;
    }
    return null;
  }

  private parseDate(v: unknown) {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(v.trim())) {
      const d = new Date(`${v.trim().replace(' ', 'T')}+07:00`); // giờ ngân hàng Việt Nam
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  /** Người "thực hiện" phiếu thu do hệ thống lập: người tạo yêu cầu (còn hoạt động) hoặc chủ gian hàng. */
  private async actor(tenantId: string, preferredUserId?: string | null): Promise<RequestUser> {
    const include = { roles: { include: { role: { include: { permissions: true } } } }, branchAccess: { select: { branchId: true } }, warehouseAccess: { select: { warehouseId: true } } } as const;
    let u = preferredUserId ? await this.prisma.raw.user.findFirst({ where: { id: preferredUserId, tenantId, status: 'ACTIVE' }, include }) : null;
    if (!u) u = await this.prisma.raw.user.findFirst({ where: { tenantId, isOwner: true, status: 'ACTIVE' }, include, orderBy: { createdAt: 'asc' } });
    if (!u) throw Errors.conflict('NO_ACTOR', 'Gian hàng không có người dùng hoạt động để ghi phiếu thu');
    const permissions = new Set<string>();
    if (u.isOwner) permissions.add('*');
    for (const ur of u.roles) for (const p of ur.role.permissions) permissions.add(p.permission);
    return { id: u.id, tenantId: u.tenantId, username: u.username, fullName: u.fullName, isOwner: u.isOwner, allBranches: u.allBranches, permissions, branchIds: u.branchAccess.map((b) => b.branchId), warehouseIds: u.warehouseAccess.map((w) => w.warehouseId) };
  }

  /** Lập phiếu thu BANK_TRANSFER cho hóa đơn / đơn đặt hàng / khách hàng (dùng cho webhook và gắn tay). Trả về null khi không thể ghi nhận tự động. */
  private async postToDocument(tx: TxClient, actor: RequestUser, p: { target: 'INVOICE' | 'SALES_ORDER' | 'CUSTOMER'; documentId?: string | null; customerId?: string | null; amount: Prisma.Decimal; branchId?: string | null; cashAccountId: string | null; reference: string; note: string }) {
    let branchId = p.branchId ?? null; let customerId = p.customerId ?? null; let due = ZERO; let docCode = '';
    let allocType: 'INVOICE' | 'SALES_ORDER' | null = null;
    if (p.target === 'INVOICE') {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${p.documentId}::uuid AND tenant_id = ${actor.tenantId}::uuid FOR UPDATE`;
      const inv = await tx.invoice.findFirst({ where: { id: p.documentId! } });
      if (!inv) return { error: 'Hóa đơn không tồn tại' };
      branchId = inv.branchId; customerId = inv.customerId; docCode = inv.code;
      if (inv.status === 'COMPLETED') { due = D(inv.totalAmount).minus(D(inv.paidAmount)); allocType = 'INVOICE'; }
    } else if (p.target === 'SALES_ORDER') {
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${p.documentId}::uuid AND tenant_id = ${actor.tenantId}::uuid FOR UPDATE`;
      const o = await tx.salesOrder.findFirst({ where: { id: p.documentId! } });
      if (!o) return { error: 'Đơn đặt hàng không tồn tại' };
      branchId = o.branchId; customerId = o.customerId; docCode = o.code;
      if (o.status === 'DRAFT' || o.status === 'CONFIRMED') { due = D(o.totalAmount).minus(D(o.depositAmount)); allocType = 'SALES_ORDER'; }
    } else {
      const c = await tx.customer.findFirst({ where: { id: p.customerId! } });
      if (!c) return { error: 'Khách hàng không tồn tại' };
      docCode = c.code;
    }
    if (!branchId) {
      const b = await tx.branch.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
      if (!b) return { error: 'Không có chi nhánh hoạt động' };
      branchId = b.id;
    }
    const alloc = allocType && due.greaterThan(0) ? Prisma.Decimal.min(due, p.amount) : ZERO;
    if (!customerId && !alloc.greaterThan(0)) return { error: `${docCode} không còn khoản phải thu (khách lẻ) – cần xử lý tay` };
    // khách lẻ: chỉ ghi đúng phần còn phải thu; khách có tên: phần thừa thành tiền trả trước / trừ nợ
    const amount = customerId ? p.amount : alloc;
    const payment = await this.payments.createInTx(tx, actor, {
      branchId, direction: 'IN', method: 'BANK_TRANSFER', partyType: customerId ? 'CUSTOMER' : null, partyId: customerId, amount,
      reference: p.reference.slice(0, 200), note: p.note.slice(0, 1000), cashAccountId: p.cashAccountId,
      allocations: alloc.greaterThan(0) ? [{ documentType: allocType!, documentId: p.documentId!, amount: alloc }] : [], permissionChecked: true,
    });
    const extra = p.amount.minus(amount);
    return { payment, docCode, note: extra.greaterThan(0) ? `Khách chuyển thừa ${extra.toFixed(0)} (khách lẻ) – cần hoàn / xử lý tay` : !alloc.equals(p.amount) && customerId ? `Phần vượt ${p.amount.minus(alloc).toFixed(0)} ghi có cho khách hàng` : null };
  }

  async handleSepayWebhook(authorization: string | undefined, body: Record<string, unknown>): Promise<SepayWebhookResult> {
    const m = /^\s*apikey\s+(\S+)\s*$/i.exec(authorization ?? '');
    if (!m) throw new AppError('UNAUTHORIZED', 'Thiếu khóa API (Authorization: Apikey …)', HttpStatus.UNAUTHORIZED);
    const cfg = await this.prisma.raw.bankGatewayConfig.findFirst({ where: { webhookKeyHash: hashKey(m[1]) } });
    if (!cfg) throw new AppError('UNAUTHORIZED', 'Khóa API không hợp lệ', HttpStatus.UNAUTHORIZED);
    const externalId = body?.id !== undefined && body?.id !== null ? String(body.id).slice(0, 64) : '';
    const rawAmount = Number(body?.transferAmount);
    if (!externalId || !Number.isFinite(rawAmount)) throw Errors.validation('Thiếu id / transferAmount');

    // ngữ cảnh gian hàng cho các truy vấn có phạm vi tenant
    this.cls.set(CTX.tenantId, cfg.tenantId);
    const str = (v: unknown, n: number) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, n));
    const base = {
      tenantId: cfg.tenantId, provider: PROVIDER, externalId, gateway: str(body.gateway, 60), accountNumber: str(body.accountNumber, 40), subAccount: str(body.subAccount, 40),
      transferType: (str(body.transferType, 5) ?? 'in').toLowerCase(), amount: money(String(Math.abs(rawAmount))),
      accumulated: body.accumulated !== undefined && body.accumulated !== null && Number.isFinite(Number(body.accumulated)) ? money(String(body.accumulated)) : null,
      content: str(body.content, 1000), code: str(body.code, 60), referenceCode: str(body.referenceCode, 120), description: str(body.description, 1000),
      transactionDate: this.parseDate(body.transactionDate), raw: body as Prisma.InputJsonValue,
    };

    try {
      const res = await this.prisma.tx(async (tx) => {
        if (await tx.bankTransaction.findFirst({ where: { provider: PROVIDER, externalId }, select: { id: true } })) return { result: 'duplicate' as const };
        const ignore = base.transferType !== 'in' ? 'Giao dịch tiền ra' : !base.amount.greaterThan(0) ? 'Số tiền bằng 0'
          : cfg.accountNumber && base.accountNumber && base.accountNumber !== cfg.accountNumber && base.subAccount !== cfg.accountNumber ? `Tài khoản ${base.accountNumber} khác tài khoản đã cấu hình` : null;
        if (!cfg.enabled || ignore) {
          const t = await tx.bankTransaction.create({ data: { ...base, status: 'IGNORED', matchNote: ignore ?? 'Chưa bật nhận tiền tự động' } });
          return { result: 'ignored' as const, transactionId: t.id, note: t.matchNote };
        }
        const code = this.extractCode(cfg.codePrefix, base.code, base.content, base.description);
        const unmatched = async (note: string, requestId: string | null = null) => {
          const t = await tx.bankTransaction.create({ data: { ...base, status: 'UNMATCHED', matchNote: note, requestId } });
          return { result: 'unmatched' as const, transactionId: t.id, requestCode: code ?? undefined, note };
        };
        if (!code) return unmatched('Không thấy mã thanh toán trong nội dung chuyển khoản');
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bank_transfer_requests WHERE tenant_id = ${cfg.tenantId}::uuid AND code = ${code} FOR UPDATE`;
        const r = locked[0] ? await tx.bankTransferRequest.findFirst({ where: { id: locked[0].id } }) : null;
        if (!r) return unmatched(`Mã ${code} không tồn tại`);
        if (r.status === 'CANCELLED') return unmatched(`Mã ${code} đã hủy`, r.id);
        // mã tại quầy đã dùng để hoàn tất hóa đơn → tiền chuyển muộn / lặp không tự gắn, đưa vào danh sách chờ xử lý
        if (r.purpose === 'POS' && r.consumedAt) return unmatched(`Mã ${code} đã dùng cho hóa đơn ${r.documentCode ?? ''} – tiền về sau khi đã bán xong`, r.id);

        let paymentId: string | null = null; let note: string | null = null;
        if (r.purpose !== 'POS') {
          const actor = await this.actor(cfg.tenantId, r.createdById);
          this.cls.set(CTX.user, actor);
          const posted = await this.postToDocument(tx, actor, {
            target: r.purpose === 'INVOICE' ? 'INVOICE' : 'SALES_ORDER', documentId: r.documentId, amount: base.amount, branchId: r.branchId, cashAccountId: r.cashAccountId,
            reference: base.referenceCode ? `SePay ${base.referenceCode}` : `SePay #${externalId}`, note: `Chuyển khoản ${code} – ${r.documentCode ?? ''} (tự động qua SePay)`,
          });
          if ('error' in posted) return unmatched(`${posted.error}`, r.id);
          paymentId = posted.payment.id; note = posted.note;
        }
        const paid = D(r.paidAmount).plus(base.amount);
        await tx.bankTransferRequest.update({
          where: { id: r.id },
          data: {
            paidAmount: paid, status: paid.greaterThanOrEqualTo(D(r.amount)) ? 'PAID' : 'PARTIAL', paidAt: r.paidAt ?? new Date(),
            ...(paymentId ? { usedAmount: D(r.usedAmount).plus(base.amount), consumedAt: new Date() } : {}),
          },
        });
        const t = await tx.bankTransaction.create({ data: { ...base, status: 'MATCHED', requestId: r.id, paymentId, matchNote: note } });
        await this.audit.log(tx, { action: 'sepay.transaction.matched', entityType: 'BankTransaction', entityId: t.id, entityCode: code, after: { amount: base.amount.toFixed(0), requestId: r.id, paymentId } });
        return { result: 'matched' as const, transactionId: t.id, requestCode: code, paymentId, note };
      });
      await this.prisma.raw.bankGatewayConfig.update({ where: { id: cfg.id }, data: { lastWebhookAt: new Date() } });
      return res;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { result: 'duplicate' };
      const transient = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || (e.code === 'P2010' && /40P01|40001/.test(JSON.stringify(e.meta ?? {}))));
      if (transient) throw e; // để SePay gửi lại
      this.log.error(`Webhook SePay #${externalId} lỗi: ${(e as Error).message}`);
      // vẫn lưu giao dịch để không mất dấu tiền về; xử lý tay ở màn "Giao dịch chuyển khoản"
      const existing = await this.prisma.raw.bankTransaction.findFirst({ where: { tenantId: cfg.tenantId, provider: PROVIDER, externalId } });
      if (existing) return { result: 'duplicate' };
      const t = await this.prisma.raw.bankTransaction.create({ data: { ...base, status: 'UNMATCHED', matchNote: `Lỗi xử lý tự động: ${(e as Error).message}`.slice(0, 500) } });
      return { result: 'unmatched', transactionId: t.id, note: t.matchNote };
    }
  }

  // ================================================================ giao dịch chuyển khoản
  async listTransactions(user: RequestUser, q: BankTransactionQueryDto) {
    const where: Prisma.BankTransactionWhereInput = {
      provider: PROVIDER, ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ content: { contains: q.search, mode: 'insensitive' } }, { referenceCode: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total, unmatched] = await Promise.all([
      this.prisma.db.bankTransaction.findMany({ where, orderBy: { transactionDate: 'desc' }, include: { request: { select: { id: true, code: true, purpose: true, documentCode: true, status: true } } }, ...skipTake(q) }),
      this.prisma.db.bankTransaction.count({ where }),
      this.prisma.db.bankTransaction.count({ where: { provider: PROVIDER, status: 'UNMATCHED' } }),
    ]);
    const paymentIds = rows.map((r) => r.paymentId).filter((x): x is string => !!x);
    const payments = paymentIds.length ? await this.prisma.db.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, code: true, status: true } }) : [];
    const pm = new Map(payments.map((p) => [p.id, p]));
    return {
      ...paginated(rows.map((r) => ({
        id: r.id, externalId: r.externalId, gateway: r.gateway, accountNumber: r.accountNumber, transferType: r.transferType, amount: D(r.amount).toFixed(0), content: r.content, code: r.code,
        referenceCode: r.referenceCode, transactionDate: r.transactionDate, status: r.status, matchNote: r.matchNote, request: r.request, payment: r.paymentId ? pm.get(r.paymentId) ?? { id: r.paymentId } : null, handledAt: r.handledAt, createdAt: r.createdAt,
      })), total, q),
      unmatchedCount: unmatched,
    };
  }

  private async lockTransaction(tx: TxClient, user: RequestUser, id: string) {
    await tx.$queryRaw`SELECT id FROM bank_transactions WHERE id = ${id}::uuid AND tenant_id = ${user.tenantId}::uuid FOR UPDATE`;
    const t = await tx.bankTransaction.findFirst({ where: { id } });
    if (!t) throw Errors.notFound('Giao dịch chuyển khoản', id);
    if (t.status !== 'UNMATCHED') throw Errors.conflict('TRANSACTION_HANDLED', 'Giao dịch đã được xử lý', { status: t.status });
    if (t.transferType !== 'in') throw Errors.validation('Chỉ ghi nhận giao dịch tiền vào');
    return t;
  }

  /** Gắn tay một giao dịch chưa khớp vào hóa đơn / đơn đặt hàng / khách hàng → lập phiếu thu chuyển khoản. */
  async applyTransaction(user: RequestUser, id: string, dto: ApplyBankTransactionDto) {
    if (!hasPermission(user.permissions, 'payment.create')) throw Errors.forbidden('Thiếu quyền: payment.create');
    if (dto.target === 'CUSTOMER' ? !dto.customerId : !dto.documentId) throw Errors.validation(dto.target === 'CUSTOMER' ? 'Thiếu khách hàng' : 'Thiếu chứng từ');
    const cfg = await this.configRow();
    return this.prisma.tx(async (tx) => {
      const t = await this.lockTransaction(tx, user, id);
      const posted = await this.postToDocument(tx, user, {
        target: dto.target, documentId: dto.documentId, customerId: dto.customerId, amount: D(t.amount), cashAccountId: cfg?.cashAccountId ?? null,
        reference: t.referenceCode ? `SePay ${t.referenceCode}` : `SePay #${t.externalId}`, note: dto.note ?? `Chuyển khoản: ${t.content ?? ''}`,
      });
      if ('error' in posted) throw Errors.conflict('CANNOT_APPLY', posted.error ?? 'Không ghi nhận được');
      this.access.assertBranch(user, posted.payment.branchId);
      const updated = await tx.bankTransaction.update({ where: { id }, data: { status: 'APPLIED', paymentId: posted.payment.id, handledById: user.id, handledAt: new Date(), matchNote: [t.matchNote, `Gắn tay vào ${posted.docCode}`, posted.note].filter(Boolean).join(' · ').slice(0, 500) } });
      await this.audit.log(tx, { action: 'sepay.transaction.apply', entityType: 'BankTransaction', entityId: id, after: { target: dto.target, documentId: dto.documentId, customerId: dto.customerId, paymentId: posted.payment.id } });
      return { id: updated.id, status: updated.status, paymentId: posted.payment.id, paymentCode: posted.payment.code, note: updated.matchNote };
    });
  }

  async ignoreTransaction(user: RequestUser, id: string, note?: string) {
    if (!hasPermission(user.permissions, 'payment.create')) throw Errors.forbidden('Thiếu quyền: payment.create');
    return this.prisma.tx(async (tx) => {
      const t = await this.lockTransaction(tx, user, id);
      const updated = await tx.bankTransaction.update({ where: { id }, data: { status: 'IGNORED', handledById: user.id, handledAt: new Date(), matchNote: [t.matchNote, note ? `Bỏ qua: ${note}` : 'Bỏ qua'].filter(Boolean).join(' · ').slice(0, 500) } });
      await this.audit.log(tx, { action: 'sepay.transaction.ignore', entityType: 'BankTransaction', entityId: id, after: { note } });
      return { id: updated.id, status: updated.status, note: updated.matchNote };
    });
  }
}
