import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors/app-error';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateCategoryDto, NameDto, UpdateCategoryDto } from './dto/catalog.dto';

/** Categories (tree), brands, units. */
@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ---------------- categories
  async categoryTree() {
    const rows = await this.prisma.db.productCategory.findMany({ include: { _count: { select: { products: { where: { deletedAt: null } } } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    type Node = (typeof rows)[number] & { children: Node[]; productCount: number };
    const map = new Map<string, Node>(rows.map((r) => [r.id, { ...r, children: [], productCount: r._count.products }]));
    const roots: Node[] = [];
    for (const n of map.values()) {
      if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(n);
      else roots.push(n);
    }
    return roots;
  }

  async createCategory(user: RequestUser, dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.prisma.db.productCategory.findFirst({ where: { id: dto.parentId } });
      if (!parent) throw Errors.notFound('Nhóm hàng cha', dto.parentId);
    }
    return this.prisma.tx(async (tx) => {
      const cat = await tx.productCategory.create({ data: { tenantId: user.tenantId, name: dto.name, parentId: dto.parentId, sortOrder: dto.sortOrder ?? 0 } });
      await this.audit.log(tx, { action: 'category.create', entityType: 'ProductCategory', entityId: cat.id, after: cat });
      return cat;
    });
  }

  async updateCategory(user: RequestUser, id: string, dto: UpdateCategoryDto) {
    const before = await this.prisma.db.productCategory.findFirst({ where: { id } });
    if (!before) throw Errors.notFound('Nhóm hàng', id);
    if (dto.parentId) {
      if (dto.parentId === id) throw Errors.validation('Nhóm hàng không thể là cha của chính nó');
      // prevent cycles: walk up from the new parent
      let cur: string | null = dto.parentId;
      while (cur) {
        if (cur === id) throw Errors.validation('Không thể chuyển nhóm hàng vào nhóm con của nó');
        const p: { parentId: string | null } | null = await this.prisma.db.productCategory.findFirst({ where: { id: cur }, select: { parentId: true } });
        if (!p) throw Errors.notFound('Nhóm hàng cha', cur);
        cur = p.parentId;
      }
    }
    return this.prisma.tx(async (tx) => {
      const after = await tx.productCategory.update({ where: { id }, data: { name: dto.name, parentId: dto.parentId === undefined ? undefined : dto.parentId, sortOrder: dto.sortOrder, isActive: dto.isActive } });
      await this.audit.log(tx, { action: 'category.update', entityType: 'ProductCategory', entityId: id, before, after });
      return after;
    });
  }

  async deleteCategory(user: RequestUser, id: string) {
    const cat = await this.prisma.db.productCategory.findFirst({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
    if (!cat) throw Errors.notFound('Nhóm hàng', id);
    if (cat._count.products > 0 || cat._count.children > 0) throw Errors.conflict('CATEGORY_IN_USE', 'Nhóm hàng đang có hàng hóa hoặc nhóm con', { products: cat._count.products, children: cat._count.children });
    await this.prisma.tx(async (tx) => {
      await tx.productCategory.delete({ where: { id } });
      await this.audit.log(tx, { action: 'category.delete', entityType: 'ProductCategory', entityId: id, before: cat });
    });
  }

  // ---------------- brands
  listBrands(includeInactive = false) {
    return this.prisma.db.brand.findMany({ where: includeInactive ? {} : { isActive: true }, include: { _count: { select: { products: { where: { deletedAt: null } } } } }, orderBy: { name: 'asc' } });
  }
  async createBrand(user: RequestUser, dto: NameDto) {
    const dup = await this.prisma.db.brand.findFirst({ where: { name: dto.name } });
    if (dup) throw Errors.duplicate('DUPLICATE_NAME', 'Thương hiệu đã tồn tại', { name: dto.name });
    return this.prisma.tx(async (tx) => {
      const b = await tx.brand.create({ data: { tenantId: user.tenantId, name: dto.name } });
      await this.audit.log(tx, { action: 'brand.create', entityType: 'Brand', entityId: b.id, after: b });
      return b;
    });
  }
  async updateBrand(user: RequestUser, id: string, dto: NameDto) {
    const before = await this.prisma.db.brand.findFirst({ where: { id } });
    if (!before) throw Errors.notFound('Thương hiệu', id);
    return this.prisma.tx(async (tx) => {
      const after = await tx.brand.update({ where: { id }, data: dto });
      await this.audit.log(tx, { action: 'brand.update', entityType: 'Brand', entityId: id, before, after });
      return after;
    });
  }
  async deleteBrand(user: RequestUser, id: string) {
    const b = await this.prisma.db.brand.findFirst({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!b) throw Errors.notFound('Thương hiệu', id);
    if (b._count.products > 0) throw Errors.conflict('BRAND_IN_USE', 'Thương hiệu đang được dùng', { products: b._count.products });
    await this.prisma.tx(async (tx) => {
      await tx.brand.delete({ where: { id } });
      await this.audit.log(tx, { action: 'brand.delete', entityType: 'Brand', entityId: id, before: b });
    });
  }

  // ---------------- units
  listUnits() {
    return this.prisma.db.unit.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  }
  async createUnit(user: RequestUser, dto: NameDto) {
    const dup = await this.prisma.db.unit.findFirst({ where: { name: dto.name } });
    if (dup) throw Errors.duplicate('DUPLICATE_NAME', 'Đơn vị tính đã tồn tại', { name: dto.name });
    return this.prisma.db.unit.create({ data: { tenantId: user.tenantId, name: dto.name } });
  }
  async deleteUnit(user: RequestUser, id: string) {
    const u = await this.prisma.db.unit.findFirst({ where: { id } });
    if (!u) throw Errors.notFound('Đơn vị tính', id);
    const used = await this.prisma.db.product.count({ where: { baseUnit: u.name, deletedAt: null } });
    if (used > 0) throw Errors.conflict('UNIT_IN_USE', 'Đơn vị tính đang được dùng', { products: used });
    await this.prisma.db.unit.delete({ where: { id } });
  }
}
