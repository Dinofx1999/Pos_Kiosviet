import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { DbClient, PrismaService } from '../../infra/prisma/prisma.service';
import { UpdateShopConfigDto } from './dto/online.dto';
import { normalizeShopConfig, SHOP_SETTING_KEY, ShopConfig } from './shop-config';

/** Thiết lập web bán hàng (BR-180): bật / tắt web, hiển thị giá, Flash Sale, thông tin cửa hàng, nơi nhận đơn. */
@Injectable()
export class ShopSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get(db: DbClient = this.prisma.db): Promise<ShopConfig> {
    const row = await db.tenantSetting.findFirst({ where: { key: SHOP_SETTING_KEY } });
    return normalizeShopConfig(row?.value);
  }

  /** Thông tin cho trang quản trị: cấu hình + mã cửa hàng + có phải cửa hàng mặc định của /shop không. */
  async adminView(user: RequestUser) {
    const [config, tenant, pendingOrders] = await Promise.all([
      this.get(),
      this.prisma.raw.tenant.findUnique({ where: { id: user.tenantId }, select: { code: true, name: true } }),
      this.prisma.db.salesOrder.count({ where: { source: 'ONLINE', status: 'DRAFT' } }),
    ]);
    const defaultTenantId = await this.defaultTenantId();
    return { config, tenantCode: tenant?.code, tenantName: tenant?.name, isDefaultShop: defaultTenantId === user.tenantId, pendingOrders };
  }

  async update(user: RequestUser, dto: UpdateShopConfigDto) {
    const before = await this.get();
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) patch[k] = typeof v === 'string' && v.trim() === '' ? null : v;
    const next = normalizeShopConfig({ ...before, ...patch });
    if (next.branchId) {
      const b = await this.prisma.db.branch.findFirst({ where: { id: next.branchId, isActive: true } });
      if (!b) throw Errors.validation('Chi nhánh nhận đơn không tồn tại hoặc đã ngừng hoạt động');
    }
    if (next.warehouseId) {
      const w = await this.prisma.db.warehouse.findFirst({ where: { id: next.warehouseId, isActive: true } });
      if (!w) throw Errors.validation('Kho xuất hàng không tồn tại hoặc đã ngừng hoạt động');
      if (next.branchId && w.branchId !== next.branchId) throw Errors.validation('Kho xuất hàng không thuộc chi nhánh nhận đơn');
      if (!next.branchId) next.branchId = w.branchId;
    }
    await this.prisma.tx(async (tx) => {
      await tx.tenantSetting.upsert({
        where: { tenantId_key: { tenantId: user.tenantId, key: SHOP_SETTING_KEY } },
        create: { tenantId: user.tenantId, key: SHOP_SETTING_KEY, value: next as unknown as Prisma.InputJsonValue },
        update: { value: next as unknown as Prisma.InputJsonValue },
      });
      await this.audit.log(tx, { action: 'online.settings.update', entityType: 'TenantSetting', entityCode: SHOP_SETTING_KEY, before: before as unknown as Record<string, unknown>, after: next as unknown as Record<string, unknown> });
    });
    return this.adminView(user);
  }

  /**
   * Cửa hàng mở ở đường dẫn /shop (không kèm mã): biến môi trường SHOP_DEFAULT_TENANT,
   * nếu không có thì cửa hàng duy nhất đang bật web bán hàng.
   */
  async defaultTenantId(): Promise<string | null> {
    const code = process.env.SHOP_DEFAULT_TENANT?.trim().toLowerCase();
    if (code) return (await this.prisma.raw.tenant.findUnique({ where: { code }, select: { id: true } }))?.id ?? null;
    const rows = await this.prisma.raw.tenantSetting.findMany({ where: { key: SHOP_SETTING_KEY }, select: { tenantId: true, value: true } });
    const on = rows.filter((r) => normalizeShopConfig(r.value).enabled);
    if (on.length === 1) return on[0].tenantId;
    if (on.length > 1) return null;
    // chưa cửa hàng nào mở web: máy chủ chỉ có một cửa hàng → /shop vẫn nhận ra (hiện trang "tạm nghỉ")
    const tenants = await this.prisma.raw.tenant.findMany({ where: { status: { in: ['TRIAL', 'ACTIVE'] } }, select: { id: true }, take: 2 });
    return tenants.length === 1 ? tenants[0].id : null;
  }
}
