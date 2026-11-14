import { Prisma } from '@prisma/client';

type RawDb = { $executeRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Prisma.PrismaPromise<number> };

/**
 * BR-189: combo `autoPrice` → giá bán biến thể combo = Σ (giá bán lẻ thành phần × số lượng), lưu sẵn vào `sell_price`
 * để mọi nơi đọc giá (bán hàng, đơn hàng, web, Excel, báo cáo) dùng chung một con số.
 * Gọi lại sau mỗi lần đổi giá hàng thành phần / đổi thành phần combo. Không truyền phạm vi = mọi combo của tenant.
 */
export function refreshAutoComboPrices(db: RawDb, tenantId: string, scope: { comboIds?: string[]; componentVariantIds?: string[] } = {}) {
  if ((scope.comboIds && !scope.comboIds.length) || (scope.componentVariantIds && !scope.componentVariantIds.length)) return Promise.resolve(0);
  const filter = scope.comboIds
    ? Prisma.sql`AND p.id = ANY(${scope.comboIds}::uuid[])`
    : scope.componentVariantIds
      ? Prisma.sql`AND p.id IN (SELECT combo_product_id FROM combo_items WHERE tenant_id = ${tenantId}::uuid AND component_variant_id = ANY(${scope.componentVariantIds}::uuid[]))`
      : Prisma.empty;
  return db.$executeRaw`
    UPDATE product_variants cv SET sell_price = t.total, updated_at = now()
    FROM (
      SELECT ci.combo_product_id AS id, ROUND(SUM(v.sell_price * ci.quantity), 4) AS total
      FROM combo_items ci
      JOIN product_variants v ON v.id = ci.component_variant_id
      JOIN products p ON p.id = ci.combo_product_id
      WHERE ci.tenant_id = ${tenantId}::uuid AND p.tenant_id = ${tenantId}::uuid AND p.type = 'COMBO' AND p.auto_price ${filter}
      GROUP BY ci.combo_product_id
    ) t
    WHERE cv.product_id = t.id AND cv.tenant_id = ${tenantId}::uuid AND cv.deleted_at IS NULL AND cv.sell_price <> t.total`;
}
