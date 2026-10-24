import { Injectable } from '@nestjs/common';
import { Prisma, ProductType } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { isUuid } from '../../common/validators';
import { orderBy, paginated, skipTake } from '../../common/pagination';
import { D, qty as toQty, ZERO } from '../../common/utils/decimal';
import { AccessService } from '../../infra/access/access.service';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { NumberingService } from '../../infra/numbering/numbering.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { PlanService } from '../platform/plan.service';
import { PrismaService, TxClient } from '../../infra/prisma/prisma.service';
import { InventoryDocumentsService } from '../inventory/documents.service';
import { StockQueryService } from '../inventory/stock-query.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateBatchDto, CreateProductDto, ProductImageInputDto, ProductQueryDto, ProductUnitInputDto, UpdateProductDto, VariantInputDto } from './dto/catalog.dto';

const productInclude = {
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  variants: { where: { deletedAt: null }, orderBy: [{ isDefault: 'desc' as const }, { createdAt: 'asc' as const }] },
  units: true,
  images: { orderBy: { sortOrder: 'asc' as const } },
  comboItems: { include: { componentVariant: { select: { id: true, sku: true, name: true, sellPrice: true, costPrice: true, onHandTotal: true } } } },
} satisfies Prisma.ProductInclude;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly inventoryDocs: InventoryDocumentsService,
    private readonly stock: StockQueryService, private readonly plans: PlanService) {}

  // ------------------------------------------------------------------ list / get / search
  async list(user: RequestUser, q: ProductQueryDto) {
    const f = this.prisma.db.productVariant.fields;
    const stockFilter: Prisma.ProductVariantWhereInput | undefined =
      q.stockStatus === 'out' ? { onHandTotal: { lte: 0 } }
      : q.stockStatus === 'in' ? { onHandTotal: { gt: 0 } }
      : q.stockStatus === 'low' ? { minStock: { not: null }, onHandTotal: { lte: f.minStock } }
      : q.stockStatus === 'over' ? { maxStock: { not: null }, onHandTotal: { gte: f.maxStock } }
      : undefined;
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.type ? { type: q.type as ProductType } : {}),
      ...(q.isActive ? { isActive: q.isActive === 'true' } : {}),
      ...(stockFilter ? { type: 'GOODS', variants: { some: { deletedAt: null, ...stockFilter } } } : {}),
      ...(q.search ? { OR: [{ code: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }, { variants: { some: { OR: [{ sku: { contains: q.search, mode: 'insensitive' } }, { barcode: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.product.findMany({ where, include: productInclude, ...skipTake(q), orderBy: orderBy(q, ['createdAt', 'code', 'name', 'updatedAt'], 'createdAt') }),
      this.prisma.db.product.count({ where }),
    ]);
    if (q.warehouseId) await this.access.assertWarehouse(user, q.warehouseId);
    const stockMap = q.warehouseId ? await this.stock.variantStock(rows.flatMap((p) => p.variants.map((v) => v.id)), q.warehouseId) : null;
    return paginated(rows.map((p) => this.toView(p, this.canSeeCost(user), stockMap)), total, q);
  }

  async get(user: RequestUser, id: string) {
    const p = await this.prisma.db.product.findFirst({ where: { id, deletedAt: null }, include: productInclude });
    if (!p) throw Errors.notFound('Hàng hóa', id);
    const whWhere = await this.access.warehouseWhere(user);
    const balances = await this.prisma.db.stockBalance.findMany({ where: { variantId: { in: p.variants.map((v) => v.id) }, ...whWhere }, include: { warehouse: { select: { id: true, name: true, code: true } }, batch: { select: { id: true, batchNo: true, expiryDate: true } } } });
    const canSeeCost = user.permissions.has('*') || user.permissions.has('product.cost.view');
    return { ...this.toView(p, canSeeCost, null), balances: balances.map((b) => ({ ...b, available: D(b.onHand).minus(D(b.reserved)) })) };
  }

  /** Quick search for POS / document line entry: code, sku, barcode, name. */
  async quickSearch(user: RequestUser, qstr: string, warehouseId?: string, limit = 20) {
    const term = qstr.trim();
    if (!term) return [];
    if (warehouseId !== undefined) {
      if (!isUuid(warehouseId)) throw Errors.validation('warehouseId không hợp lệ');
      await this.access.assertWarehouse(user, warehouseId);
    }
    const variants = await this.prisma.db.productVariant.findMany({
      where: { deletedAt: null, isActive: true, product: { deletedAt: null, isActive: true }, OR: [{ sku: { contains: term, mode: 'insensitive' } }, { barcode: { equals: term } }, { name: { contains: term, mode: 'insensitive' } }, { product: { code: { contains: term, mode: 'insensitive' } } }] },
      include: { product: { select: { id: true, code: true, name: true, type: true, baseUnit: true, trackBatch: true, imageUrl: true } } },
      take: limit, orderBy: [{ name: 'asc' }],
    });
    const stockMap = await this.stock.variantStock(variants.map((v) => v.id), warehouseId);
    const canSeeCost = this.canSeeCost(user);
    return variants.map((v) => ({ ...this.variantView(v, canSeeCost), product: v.product, onHand: stockMap.get(v.id)?.onHand ?? ZERO, available: (stockMap.get(v.id)?.onHand ?? ZERO).minus(stockMap.get(v.id)?.reserved ?? ZERO) }));
  }

  async byBarcode(user: RequestUser, barcode: string) {
    const v = await this.prisma.db.productVariant.findFirst({ where: { barcode, deletedAt: null }, include: { product: { select: { id: true, code: true, name: true, type: true, baseUnit: true, trackBatch: true, imageUrl: true } } } });
    if (!v) {
      const unit = await this.prisma.db.productUnit.findFirst({ where: { barcode }, include: { product: { include: { variants: { where: { isDefault: true, deletedAt: null }, take: 1 } } } } });
      if (!unit || !unit.product.variants[0]) throw Errors.notFound('Mã vạch', barcode);
      const dv = unit.product.variants[0];
      return { ...this.variantView(dv, user.permissions.has('*') || user.permissions.has('product.cost.view')), product: { id: unit.product.id, code: unit.product.code, name: unit.product.name, type: unit.product.type, baseUnit: unit.product.baseUnit }, unit: { unitName: unit.unitName, conversionFactor: unit.conversionFactor, sellPrice: unit.sellPrice } };
    }
    return { ...this.variantView(v, user.permissions.has('*') || user.permissions.has('product.cost.view')), product: v.product };
  }

  // ------------------------------------------------------------------ create (BR-10, BR-11)
  async create(user: RequestUser, dto: CreateProductDto) {
    const type = dto.type ?? 'GOODS';
    if (type === 'COMBO' && !(dto.comboItems?.length)) throw Errors.validation('Hàng combo phải có ít nhất 1 thành phần');
    if (type !== 'GOODS' && dto.initialStock?.length) throw Errors.validation('Chỉ hàng hóa mới có tồn đầu kỳ');
    if (type !== 'GOODS' && dto.trackBatch) throw Errors.validation('Chỉ hàng hóa mới theo dõi lô');
    if (dto.variants.length > 1 && !(dto.attributeNames?.length)) throw Errors.validation('Hàng nhiều biến thể phải khai báo thuộc tính (attributeNames)');
    await this.validateRefs(dto.categoryId ?? undefined, dto.brandId ?? undefined);
    const images = this.normalizeImages(user, dto.images);

    const product = await this.prisma.tx(async (tx) => {
      await this.plans.assertLimit(tx, user.tenantId, 'products');
      const code = dto.code ? await this.ensureProductCode(tx, user.tenantId, dto.code) : await this.numbering.next(tx, 'PRODUCT');
      await this.assertSkuBarcodeFree(tx, dto.variants, dto.units ?? []);
      const variantsData = this.buildVariants(user.tenantId, code, dto.name, dto.variants, dto.attributeNames ?? []);
      const created = await tx.product.create({
        data: {
          tenantId: user.tenantId, code, name: dto.name, type, categoryId: dto.categoryId, brandId: dto.brandId, baseUnit: dto.baseUnit, description: dto.description,
          taxRate: dto.taxRate !== undefined ? D(dto.taxRate) : undefined, weight: dto.weight !== undefined ? D(dto.weight) : undefined, trackBatch: dto.trackBatch ?? false,
          allowSale: dto.allowSale ?? true, hasVariants: dto.variants.length > 1 || (dto.attributeNames?.length ?? 0) > 0, attributeNames: dto.attributeNames ?? [], imageUrl: images[0]?.url ?? dto.imageUrl, createdById: user.id,
          variants: { create: variantsData },
          units: { create: (dto.units ?? []).map((u) => this.buildUnit(user.tenantId, u)) },
        },
        include: productInclude,
      });
      if (images.length) await this.replaceImages(tx, user.tenantId, created.id, images, created.variants.map((v) => v.id));
      if (type === 'COMBO') await this.setComboItems(tx, user.tenantId, created.id, dto.comboItems!);
      await this.audit.log(tx, { action: 'product.create', entityType: 'Product', entityId: created.id, entityCode: created.code, after: { name: created.name, type, variants: created.variants.map((v) => v.sku) } });
      await this.outbox.enqueue(tx, { eventType: 'product.created', aggregateType: 'Product', aggregateId: created.id, payload: { code: created.code, name: created.name } });

      if (dto.initialStock?.length) {
        const byWarehouse = new Map<string, typeof dto.initialStock>();
        for (const s of dto.initialStock) (byWarehouse.get(s.warehouseId) ?? byWarehouse.set(s.warehouseId, []).get(s.warehouseId)!).push(s);
        for (const [warehouseId, items] of byWarehouse) {
          const wh = await tx.warehouse.findFirst({ where: { id: warehouseId } });
          if (!wh) throw Errors.notFound('Kho', warehouseId);
          const doc = await this.inventoryDocs.createInTx(tx, user, {
            type: 'RECEIPT', branchId: wh.branchId, warehouseId, reason: 'OPENING', note: `Tồn đầu kỳ ${created.code}`,
            lines: items.map((s) => {
              const v = created.variants[s.variantIndex ?? 0];
              if (!v) throw Errors.validation('variantIndex không hợp lệ', { variantIndex: s.variantIndex });
              return { variantId: v.id, quantity: s.quantity, unitCost: s.unitCost };
            }),
          });
          await this.inventoryDocs.postInTx(tx, user, doc.id);
        }
      }
      return tx.product.findFirstOrThrow({ where: { id: created.id }, include: productInclude });
    });
    return this.toView(product, this.canSeeCost(user), null);
  }

  // ------------------------------------------------------------------ update
  async update(user: RequestUser, id: string, dto: UpdateProductDto) {
    const before = await this.prisma.db.product.findFirst({ where: { id, deletedAt: null }, include: productInclude });
    if (!before) throw Errors.notFound('Hàng hóa', id);
    await this.validateRefs(dto.categoryId ?? undefined, dto.brandId ?? undefined);
    if (dto.trackBatch !== undefined && dto.trackBatch !== before.trackBatch) {
      const moved = await this.prisma.db.stockMovement.count({ where: { variant: { productId: id } } });
      if (moved > 0) throw Errors.conflict('PRODUCT_IN_USE', 'Không thể đổi chế độ theo dõi lô khi đã có biến động kho');
    }
    const images = dto.images !== undefined ? this.normalizeImages(user, dto.images) : undefined;
    const product = await this.prisma.tx(async (tx) => {
      if (dto.variants?.length || dto.units) await this.assertSkuBarcodeFree(tx, dto.variants ?? [], dto.units ?? [], id);
      await tx.product.update({
        where: { id },
        data: {
          name: dto.name, categoryId: dto.categoryId, brandId: dto.brandId, baseUnit: dto.baseUnit, description: dto.description,
          taxRate: dto.taxRate !== undefined ? D(dto.taxRate) : undefined, weight: dto.weight !== undefined ? D(dto.weight) : undefined,
          trackBatch: dto.trackBatch, allowSale: dto.allowSale, isActive: dto.isActive, attributeNames: dto.attributeNames,
          imageUrl: images !== undefined ? (images[0]?.url ?? null) : dto.imageUrl,
          ...(dto.attributeNames ? { hasVariants: dto.attributeNames.length > 0 || before.variants.length > 1 } : {}),
          ...(dto.units ? { units: { deleteMany: {}, create: dto.units.map((u) => this.buildUnit(user.tenantId, u)) } } : {}),
        },
      });
      if (dto.variants) {
        const attributeNames = dto.attributeNames ?? before.attributeNames;
        const name = dto.name ?? before.name;
        for (const v of dto.variants) {
          if (v.id) {
            const existing = before.variants.find((x) => x.id === v.id);
            if (!existing) throw Errors.notFound('Biến thể', v.id);
            const hasMoves = await tx.stockMovement.count({ where: { variantId: v.id } });
            await tx.productVariant.update({
              where: { id: v.id },
              data: {
                sku: v.sku ?? undefined, barcode: v.barcode === undefined ? undefined : v.barcode || null, attributes: v.attributes ?? undefined,
                name: v.attributes ? this.variantName(name, v.attributes, attributeNames) : dto.name ? this.variantName(name, (existing.attributes as Record<string, string>) ?? {}, attributeNames) : undefined,
                sellPrice: D(v.sellPrice), costPrice: v.costPrice !== undefined && hasMoves === 0 ? D(v.costPrice) : undefined,
                minStock: v.minStock !== undefined ? D(v.minStock) : undefined, maxStock: v.maxStock !== undefined ? D(v.maxStock) : undefined, imageUrl: v.imageUrl, isActive: v.isActive,
              },
            });
          } else {
            const [data] = this.buildVariants(user.tenantId, before.code, name, [v], attributeNames, before.variants.length);
            await tx.productVariant.create({ data: { ...data, productId: id } });
          }
        }
        const added = dto.variants.filter((v) => !v.id).length;
        if (before.variants.length + added > 1) await tx.product.update({ where: { id }, data: { hasVariants: true } });
      }
      if (dto.comboItems) {
        if (before.type !== 'COMBO') throw Errors.validation('Chỉ hàng combo mới có thành phần');
        await this.setComboItems(tx, user.tenantId, id, dto.comboItems);
      }
      if (images !== undefined) {
        const variantIds = (await tx.productVariant.findMany({ where: { productId: id }, select: { id: true } })).map((v) => v.id);
        await this.replaceImages(tx, user.tenantId, id, images, variantIds);
      }
      const after = await tx.product.findFirstOrThrow({ where: { id }, include: productInclude });
      await this.audit.log(tx, { action: 'product.update', entityType: 'Product', entityId: id, entityCode: after.code, before: this.toView(before, true, null), after: this.toView(after, true, null) });
      await this.outbox.enqueue(tx, { eventType: 'product.updated', aggregateType: 'Product', aggregateId: id, payload: { code: after.code } });
      return after;
    });
    return this.toView(product, this.canSeeCost(user), null);
  }

  async setActive(user: RequestUser, id: string, isActive: boolean) {
    return this.update(user, id, { isActive });
  }

  // ------------------------------------------------------------------ delete (BR-15)
  async remove(user: RequestUser, id: string) {
    const p = await this.prisma.db.product.findFirst({ where: { id, deletedAt: null }, include: { variants: { select: { id: true } } } });
    if (!p) throw Errors.notFound('Hàng hóa', id);
    const variantIds = p.variants.map((v) => v.id);
    const [moves, lines, combos] = await Promise.all([
      this.prisma.db.stockMovement.count({ where: { variantId: { in: variantIds } } }),
      this.prisma.db.inventoryDocumentLine.count({ where: { variantId: { in: variantIds } } }),
      this.prisma.db.comboItem.count({ where: { componentVariantId: { in: variantIds } } }),
    ]);
    if (moves > 0 || lines > 0 || combos > 0) throw Errors.conflict('PRODUCT_IN_USE', 'Hàng hóa đã phát sinh giao dịch, chỉ có thể ngừng kinh doanh', { movements: moves, documentLines: lines, combos });
    await this.prisma.tx(async (tx) => {
      await tx.product.delete({ where: { id } });
      await this.audit.log(tx, { action: 'product.delete', entityType: 'Product', entityId: id, entityCode: p.code, before: { name: p.name } });
    });
  }

  // ------------------------------------------------------------------ batches
  async listBatches(user: RequestUser, variantId: string) {
    const whWhere = await this.access.warehouseWhere(user);
    return this.prisma.db.productBatch.findMany({ where: { variantId }, include: { balances: { where: whWhere, select: { warehouseId: true, onHand: true, reserved: true } } }, orderBy: [{ expiryDate: 'asc' }, { batchNo: 'asc' }] });
  }
  async createBatch(user: RequestUser, variantId: string, dto: CreateBatchDto) {
    const v = await this.prisma.db.productVariant.findFirst({ where: { id: variantId, deletedAt: null }, include: { product: { select: { trackBatch: true } } } });
    if (!v) throw Errors.notFound('Biến thể', variantId);
    if (!v.product.trackBatch) throw Errors.conflict('BATCH_NOT_ALLOWED', 'Hàng hóa không theo dõi lô');
    const dup = await this.prisma.db.productBatch.findFirst({ where: { variantId, batchNo: dto.batchNo } });
    if (dup) throw Errors.duplicate('DUPLICATE_BATCH', 'Số lô đã tồn tại', { batchNo: dto.batchNo });
    return this.prisma.db.productBatch.create({ data: { tenantId: user.tenantId, variantId, batchNo: dto.batchNo, mfgDate: dto.mfgDate ? new Date(dto.mfgDate) : null, expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null } });
  }

  // ------------------------------------------------------------------ images
  private normalizeImages(user: RequestUser, input?: ProductImageInputDto[]) {
    const list = (input ?? []).map((i, idx) => ({ url: i.url, sortOrder: i.sortOrder ?? idx, variantId: i.variantId ?? null }));
    for (const img of list) UploadsService.assertImageUrl(user, img.url);
    const seen = new Set<string>();
    return list.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true))).sort((a, b) => a.sortOrder - b.sortOrder).map((i, idx) => ({ ...i, sortOrder: idx }));
  }

  /** Replaces the product's image list (ordered; first = primary). */
  private async replaceImages(tx: TxClient, tenantId: string, productId: string, images: Array<{ url: string; sortOrder: number; variantId: string | null }>, variantIds: string[]) {
    const bad = images.find((i) => i.variantId && !variantIds.includes(i.variantId));
    if (bad) throw Errors.validation('Ảnh gắn với biến thể không thuộc hàng hóa này', { variantId: bad.variantId });
    await tx.productImage.deleteMany({ where: { productId } });
    if (images.length) await tx.productImage.createMany({ data: images.map((i) => ({ tenantId, productId, variantId: i.variantId, url: i.url, sortOrder: i.sortOrder })) });
  }

  // ------------------------------------------------------------------ helpers
  private canSeeCost(user: RequestUser) {
    return user.permissions.has('*') || user.permissions.has('product.cost.view');
  }

  private async validateRefs(categoryId?: string, brandId?: string) {
    if (categoryId && !(await this.prisma.db.productCategory.findFirst({ where: { id: categoryId } }))) throw Errors.notFound('Nhóm hàng', categoryId);
    if (brandId && !(await this.prisma.db.brand.findFirst({ where: { id: brandId } }))) throw Errors.notFound('Thương hiệu', brandId);
  }

  private async ensureProductCode(tx: TxClient, tenantId: string, code: string) {
    if (!(await this.numbering.assertUnique(tx, 'products', code, tenantId))) throw Errors.duplicate('DUPLICATE_CODE', 'Mã hàng đã tồn tại', { code });
    return code;
  }

  private async assertSkuBarcodeFree(tx: TxClient, variants: VariantInputDto[], units: ProductUnitInputDto[], excludeProductId?: string) {
    const skus = [...variants.map((v) => v.sku), ...units.map((u) => u.sku)].filter((s): s is string => !!s);
    const barcodes = [...variants.map((v) => v.barcode), ...units.map((u) => u.barcode)].filter((s): s is string => !!s);
    if (new Set(skus).size !== skus.length) throw Errors.duplicate('DUPLICATE_SKU', 'SKU bị trùng trong cùng hàng hóa');
    if (new Set(barcodes).size !== barcodes.length) throw Errors.duplicate('DUPLICATE_BARCODE', 'Mã vạch bị trùng trong cùng hàng hóa');
    const excludeIds = variants.map((v) => v.id).filter((x): x is string => !!x);
    if (skus.length) {
      const hit = await tx.productVariant.findFirst({ where: { sku: { in: skus }, id: { notIn: excludeIds } } });
      if (hit) throw Errors.duplicate('DUPLICATE_SKU', `SKU "${hit.sku}" đã tồn tại`, { sku: hit.sku });
      const hitUnit = await tx.productUnit.findFirst({ where: { sku: { in: skus }, ...(excludeProductId ? { productId: { not: excludeProductId } } : {}) } });
      if (hitUnit) throw Errors.duplicate('DUPLICATE_SKU', `SKU "${hitUnit.sku}" đã tồn tại (đơn vị quy đổi)`, { sku: hitUnit.sku });
    }
    if (barcodes.length) {
      const hit = await tx.productVariant.findFirst({ where: { barcode: { in: barcodes }, id: { notIn: excludeIds } } });
      if (hit) throw Errors.duplicate('DUPLICATE_BARCODE', `Mã vạch "${hit.barcode}" đã tồn tại`, { barcode: hit.barcode });
      const hitUnit = await tx.productUnit.findFirst({ where: { barcode: { in: barcodes }, ...(excludeProductId ? { productId: { not: excludeProductId } } : {}) } });
      if (hitUnit) throw Errors.duplicate('DUPLICATE_BARCODE', `Mã vạch "${hitUnit.barcode}" đã tồn tại (đơn vị quy đổi)`, { barcode: hitUnit.barcode });
    }
  }

  private variantName(productName: string, attributes: Record<string, string>, attributeNames: string[]) {
    const parts = attributeNames.map((a) => attributes?.[a]).filter(Boolean);
    return parts.length ? `${productName} - ${parts.join(' - ')}` : productName;
  }

  private buildVariants(tenantId: string, code: string, name: string, inputs: VariantInputDto[], attributeNames: string[], offset = 0) {
    return inputs.map((v, i) => {
      const idx = offset + i;
      const attrs = v.attributes ?? {};
      if (attributeNames.length && inputs.length > 1) {
        const missing = attributeNames.filter((a) => !attrs[a]);
        if (missing.length) throw Errors.validation(`Biến thể ${idx + 1} thiếu thuộc tính: ${missing.join(', ')}`);
      }
      return {
        tenantId, sku: v.sku ?? (idx === 0 && inputs.length === 1 && offset === 0 ? code : `${code}-${idx + 1}`), barcode: v.barcode || null,
        name: this.variantName(name, attrs, attributeNames), attributes: Object.keys(attrs).length ? attrs : Prisma.JsonNull,
        sellPrice: D(v.sellPrice), costPrice: D(v.costPrice ?? 0), minStock: v.minStock !== undefined ? D(v.minStock) : null, maxStock: v.maxStock !== undefined ? D(v.maxStock) : null,
        imageUrl: v.imageUrl, isDefault: idx === 0, isActive: v.isActive ?? true,
      };
    });
  }

  private buildUnit(tenantId: string, u: ProductUnitInputDto) {
    const factor = D(u.conversionFactor);
    if (!factor.greaterThan(0)) throw Errors.validation('Hệ số quy đổi phải lớn hơn 0', { unitName: u.unitName });
    return { tenantId, unitName: u.unitName, conversionFactor: factor, sku: u.sku || null, barcode: u.barcode || null, sellPrice: u.sellPrice !== undefined ? D(u.sellPrice) : null };
  }

  private async setComboItems(tx: TxClient, tenantId: string, comboProductId: string, items: { componentVariantId: string; quantity: string }[]) {
    const ids = items.map((i) => i.componentVariantId);
    const comps = await tx.productVariant.findMany({ where: { id: { in: ids }, deletedAt: null }, include: { product: { select: { type: true, trackBatch: true } } } });
    if (comps.length !== new Set(ids).size) throw Errors.validation('Thành phần combo không hợp lệ');
    if (comps.some((c) => c.product.type !== 'GOODS')) throw Errors.validation('Thành phần combo phải là hàng hóa (không phải dịch vụ hay combo khác)');
    if (comps.some((c) => c.product.trackBatch)) throw Errors.validation('Thành phần combo không được là hàng theo dõi lô');
    await tx.comboItem.deleteMany({ where: { comboProductId } });
    await tx.comboItem.createMany({ data: items.map((i) => ({ tenantId, comboProductId, componentVariantId: i.componentVariantId, quantity: toQty(i.quantity) })) });
  }

  private variantView(v: Prisma.ProductVariantGetPayload<object>, canSeeCost: boolean) {
    const { costPrice, lastPurchasePrice, ...rest } = v;
    return { ...rest, costPrice: canSeeCost ? costPrice : undefined, lastPurchasePrice: canSeeCost ? lastPurchasePrice : undefined };
  }

  toView(p: Prisma.ProductGetPayload<{ include: typeof productInclude }>, canSeeCost: boolean, stockMap: Map<string, { onHand: Prisma.Decimal; reserved: Prisma.Decimal }> | null) {
    const variants = p.variants.map((v) => ({ ...this.variantView(v, canSeeCost), onHand: stockMap ? (stockMap.get(v.id)?.onHand ?? ZERO) : v.onHandTotal }));
    const onHand = p.type === 'COMBO'
      ? (p.comboItems.length ? p.comboItems.reduce((min, ci) => { const avail = D(ci.componentVariant.onHandTotal).dividedBy(D(ci.quantity)).floor(); return min === null || avail.lessThan(min) ? avail : min; }, null as Prisma.Decimal | null) ?? ZERO : ZERO)
      : variants.reduce((s, v) => s.plus(D(v.onHand)), ZERO);
    const def = variants[0];
    return { ...p, variants, onHand, sellPrice: def?.sellPrice, costPrice: canSeeCost ? def?.costPrice : undefined, comboItems: p.comboItems.map((ci) => ({ ...ci, componentVariant: { ...ci.componentVariant, costPrice: canSeeCost ? ci.componentVariant.costPrice : undefined } })) };
  }
}
