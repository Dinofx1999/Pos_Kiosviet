/* Adds permissions that newer modules introduced to the default roles of EXISTING tenants (never removes). Usage: ts-node prisma/sync-roles.ts */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const { DEFAULT_ROLES } = await import('../src/modules/auth/auth.service');
  const roles = await prisma.role.findMany({ where: { code: { in: DEFAULT_ROLES.map((r) => r.code) } }, include: { permissions: true } });
  let added = 0;
  for (const role of roles) {
    const def = DEFAULT_ROLES.find((r) => r.code === role.code)!;
    const have = new Set(role.permissions.map((p) => p.permission));
    const missing = def.permissions.filter((p) => !have.has(p));
    if (missing.length) {
      await prisma.rolePermission.createMany({ data: missing.map((permission) => ({ roleId: role.id, permission })), skipDuplicates: true });
      added += missing.length;
      console.log(`${role.code} (${role.tenantId}): +${missing.length}`);
    }
  }
  console.log(`Đã thêm ${added} quyền cho ${roles.length} vai trò mặc định.`);
  // Module 08: every branch needs a cash drawer fund
  const branches = await prisma.branch.findMany({ include: { cashAccounts: { where: { type: 'CASH' } } } });
  let drawers = 0;
  for (const b of branches) {
    if (b.cashAccounts.length) continue;
    await prisma.cashAccount.create({ data: { tenantId: b.tenantId, branchId: b.id, code: `QT-${b.code}`, name: `Két tiền mặt - ${b.name}`, type: 'CASH', isDefault: true } });
    drawers++;
  }
  console.log(`Đã tạo ${drawers} két tiền mặt cho chi nhánh chưa có.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
