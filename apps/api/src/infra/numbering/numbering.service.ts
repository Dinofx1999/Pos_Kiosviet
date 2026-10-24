import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DOC_SEQUENCE_DEFAULTS } from '@erp/shared';
import { ClsService } from 'nestjs-cls';
import { CTX } from '../cls/request-context';
import { DbClient } from '../prisma/prisma.service';
import { formatCode, periodKey, ResetPolicy } from './numbering';

interface SeqRow { id: string; prefix: string; padding: number; next_number: bigint; reset_policy: ResetPolicy; period_key: string }

@Injectable()
export class NumberingService {
  constructor(private readonly cls: ClsService) {}

  /**
   * Returns the next document code for docType. MUST be called inside the caller's transaction
   * so the row lock (FOR UPDATE) is held until commit → no duplicates, no gaps on rollback races.
   */
  async next(tx: DbClient, docType: string, tenantIdOverride?: string): Promise<string> {
    const tenantId = tenantIdOverride ?? (this.cls.get(CTX.tenantId) as string);
    const def = DOC_SEQUENCE_DEFAULTS[docType] ?? { prefix: docType.slice(0, 2).toUpperCase(), padding: 6 };
    await tx.$executeRaw`INSERT INTO document_sequences (id, tenant_id, doc_type, prefix, padding, next_number, reset_policy, period_key, updated_at)
      VALUES (gen_random_uuid(), ${tenantId}::uuid, ${docType}, ${def.prefix}, ${def.padding}, 1, 'NEVER', '', now())
      ON CONFLICT (tenant_id, doc_type) DO NOTHING`;
    const rows = await tx.$queryRaw<SeqRow[]>`SELECT id, prefix, padding, next_number, reset_policy, period_key
      FROM document_sequences WHERE tenant_id = ${tenantId}::uuid AND doc_type = ${docType} FOR UPDATE`;
    const row = rows[0];
    const now = new Date();
    const period = periodKey(row.reset_policy, now);
    let n = row.next_number;
    if (row.reset_policy !== 'NEVER' && row.period_key !== period) n = BigInt(1);
    const code = formatCode(row.prefix, row.reset_policy, period, n, row.padding);
    await tx.$executeRaw`UPDATE document_sequences SET next_number = ${n + BigInt(1)}, period_key = ${period}, updated_at = now() WHERE id = ${row.id}::uuid`;
    return code;
  }

  /** Ensures a code is unique for the given table/column; used when the user supplies a code manually. */
  async assertUnique(tx: DbClient, table: 'products' | 'inventory_documents', code: string, tenantId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS c FROM ${Prisma.raw(table)} WHERE tenant_id = ${tenantId}::uuid AND code = ${code}`,
    );
    return Number(rows[0].c) === 0;
  }
}
