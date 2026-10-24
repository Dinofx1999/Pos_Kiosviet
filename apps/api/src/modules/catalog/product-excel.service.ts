import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestUser } from '../../infra/cls/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/catalog.dto';

const HEADERS = ['Mã hàng', 'Tên hàng', 'Loại (GOODS/SERVICE)', 'Nhóm hàng', 'Thương hiệu', 'ĐVT', 'Thuộc tính (Màu:Đỏ|Size:M)', 'SKU', 'Mã vạch', 'Giá bán', 'Giá vốn', 'Tồn tối thiểu', 'Tồn tối đa', 'Thuế (%)', 'Mô tả'];

@Injectable()
export class ProductExcelService {
  constructor(private readonly prisma: PrismaService, private readonly products: ProductsService) {}

  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hàng hóa');
    ws.addRow(HEADERS);
    ws.addRow(['', 'Son môi Matte', 'GOODS', 'Son', 'Maybelline', 'Cây', 'Màu:Đỏ', 'SON-DO', '8930001', 150000, 90000, 5, 100, 10, 'Son lì lâu trôi']);
    ws.addRow(['', 'Son môi Matte', 'GOODS', 'Son', 'Maybelline', 'Cây', 'Màu:Hồng', 'SON-HONG', '8930002', 150000, 90000, 5, 100, 10, '']);
    ws.columns.forEach((c) => (c.width = 18));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async export(user: RequestUser): Promise<Buffer> {
    const rows = await this.prisma.db.product.findMany({ where: { deletedAt: null }, include: { category: true, brand: true, variants: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } }, orderBy: { code: 'asc' } });
    const canSeeCost = user.permissions.has('*') || user.permissions.has('product.cost.view');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hàng hóa');
    ws.addRow([...HEADERS, 'Tồn kho', 'Trạng thái']);
    for (const p of rows) {
      for (const v of p.variants) {
        const attrs = v.attributes ? Object.entries(v.attributes as Record<string, string>).map(([k, val]) => `${k}:${val}`).join('|') : '';
        ws.addRow([p.code, p.name, p.type, p.category?.name ?? '', p.brand?.name ?? '', p.baseUnit ?? '', attrs, v.sku, v.barcode ?? '', Number(v.sellPrice), canSeeCost ? Number(v.costPrice) : '', v.minStock !== null ? Number(v.minStock) : '', v.maxStock !== null ? Number(v.maxStock) : '', p.taxRate !== null ? Number(p.taxRate) : '', p.description ?? '', Number(v.onHandTotal), p.isActive ? 'Đang kinh doanh' : 'Ngừng kinh doanh']);
      }
    }
    ws.columns.forEach((c) => (c.width = 18));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async import(user: RequestUser, buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) return { created: 0, failed: [{ row: 0, error: 'File không có sheet' }] };
    const [categories, brands] = await Promise.all([this.prisma.db.productCategory.findMany(), this.prisma.db.brand.findMany()]);
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));

    type Row = { rowNo: number; code: string; name: string; type: string; category: string; brand: string; unit: string; attrs: string; sku: string; barcode: string; sellPrice: string; costPrice: string; minStock: string; maxStock: string; taxRate: string; description: string };
    const rows: Row[] = [];
    ws.eachRow((r, rowNo) => {
      if (rowNo === 1) return;
      const c = (i: number) => String(r.getCell(i).value ?? '').trim();
      if (!c(2)) return;
      rows.push({ rowNo, code: c(1), name: c(2), type: c(3) || 'GOODS', category: c(4), brand: c(5), unit: c(6), attrs: c(7), sku: c(8), barcode: c(9), sellPrice: c(10) || '0', costPrice: c(11), minStock: c(12), maxStock: c(13), taxRate: c(14), description: c(15) });
    });
    // group rows into products by code (or name when code is empty)
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = (r.code || `name:${r.name}`).toLowerCase();
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }
    let created = 0;
    const failed: Array<{ row: number; error: string }> = [];
    for (const g of groups.values()) {
      const first = g[0];
      try {
        const attributeNames = Array.from(new Set(g.flatMap((r) => parseAttrs(r.attrs).map(([k]) => k))));
        const dto: CreateProductDto = {
          code: first.code || undefined, name: first.name, type: (['GOODS', 'SERVICE', 'COMBO'].includes(first.type.toUpperCase()) ? first.type.toUpperCase() : 'GOODS') as any,
          categoryId: first.category ? await this.ensureCategory(user, first.category, catByName) : undefined,
          brandId: first.brand ? await this.ensureBrand(user, first.brand, brandByName) : undefined,
          baseUnit: first.unit || undefined, description: first.description || undefined, taxRate: first.taxRate || undefined, attributeNames,
          variants: g.map((r) => ({ sku: r.sku || undefined, barcode: r.barcode || undefined, attributes: Object.fromEntries(parseAttrs(r.attrs)), sellPrice: r.sellPrice, costPrice: r.costPrice || undefined, minStock: r.minStock || undefined, maxStock: r.maxStock || undefined })),
        };
        const instance = plainToInstance(CreateProductDto, dto);
        const errors = await validate(instance, { whitelist: true });
        if (errors.length) {
          const msgs = errors.flatMap((e) => [...Object.values(e.constraints ?? {}), ...(e.children ?? []).flatMap((c) => (c.children ?? []).flatMap((cc) => Object.values(cc.constraints ?? {})))]);
          throw new Error(msgs.join('; ') || 'Dữ liệu không hợp lệ');
        }
        await this.products.create(user, instance);
        created++;
      } catch (e: any) {
        failed.push({ row: first.rowNo, error: e?.response?.message ?? e?.message ?? String(e) });
      }
    }
    return { created, failed, totalRows: rows.length };
  }

  private async ensureCategory(user: RequestUser, name: string, cache: Map<string, string>) {
    const key = name.toLowerCase();
    if (cache.has(key)) return cache.get(key)!;
    const c = await this.prisma.db.productCategory.create({ data: { tenantId: user.tenantId, name } });
    cache.set(key, c.id);
    return c.id;
  }
  private async ensureBrand(user: RequestUser, name: string, cache: Map<string, string>) {
    const key = name.toLowerCase();
    if (cache.has(key)) return cache.get(key)!;
    const b = await this.prisma.db.brand.create({ data: { tenantId: user.tenantId, name } });
    cache.set(key, b.id);
    return b.id;
  }
}

function parseAttrs(s: string): Array<[string, string]> {
  return s.split('|').map((p) => p.trim()).filter(Boolean).map((p) => { const [k, ...rest] = p.split(':'); return [k.trim(), rest.join(':').trim()] as [string, string]; }).filter(([k, v]) => k && v);
}
