/* Seed: tạo gian hàng demo + dữ liệu mẫu để chạy thử ngay. Idempotent: bỏ qua nếu tenant đã tồn tại. */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const code = process.env.SEED_TENANT_CODE ?? 'demo';
  if (await prisma.tenant.findUnique({ where: { code } })) {
    console.log(`Tenant "${code}" đã tồn tại – bỏ qua seed.`);
    return;
  }
  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123', 10);
  // Dùng chung logic với API: gọi DEFAULT_ROLES qua import động để tránh phụ thuộc Nest
  const { DEFAULT_ROLES } = await import('../src/modules/auth/auth.service');
  const { TENANT_SETTING_KEYS } = await import('@erp/shared');

  const tenant = await prisma.tenant.create({ data: { code, name: 'Cửa hàng mỹ phẩm Demo', status: 'ACTIVE', industry: 'Mỹ phẩm' } });
  const tenantId = tenant.id;
  await prisma.tenantSetting.createMany({ data: [
    { tenantId, key: TENANT_SETTING_KEYS.ALLOW_NEGATIVE_STOCK, value: false },
    { tenantId, key: TENANT_SETTING_KEYS.COSTING_METHOD, value: 'AVG' },
    { tenantId, key: TENANT_SETTING_KEYS.CURRENCY, value: 'VND' },
    { tenantId, key: TENANT_SETTING_KEYS.PRICE_INCLUDES_TAX, value: true },
  ] });
  const branch = await prisma.branch.create({ data: { tenantId, code: 'CN01', name: 'Chi nhánh trung tâm', isDefault: true, address: '123 Lê Lợi, Q.1, TP.HCM' } });
  const branch2 = await prisma.branch.create({ data: { tenantId, code: 'CN02', name: 'Chi nhánh Thủ Đức', address: 'Võ Văn Ngân, Thủ Đức' } });
  const wh = await prisma.warehouse.create({ data: { tenantId, branchId: branch.id, code: 'KHO01', name: 'Kho chính', isDefault: true } });
  await prisma.warehouse.create({ data: { tenantId, branchId: branch2.id, code: 'KHO02', name: 'Kho Thủ Đức', isDefault: true } });
  const roles: Record<string, string> = {};
  for (const r of DEFAULT_ROLES) {
    const role = await prisma.role.create({ data: { tenantId, code: r.code, name: r.name, isSystem: r.isSystem, permissions: { create: r.permissions.map((permission) => ({ permission })) } } });
    roles[r.code] = role.id;
  }
  const admin = await prisma.user.create({ data: { tenantId, username: 'admin', passwordHash, fullName: 'Quản trị viên', isOwner: true, allBranches: true, roles: { create: [{ roleId: roles.ADMIN }] } } });
  await prisma.user.create({ data: { tenantId, username: 'thukho', passwordHash, fullName: 'Nguyễn Thủ Kho', roles: { create: [{ roleId: roles.WAREHOUSE }] }, branchAccess: { create: [{ branchId: branch.id }] } } });
  await prisma.user.create({ data: { tenantId, username: 'thungan', passwordHash, fullName: 'Trần Thu Ngân', roles: { create: [{ roleId: roles.CASHIER }] }, branchAccess: { create: [{ branchId: branch.id }] } } });

  const cats = await Promise.all(['Son môi', 'Kem dưỡng da', 'Sữa rửa mặt', 'Nước hoa'].map((name) => prisma.productCategory.create({ data: { tenantId, name } })));
  const brands = await Promise.all(["L'Oréal", 'Maybelline', 'Innisfree', 'The Ordinary'].map((name) => prisma.brand.create({ data: { tenantId, name } })));
  await prisma.unit.createMany({ data: ['Cái', 'Cây', 'Hộp', 'Chai', 'Tuýp', 'Thùng'].map((name) => ({ tenantId, name })) });

  const sample = [
    { code: 'SP000001', name: 'Son lì Maybelline SuperStay', cat: 0, brand: 1, unit: 'Cây', price: 189000, cost: 120000, attrs: ['Màu sắc'], variants: [{ 'Màu sắc': 'Đỏ cam' }, { 'Màu sắc': 'Hồng đất' }, { 'Màu sắc': 'Đỏ rượu' }] },
    { code: 'SP000002', name: 'Kem dưỡng ẩm Innisfree Green Tea 50ml', cat: 1, brand: 2, unit: 'Hộp', price: 350000, cost: 230000, attrs: [], variants: [{}] },
    { code: 'SP000003', name: 'Sữa rửa mặt Innisfree Green Tea 150ml', cat: 2, brand: 2, unit: 'Tuýp', price: 165000, cost: 100000, attrs: [], variants: [{}] },
    { code: 'SP000004', name: 'Serum The Ordinary Niacinamide 10% 30ml', cat: 1, brand: 3, unit: 'Chai', price: 260000, cost: 170000, attrs: [], variants: [{}] },
    { code: 'SP000005', name: "Nước hoa L'Oréal Paris 50ml", cat: 3, brand: 0, unit: 'Chai', price: 890000, cost: 600000, attrs: [], variants: [{}] },
  ];
  const variantIds: string[] = [];
  for (const s of sample) {
    const p = await prisma.product.create({ data: {
      tenantId, code: s.code, name: s.name, type: 'GOODS', categoryId: cats[s.cat].id, brandId: brands[s.brand].id, baseUnit: s.unit, hasVariants: s.variants.length > 1, attributeNames: s.attrs, taxRate: 10, createdById: admin.id,
      variants: { create: s.variants.map((attrs, i) => ({ tenantId, sku: s.variants.length > 1 ? `${s.code}-${i + 1}` : s.code, barcode: `893000${s.code.slice(-3)}${i}`, name: s.attrs.length ? `${s.name} - ${Object.values(attrs).join(' - ')}` : s.name, attributes: Object.keys(attrs).length ? attrs : undefined, sellPrice: s.price, costPrice: s.cost, minStock: 5, maxStock: 200, isDefault: i === 0 })) },
    }, include: { variants: true } });
    variantIds.push(...p.variants.map((v) => v.id));
  }
  await prisma.documentSequence.create({ data: { tenantId, docType: 'PRODUCT', prefix: 'SP', padding: 6, nextNumber: 6 } });
  console.log(`Seed xong: tenant=${code}, admin/thukho/thungan mật khẩu "${process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123'}", kho ${wh.code}, ${variantIds.length} biến thể (tồn = 0; hãy tạo phiếu nhập kho để có tồn).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
