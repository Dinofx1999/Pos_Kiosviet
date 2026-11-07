import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { D, money } from '../../common/utils/decimal';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FlashSaleQueryDto, SaveFlashSaleDto } from './dto/online.dto';

export type FlashSaleState = 'RUNNING' | 'UPCOMING' | 'ENDED' | 'OFF';

export function flashSaleState(fs: { isActive: boolean; startsAt: Date; endsAt: Date }, now = new Date()): FlashSaleState {
  if (!fs.isActive) return 'OFF';
  if (fs.endsAt <= now) return 'ENDED';
  if (fs.startsAt > now) return 'UPCOMING';
  return 'RUNNING';
}

const itemInclude = {
  variant: { select: { id: true, sku: true, name: true, sellPrice: true, imageUrl: true, isActive: true, product: { select: { id: true, code: true, name: true, imageUrl: true, isActive: true } } } },
} satisfies Prisma.FlashSaleItemInclude;

/** Chương trình Flash Sale cho web bán hàng (BR-181..BR-183). */
@Injectable()
export class FlashSalesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(q: FlashSaleQueryDto) {
    const now = new Date();
    const where: Prisma.FlashSaleWhereInput =
      q.state === 'OFF' ? { isActive: false }
        : q.state === 'ENDED' ? { isActive: true, endsAt: { lte: now } }
          : q.state === 'UPCOMING' ? { isActive: true, startsAt: { gt: now } }
            : q.state === 'RUNNING' ? { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } } : {};
    const rows = await this.prisma.db.flashSale.findMany({ where, orderBy: [{ startsAt: 'desc' }], take: 200, include: { items: { select: { soldQuantity: true, quantityLimit: true } } } });
    return rows.map(({ items, ...fs }) => ({
      ...fs, state: flashSaleState(fs, now), itemCount: items.length,
      soldQuantity: items.reduce((s, i) => s + i.soldQuantity, 0),
      quantityLimit: items.some((i) => i.quantityLimit === null) ? null : items.reduce((s, i) => s + (i.quantityLimit ?? 0), 0),
    }));
  }

  async get(id: string) {
    const fs = await this.prisma.db.flashSale.findFirst({ where: { id }, include: { items: { orderBy: { sortOrder: 'asc' }, include: itemInclude } } });
    if (!fs) throw Errors.notFound('Chương trình Flash Sale', id);
    return { ...fs, state: flashSaleState(fs) };
  }

  async create(user: RequestUser, dto: SaveFlashSaleDto) {
    const { startsAt, endsAt, items } = await this.validate(dto);
    const id = await this.prisma.tx(async (tx) => {
      const fs = await tx.flashSale.create({
        data: {
          tenantId: user.tenantId, name: dto.name, startsAt, endsAt, isActive: dto.isActive ?? true, note: dto.note ?? null, createdById: user.id,
          items: { create: items.map((i, idx) => ({ tenantId: user.tenantId, variantId: i.variantId, salePrice: i.salePrice, quantityLimit: i.quantityLimit, perOrderLimit: i.perOrderLimit, sortOrder: idx })) },
        },
      });
      await this.audit.log(tx, { action: 'flashsale.create', entityType: 'FlashSale', entityId: fs.id, entityCode: dto.name, after: { startsAt, endsAt, items: items.length, isActive: fs.isActive } });
      return fs.id;
    });
    return this.get(id);
  }

  /** Sửa chương trình: hàng giữ lại được giữ nguyên số suất đã bán; hàng bị bỏ thì xóa. */
  async update(user: RequestUser, id: string, dto: SaveFlashSaleDto) {
    const { startsAt, endsAt, items } = await this.validate(dto);
    await this.prisma.tx(async (tx) => {
      const fs = await tx.flashSale.findFirst({ where: { id }, include: { items: true } });
      if (!fs) throw Errors.notFound('Chương trình Flash Sale', id);
      const keep = new Set(items.map((i) => i.variantId));
      const removed = fs.items.filter((i) => !keep.has(i.variantId));
      if (removed.length) await tx.flashSaleItem.deleteMany({ where: { id: { in: removed.map((i) => i.id) } } });
      const existing = new Map(fs.items.map((i) => [i.variantId, i]));
      for (const [idx, i] of items.entries()) {
        const prev = existing.get(i.variantId);
        if (prev) {
          if (i.quantityLimit !== null && i.quantityLimit < prev.soldQuantity) throw Errors.validation(`Số suất của hàng thứ ${idx + 1} thấp hơn số đã bán (${prev.soldQuantity})`);
          await tx.flashSaleItem.update({ where: { id: prev.id }, data: { salePrice: i.salePrice, quantityLimit: i.quantityLimit, perOrderLimit: i.perOrderLimit, sortOrder: idx } });
        } else {
          await tx.flashSaleItem.create({ data: { tenantId: user.tenantId, flashSaleId: id, variantId: i.variantId, salePrice: i.salePrice, quantityLimit: i.quantityLimit, perOrderLimit: i.perOrderLimit, sortOrder: idx } });
        }
      }
      await tx.flashSale.update({ where: { id }, data: { name: dto.name, startsAt, endsAt, isActive: dto.isActive ?? fs.isActive, note: dto.note ?? null } });
      await this.audit.log(tx, { action: 'flashsale.update', entityType: 'FlashSale', entityId: id, entityCode: dto.name, before: { startsAt: fs.startsAt, endsAt: fs.endsAt, items: fs.items.length, isActive: fs.isActive }, after: { startsAt, endsAt, items: items.length, isActive: dto.isActive ?? fs.isActive } });
    });
    return this.get(id);
  }

  async setActive(id: string, isActive: boolean) {
    await this.prisma.tx(async (tx) => {
      const fs = await tx.flashSale.findFirst({ where: { id } });
      if (!fs) throw Errors.notFound('Chương trình Flash Sale', id);
      await tx.flashSale.update({ where: { id }, data: { isActive } });
      await this.audit.log(tx, { action: isActive ? 'flashsale.on' : 'flashsale.off', entityType: 'FlashSale', entityId: id, entityCode: fs.name, before: { isActive: fs.isActive }, after: { isActive } });
    });
    return this.get(id);
  }

  async remove(id: string) {
    await this.prisma.tx(async (tx) => {
      const fs = await tx.flashSale.findFirst({ where: { id } });
      if (!fs) throw Errors.notFound('Chương trình Flash Sale', id);
      await tx.flashSale.delete({ where: { id } });
      await this.audit.log(tx, { action: 'flashsale.delete', entityType: 'FlashSale', entityId: id, entityCode: fs.name });
    });
  }

  /** BR-182: thời gian hợp lệ, không trùng hàng, giá Flash Sale thấp hơn giá bán, tối đa mỗi đơn ≤ số suất. */
  private async validate(dto: SaveFlashSaleDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!(endsAt > startsAt)) throw Errors.validation('Thời gian kết thúc phải sau thời gian bắt đầu');
    if (endsAt.getTime() - startsAt.getTime() > 366 * 86400000) throw Errors.validation('Một chương trình Flash Sale tối đa 1 năm');
    const ids = dto.items.map((i) => i.variantId);
    if (new Set(ids).size !== ids.length) throw Errors.validation('Một hàng hóa chỉ được thêm 1 lần vào chương trình');
    const variants = await this.prisma.db.productVariant.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { product: { select: { name: true, type: true, trackBatch: true, deletedAt: true } } } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const items = dto.items.map((i, idx) => {
      const v = byId.get(i.variantId);
      if (!v || v.product.deletedAt) throw Errors.validation(`Hàng thứ ${idx + 1}: hàng hóa không tồn tại`, { variantId: i.variantId });
      if (v.product.type === 'SERVICE') throw Errors.validation(`${v.name}: dịch vụ không bán trên web`);
      if (v.product.trackBatch) throw Errors.validation(`${v.name}: hàng quản lý theo lô chưa bán được trên web`);
      const salePrice = money(i.salePrice);
      if (!salePrice.lessThan(D(v.sellPrice))) throw Errors.validation(`${v.name}: giá Flash Sale phải thấp hơn giá bán ${D(v.sellPrice).toFixed(0)}`, { variantId: v.id });
      const quantityLimit = i.quantityLimit ?? null;
      const perOrderLimit = i.perOrderLimit ?? null;
      if (quantityLimit !== null && perOrderLimit !== null && perOrderLimit > quantityLimit) throw Errors.validation(`${v.name}: tối đa mỗi đơn lớn hơn số suất`);
      return { variantId: v.id, salePrice, quantityLimit, perOrderLimit };
    });
    return { startsAt, endsAt, items };
  }
}
