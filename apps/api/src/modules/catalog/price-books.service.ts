import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors/app-error';
import { D, qty as toQty } from '../../common/utils/decimal';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreatePriceBookDto, PriceBookItemInputDto, UpdatePriceBookDto } from './dto/catalog.dto';

@Injectable()
export class PriceBooksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  list() {
    return this.prisma.db.priceBook.findMany({ include: { branches: { select: { branchId: true } }, _count: { select: { items: true } } }, orderBy: [{ priority: 'desc' }, { name: 'asc' }] });
  }

  async get(id: string) {
    const pb = await this.prisma.db.priceBook.findFirst({ where: { id }, include: { branches: { select: { branchId: true } }, items: { include: { variant: { select: { id: true, sku: true, name: true, sellPrice: true } } }, orderBy: { variant: { name: 'asc' } } } } });
    if (!pb) throw Errors.notFound('Bảng giá', id);
    return pb;
  }

  private async assertBranches(branchIds?: string[]) {
    if (!branchIds?.length) return;
    const n = await this.prisma.db.branch.count({ where: { id: { in: branchIds } } });
    if (n !== new Set(branchIds).size) throw Errors.validation('Chi nhánh không hợp lệ', { branchIds });
  }

  async create(user: RequestUser, dto: CreatePriceBookDto) {
    const dup = await this.prisma.db.priceBook.findFirst({ where: { code: dto.code } });
    if (dup) throw Errors.duplicate('DUPLICATE_CODE', 'Mã bảng giá đã tồn tại', { code: dto.code });
    await this.assertBranches(dto.branchIds);
    return this.prisma.tx(async (tx) => {
      const pb = await tx.priceBook.create({ data: { tenantId: user.tenantId, code: dto.code, name: dto.name, priority: dto.priority ?? 0, customerGroups: dto.customerGroups ?? [], startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null, branches: { create: (dto.branchIds ?? []).map((branchId) => ({ branchId })) } } });
      await this.audit.log(tx, { action: 'pricebook.create', entityType: 'PriceBook', entityId: pb.id, entityCode: pb.code, after: pb });
      return pb;
    });
  }

  async update(user: RequestUser, id: string, dto: UpdatePriceBookDto) {
    const before = await this.prisma.db.priceBook.findFirst({ where: { id } });
    if (!before) throw Errors.notFound('Bảng giá', id);
    await this.assertBranches(dto.branchIds);
    return this.prisma.tx(async (tx) => {
      const after = await tx.priceBook.update({ where: { id }, data: { name: dto.name, status: dto.status, priority: dto.priority, customerGroups: dto.customerGroups, startsAt: dto.startsAt === undefined ? undefined : dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt === undefined ? undefined : dto.endsAt ? new Date(dto.endsAt) : null, ...(dto.branchIds ? { branches: { deleteMany: {}, create: dto.branchIds.map((branchId) => ({ branchId })) } } : {}) } });
      await this.audit.log(tx, { action: 'pricebook.update', entityType: 'PriceBook', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }

  async setItems(user: RequestUser, id: string, items: PriceBookItemInputDto[]) {
    const pb = await this.prisma.db.priceBook.findFirst({ where: { id } });
    if (!pb) throw Errors.notFound('Bảng giá', id);
    const ids = Array.from(new Set(items.map((i) => i.variantId)));
    const n = await this.prisma.db.productVariant.count({ where: { id: { in: ids }, deletedAt: null } });
    if (n !== ids.length) throw Errors.validation('Có biến thể không hợp lệ trong bảng giá');
    await this.prisma.tx(async (tx) => {
      await tx.priceBookItem.deleteMany({ where: { priceBookId: id } });
      await tx.priceBookItem.createMany({ data: items.map((i) => ({ priceBookId: id, variantId: i.variantId, price: D(i.price), minQuantity: toQty(i.minQuantity ?? 1) })) });
      await this.audit.log(tx, { action: 'pricebook.items.set', entityType: 'PriceBook', entityId: id, entityCode: pb.code, after: { items: items.length } });
    });
    return this.get(id);
  }
}
