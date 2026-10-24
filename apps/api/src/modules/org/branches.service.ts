import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors/app-error';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PlanService } from '../platform/plan.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateBranchDto, CreateWarehouseDto, UpdateBranchDto, UpdateWarehouseDto } from './dto/org.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly access: AccessService, private readonly plans: PlanService) {}

  listBranches(user: RequestUser, includeInactive = false) {
    return this.prisma.db.branch.findMany({
      where: { ...(includeInactive ? {} : { isActive: true }), ...(user.isOwner || user.allBranches ? {} : { id: { in: user.branchIds } }) },
      include: { _count: { select: { warehouses: true } } },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createBranch(user: RequestUser, dto: CreateBranchDto) {
    const dup = await this.prisma.db.branch.findFirst({ where: { code: dto.code } });
    if (dup) throw Errors.duplicate('DUPLICATE_CODE', 'Mã chi nhánh đã tồn tại', { code: dto.code });
    return this.prisma.tx(async (tx) => {
      await this.plans.assertLimit(tx, user.tenantId, 'branches');
      const branch = await tx.branch.create({ data: { tenantId: user.tenantId, code: dto.code, name: dto.name, address: dto.address, phone: dto.phone, email: dto.email } });
      if (dto.createDefaultWarehouse !== false) {
        await tx.warehouse.create({ data: { tenantId: user.tenantId, branchId: branch.id, code: `KHO-${dto.code}`, name: `Kho ${dto.name}`, isDefault: true } });
      }
      // every branch gets its own cash drawer fund (Module 08)
      const qt = await tx.cashAccount.count({ where: { branchId: branch.id, type: 'CASH' } });
      if (qt === 0) await tx.cashAccount.create({ data: { tenantId: user.tenantId, branchId: branch.id, code: `QT-${dto.code}`, name: `Két tiền mặt - ${dto.name}`, type: 'CASH', isDefault: true } });
      await this.audit.log(tx, { action: 'branch.create', entityType: 'Branch', entityId: branch.id, entityCode: branch.code, after: branch });
      return tx.branch.findFirstOrThrow({ where: { id: branch.id }, include: { warehouses: true } });
    });
  }

  async updateBranch(user: RequestUser, id: string, dto: UpdateBranchDto) {
    const before = await this.prisma.db.branch.findFirst({ where: { id } });
    if (!before) throw Errors.notFound('Chi nhánh', id);
    if (dto.isActive === false && before.isDefault) throw Errors.conflict('BRANCH_DEFAULT', 'Không thể ngừng hoạt động chi nhánh mặc định');
    return this.prisma.tx(async (tx) => {
      if (dto.isDefault) await tx.branch.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const after = await tx.branch.update({ where: { id }, data: dto });
      await this.audit.log(tx, { action: 'branch.update', entityType: 'Branch', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }

  async listWarehouses(user: RequestUser, branchId?: string, includeInactive = false, scope: 'mine' | 'all' = 'mine') {
    // scope=all: every active warehouse of the tenant (transfer destinations, BR-80) — read-only listing, no access widening for writes
    const whWhere = scope === 'all' ? {} : await this.access.warehouseWhere(user);
    return this.prisma.db.warehouse.findMany({
      where: { ...(includeInactive ? {} : { isActive: true }), ...(branchId ? { branchId } : {}), ...(scope === 'all' ? {} : this.access.branchWhere(user)), ...(whWhere.warehouseId ? { id: whWhere.warehouseId } : {}) },
      include: { branch: { select: { id: true, name: true, code: true } } },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createWarehouse(user: RequestUser, dto: CreateWarehouseDto) {
    const branch = await this.prisma.db.branch.findFirst({ where: { id: dto.branchId } });
    if (!branch) throw Errors.notFound('Chi nhánh', dto.branchId);
    const dup = await this.prisma.db.warehouse.findFirst({ where: { code: dto.code } });
    if (dup) throw Errors.duplicate('DUPLICATE_CODE', 'Mã kho đã tồn tại', { code: dto.code });
    return this.prisma.tx(async (tx) => {
      await this.plans.assertLimit(tx, user.tenantId, 'warehouses');
      const count = await tx.warehouse.count({ where: { branchId: dto.branchId } });
      const wh = await tx.warehouse.create({ data: { tenantId: user.tenantId, branchId: dto.branchId, code: dto.code, name: dto.name, address: dto.address, isDefault: count === 0 } });
      await this.audit.log(tx, { action: 'warehouse.create', entityType: 'Warehouse', entityId: wh.id, entityCode: wh.code, after: wh });
      return wh;
    });
  }

  async updateWarehouse(user: RequestUser, id: string, dto: UpdateWarehouseDto) {
    const before = await this.prisma.db.warehouse.findFirst({ where: { id } });
    if (!before) throw Errors.notFound('Kho', id);
    if (dto.isActive === false) {
      const stock = await this.prisma.db.stockBalance.count({ where: { warehouseId: id, onHand: { not: 0 } } });
      if (stock > 0) throw Errors.conflict('WAREHOUSE_HAS_STOCK', 'Kho còn tồn hàng, không thể ngừng hoạt động', { skuWithStock: stock });
      if (before.isDefault) throw Errors.conflict('WAREHOUSE_DEFAULT', 'Không thể ngừng hoạt động kho mặc định');
    }
    return this.prisma.tx(async (tx) => {
      if (dto.isDefault) await tx.warehouse.updateMany({ where: { branchId: before.branchId, isDefault: true }, data: { isDefault: false } });
      const after = await tx.warehouse.update({ where: { id }, data: dto });
      await this.audit.log(tx, { action: 'warehouse.update', entityType: 'Warehouse', entityId: id, entityCode: after.code, before, after });
      return after;
    });
  }
}
