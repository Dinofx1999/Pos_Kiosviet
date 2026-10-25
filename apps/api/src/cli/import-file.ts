/**
 * Nhập file Excel (KiotViet) trực tiếp trên máy chủ – dùng cho lần chuyển dữ liệu lớn (hàng chục nghìn dòng) mà không
 * phụ thuộc giới hạn thời gian HTTP / nginx. Chạy cùng logic với màn "Tích hợp → Nhập Excel" (xem trước → xác nhận).
 *
 *   node dist/src/cli/import-file.js --tenant baoantamky --type PRODUCTS --file /path/DanhSachSanPham.xlsx \
 *        [--options '{"stockColumns":[{"header":"Kho: Kho bán hàng","warehouseId":"…"}]}'] [--dry-run]
 *
 * Người thực hiện = chủ gian hàng (ghi trong nhật ký / phiếu điều chỉnh). Kết quả in ra dạng JSON.
 */
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ClsService } from 'nestjs-cls';
import { AppModule } from '../app.module';
import { CTX, RequestUser } from '../infra/cls/request-context';
import { PrismaService } from '../infra/prisma/prisma.service';
import { ImportService } from '../modules/integrations/import.service';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const tenantCode = arg('tenant'); const type = arg('type') as 'PRODUCTS' | 'CUSTOMERS' | 'SUPPLIERS' | 'INVOICES'; const file = arg('file');
  if (!tenantCode || !type || !file) throw new Error('Cần --tenant, --type (PRODUCTS|CUSTOMERS|SUPPLIERS|INVOICES) và --file');
  const options = arg('options') ? JSON.parse(arg('options')!) : {};
  const dryRun = process.argv.includes('--dry-run');
  process.env.OUTBOX_DISABLED = 'true'; // tiến trình API chính đã chạy bộ phát sự kiện

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService); const cls = app.get(ClsService); const importer = app.get(ImportService);
    const tenant = await prisma.raw.tenant.findFirst({ where: { code: tenantCode } });
    if (!tenant) throw new Error(`Không có gian hàng ${tenantCode}`);
    const u = await prisma.raw.user.findFirst({
      where: { tenantId: tenant.id, isOwner: true, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' },
      include: { roles: { include: { role: { include: { permissions: true } } } }, branchAccess: { select: { branchId: true } }, warehouseAccess: { select: { warehouseId: true } } },
    });
    if (!u) throw new Error('Gian hàng không có chủ đang hoạt động');
    const user: RequestUser = { id: u.id, tenantId: u.tenantId, username: u.username, fullName: u.fullName, isOwner: true, allBranches: u.allBranches, permissions: new Set(['*']), branchIds: u.branchAccess.map((b) => b.branchId), warehouseIds: u.warehouseAccess.map((w) => w.warehouseId) };

    await cls.run(async () => {
      cls.set(CTX.tenantId, tenant.id);
      cls.set(CTX.user, user);
      cls.set(CTX.ip, 'cli');
      // stockColumns có thể ghi tên kho thay cho id: {"header":"Kho: Kho tổng Bảo Ân","warehouseName":"Kho tổng Bảo Ân"} → tìm hoặc tạo kho ở chi nhánh mặc định
      if (Array.isArray(options.stockColumns)) {
        const branch = await prisma.db.branch.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
        for (const sc of options.stockColumns as Array<{ header: string; warehouseId?: string; warehouseName?: string }>) {
          if (sc.warehouseId || !sc.warehouseName) continue;
          let wh = await prisma.db.warehouse.findFirst({ where: { name: sc.warehouseName, isActive: true } });
          if (!wh) {
            const code = `KHO-${String(Date.now()).slice(-6)}`;
            wh = await prisma.db.warehouse.create({ data: { tenantId: tenant.id, branchId: branch!.id, code, name: sc.warehouseName } });
            console.error(`[kho] tạo kho "${sc.warehouseName}" (${code})`);
          }
          sc.warehouseId = wh.id;
        }
        if (!options.defaultWarehouseId && options.stockColumns[0]?.warehouseId) options.defaultWarehouseId = options.stockColumns[0].warehouseId;
      }
      const t0 = Date.now();
      // .json = {headers, rows} đã đọc / chia nhỏ sẵn ở máy khác (file lịch sử hóa đơn rất lớn) → bỏ bước đọc Excel trên máy chủ
      const preview = file.endsWith('.json')
        ? await (async () => { const j = JSON.parse(readFileSync(file, 'utf8')) as { headers: string[]; rows: Array<Record<string, string>> }; return importer.previewRows(user, type, path.basename(file), j.headers, j.rows, options, 'EXCEL'); })()
        : await importer.preview(user, type, path.basename(file), readFileSync(file), options, 'EXCEL');
      const p = preview as unknown as { jobId: string; rowCount: number; mapping: Record<string, string>; missing: string[]; stockHeaders?: string[]; issues: unknown[] };
      console.error(`[xem trước] ${p.rowCount} dòng, thiếu cột: ${p.missing.join(', ') || 'không'}, cột tồn: ${(p.stockHeaders ?? []).join(' | ')}, cảnh báo: ${p.issues.length}`);
      if (dryRun) { console.log(JSON.stringify({ jobId: p.jobId, rowCount: p.rowCount, mapping: p.mapping, missing: p.missing, stockHeaders: p.stockHeaders, issues: p.issues.slice(0, 20) }, null, 2)); return; }
      const res = await importer.commit(user, p.jobId, {});
      console.error(`[xong] ${Math.round((Date.now() - t0) / 1000)} giây`);
      console.log(JSON.stringify(res, null, 2));
    });
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('LỖI:', e instanceof Error ? e.message : e); process.exit(1); });
