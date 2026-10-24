import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../cls/request-context';
import { DbClient, PrismaService } from '../prisma/prisma.service';

/** Branch/warehouse scoping (BR-03). */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  canAccessBranch(user: RequestUser, branchId: string): boolean {
    if (user.isOwner || user.allBranches) return true;
    return user.branchIds.includes(branchId);
  }

  assertBranch(user: RequestUser, branchId: string): void {
    if (!this.canAccessBranch(user, branchId)) throw Errors.branchAccessDenied(branchId);
  }

  /** Verifies the warehouse exists in tenant, belongs to the branch (if given) and the user may use it. */
  async assertWarehouse(user: RequestUser, warehouseId: string, branchId?: string, db: DbClient = this.prisma.db) {
    const wh = await db.warehouse.findFirst({ where: { id: warehouseId }, select: { id: true, branchId: true, isActive: true } });
    if (!wh) throw Errors.notFound('Kho', warehouseId);
    if (branchId && wh.branchId !== branchId) throw Errors.validation('Kho không thuộc chi nhánh đã chọn', { warehouseId, branchId });
    this.assertBranch(user, wh.branchId);
    if (!user.isOwner && user.warehouseIds.length > 0 && !user.warehouseIds.includes(warehouseId)) throw Errors.warehouseAccessDenied(warehouseId);
    return wh;
  }

  /** Prisma where-fragment restricting rows to accessible branches. */
  branchWhere(user: RequestUser): { branchId?: { in: string[] } } {
    if (user.isOwner || user.allBranches) return {};
    return { branchId: { in: user.branchIds } };
  }

  /** Prisma where-fragment restricting rows to accessible warehouses. */
  async warehouseWhere(user: RequestUser): Promise<{ warehouseId?: { in: string[] } }> {
    if (user.isOwner) return {};
    if (user.warehouseIds.length > 0) return { warehouseId: { in: user.warehouseIds } };
    if (user.allBranches) return {};
    const whs = await this.prisma.db.warehouse.findMany({ where: { branchId: { in: user.branchIds } }, select: { id: true } });
    return { warehouseId: { in: whs.map((w) => w.id) } };
  }
}
