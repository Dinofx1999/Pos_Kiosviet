import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DOC_SEQUENCE_DEFAULTS, TENANT_SETTING_KEYS } from '@erp/shared';
import { Errors } from '../../common/errors/app-error';
import { AuditService } from '../../infra/audit/audit.service';
import { RequestUser } from '../../infra/cls/request-context';
import { DbClient, PrismaService } from '../../infra/prisma/prisma.service';
import { SequenceItemDto } from './dto/org.dto';

const SETTING_DEFAULTS: Record<string, unknown> = {
  [TENANT_SETTING_KEYS.ALLOW_NEGATIVE_STOCK]: false,
  [TENANT_SETTING_KEYS.COSTING_METHOD]: 'AVG',
  [TENANT_SETTING_KEYS.CURRENCY]: 'VND',
  [TENANT_SETTING_KEYS.PRICE_INCLUDES_TAX]: true,
  [TENANT_SETTING_KEYS.PURCHASE_TAX_IN_COST]: true,
  [TENANT_SETTING_KEYS.POS_REQUIRE_SHIFT]: false,
  [TENANT_SETTING_KEYS.POS_ALLOW_CREDIT]: true,
  [TENANT_SETTING_KEYS.CASH_ALLOW_NEGATIVE]: true,
  [TENANT_SETTING_KEYS.POS_MAX_DISCOUNT_PERCENT]: 100,
  [TENANT_SETTING_KEYS.RETURN_MAX_DAYS]: 0,
  [TENANT_SETTING_KEYS.LOYALTY_ENABLED]: false,
  [TENANT_SETTING_KEYS.LOYALTY_EARN_POINTS]: 1,
  [TENANT_SETTING_KEYS.LOYALTY_EARN_PER_AMOUNT]: 10000,
  [TENANT_SETTING_KEYS.LOYALTY_REDEEM_VALUE]: 1000,
  [TENANT_SETTING_KEYS.LOYALTY_MIN_REDEEM]: 0,
  [TENANT_SETTING_KEYS.LOYALTY_MAX_REDEEM_PERCENT]: 100,
};
const SETTING_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  [TENANT_SETTING_KEYS.ALLOW_NEGATIVE_STOCK]: (v) => typeof v === 'boolean',
  [TENANT_SETTING_KEYS.COSTING_METHOD]: (v) => v === 'AVG',
  [TENANT_SETTING_KEYS.CURRENCY]: (v) => typeof v === 'string' && v.length <= 10,
  [TENANT_SETTING_KEYS.PRICE_INCLUDES_TAX]: (v) => typeof v === 'boolean',
  [TENANT_SETTING_KEYS.PURCHASE_TAX_IN_COST]: (v) => typeof v === 'boolean',
  [TENANT_SETTING_KEYS.POS_REQUIRE_SHIFT]: (v) => typeof v === 'boolean',
  [TENANT_SETTING_KEYS.POS_ALLOW_CREDIT]: (v) => typeof v === 'boolean',
  [TENANT_SETTING_KEYS.CASH_ALLOW_NEGATIVE]: (v) => typeof v === 'boolean',
  [TENANT_SETTING_KEYS.POS_MAX_DISCOUNT_PERCENT]: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  [TENANT_SETTING_KEYS.RETURN_MAX_DAYS]: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3650,
  [TENANT_SETTING_KEYS.LOYALTY_ENABLED]: (v) => typeof v === 'boolean',
  [TENANT_SETTING_KEYS.LOYALTY_EARN_POINTS]: (v) => typeof v === 'number' && v >= 0 && v <= 1000000,
  [TENANT_SETTING_KEYS.LOYALTY_EARN_PER_AMOUNT]: (v) => typeof v === 'number' && v > 0,
  [TENANT_SETTING_KEYS.LOYALTY_REDEEM_VALUE]: (v) => typeof v === 'number' && v >= 0,
  [TENANT_SETTING_KEYS.LOYALTY_MIN_REDEEM]: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
  [TENANT_SETTING_KEYS.LOYALTY_MAX_REDEEM_PERCENT]: (v) => typeof v === 'number' && v >= 0 && v <= 100,
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.db.tenantSetting.findMany();
    return { ...SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  }

  /** Reads one setting inside a transaction (used by posting engine for allowNegativeStock). */
  async get<T>(db: DbClient, key: string, fallback: T): Promise<T> {
    const row = await db.tenantSetting.findFirst({ where: { key } });
    return (row ? (row.value as T) : (SETTING_DEFAULTS[key] as T)) ?? fallback;
  }

  async update(actor: RequestUser, settings: Record<string, unknown>) {
    const before = await this.getAll();
    for (const [key, value] of Object.entries(settings)) {
      const validate = SETTING_VALIDATORS[key];
      if (!validate) throw Errors.validation(`Khóa cấu hình không hợp lệ: ${key}`);
      if (!validate(value)) throw Errors.validation(`Giá trị không hợp lệ cho ${key}`);
    }
    await this.prisma.tx(async (tx) => {
      for (const [key, value] of Object.entries(settings)) {
        await tx.tenantSetting.upsert({ where: { tenantId_key: { tenantId: actor.tenantId, key } }, create: { tenantId: actor.tenantId, key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
      }
      await this.audit.log(tx, { action: 'settings.update', entityType: 'TenantSetting', before, after: { ...before, ...settings } });
    });
    return this.getAll();
  }

  async listSequences() {
    const rows = await this.prisma.db.documentSequence.findMany();
    const byType = new Map(rows.map((r) => [r.docType, r]));
    return Object.entries(DOC_SEQUENCE_DEFAULTS).map(([docType, def]) => {
      const r = byType.get(docType);
      return { docType, prefix: r?.prefix ?? def.prefix, padding: r?.padding ?? def.padding, resetPolicy: r?.resetPolicy ?? 'NEVER', nextNumber: r ? Number(r.nextNumber) : 1 };
    });
  }

  async updateSequences(actor: RequestUser, items: SequenceItemDto[]) {
    const before = await this.listSequences();
    await this.prisma.tx(async (tx) => {
      for (const it of items) {
        if (!DOC_SEQUENCE_DEFAULTS[it.docType]) throw Errors.validation(`Loại chứng từ không hợp lệ: ${it.docType}`);
        await tx.documentSequence.upsert({
          where: { tenantId_docType: { tenantId: actor.tenantId, docType: it.docType } },
          create: { tenantId: actor.tenantId, docType: it.docType, prefix: it.prefix, padding: it.padding, resetPolicy: it.resetPolicy },
          update: { prefix: it.prefix, padding: it.padding, resetPolicy: it.resetPolicy },
        });
      }
      await this.audit.log(tx, { action: 'settings.sequences.update', entityType: 'DocumentSequence', before, after: items });
    });
    return this.listSequences();
  }
}
