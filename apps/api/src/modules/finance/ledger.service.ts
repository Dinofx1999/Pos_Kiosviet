import { Injectable } from '@nestjs/common';
import { LedgerEntryType, PartyType, Prisma } from '@prisma/client';
import { Errors } from '../../common/errors/app-error';
import { D, money } from '../../common/utils/decimal';
import { DbClient, TxClient } from '../../infra/prisma/prisma.service';

export interface LedgerPost {
  tenantId: string;
  partyType: PartyType;
  partyId: string;
  branchId?: string | null;
  type: LedgerEntryType;
  /** signed: + increases the party balance (we owe supplier / customer owes us), − decreases */
  amount: Prisma.Decimal;
  documentType: string;
  documentId: string;
  documentCode: string;
  note?: string | null;
  userId?: string | null;
}

/**
 * Debt ledger (BR-07): the only writer of party_ledger_entries / party_balances.
 * Lock order inside a transaction: party_balances row → (caller's document rows are locked before calling).
 */
@Injectable()
export class LedgerService {
  async lockBalance(tx: TxClient, tenantId: string, partyType: PartyType, partyId: string): Promise<Prisma.Decimal> {
    await tx.$executeRaw`INSERT INTO party_balances (tenant_id, party_type, party_id, balance, updated_at)
      VALUES (${tenantId}::uuid, ${partyType}::"PartyType", ${partyId}::uuid, 0, now()) ON CONFLICT (tenant_id, party_type, party_id) DO NOTHING`;
    const rows = await tx.$queryRaw<{ balance: Prisma.Decimal }[]>`SELECT balance FROM party_balances
      WHERE tenant_id = ${tenantId}::uuid AND party_type = ${partyType}::"PartyType" AND party_id = ${partyId}::uuid FOR UPDATE`;
    return D(rows[0].balance);
  }

  async post(tx: TxClient, p: LedgerPost) {
    const amount = money(p.amount);
    if (amount.isZero()) throw Errors.validation('Số tiền ghi sổ công nợ phải khác 0');
    const before = await this.lockBalance(tx, p.tenantId, p.partyType, p.partyId);
    const after = before.plus(amount);
    await tx.$executeRaw`UPDATE party_balances SET balance = ${after.toString()}::numeric, updated_at = now()
      WHERE tenant_id = ${p.tenantId}::uuid AND party_type = ${p.partyType}::"PartyType" AND party_id = ${p.partyId}::uuid`;
    return tx.partyLedgerEntry.create({
      data: {
        tenantId: p.tenantId, partyType: p.partyType, partyId: p.partyId, branchId: p.branchId ?? null, type: p.type, amount, balanceAfter: after,
        documentType: p.documentType, documentId: p.documentId, documentCode: p.documentCode, note: p.note ?? null, createdById: p.userId ?? null,
      },
    });
  }

  /** Posts a REVERSAL that negates every non-reversal entry of a document (used when cancelling posted documents). */
  async reverseDocument(tx: TxClient, tenantId: string, documentType: string, documentId: string, documentCode: string, note: string, userId?: string | null) {
    const entries = await tx.partyLedgerEntry.findMany({ where: { documentType, documentId, type: { not: 'REVERSAL' } } });
    const reversed = await tx.partyLedgerEntry.findMany({ where: { documentType, documentId, type: 'REVERSAL' } });
    const net = entries.reduce((s, e) => s.plus(D(e.amount)), D(0)).plus(reversed.reduce((s, e) => s.plus(D(e.amount)), D(0)));
    if (net.isZero() || entries.length === 0) return null;
    const first = entries[0];
    return this.post(tx, { tenantId, partyType: first.partyType, partyId: first.partyId, branchId: first.branchId, type: 'REVERSAL', amount: net.negated(), documentType, documentId, documentCode, note, userId });
  }

  async balance(db: DbClient, partyType: PartyType, partyId: string): Promise<Prisma.Decimal> {
    const row = await db.partyBalance.findFirst({ where: { partyType, partyId } });
    return row ? D(row.balance) : D(0);
  }

  /** Balances for many parties at once (listing). */
  async balances(db: DbClient, partyType: PartyType, partyIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    if (!partyIds.length) return new Map();
    const rows = await db.partyBalance.findMany({ where: { partyType, partyId: { in: partyIds } } });
    return new Map(rows.map((r) => [r.partyId, D(r.balance)]));
  }

  /** BR-07 reconciliation: cached balance vs Σ ledger. */
  async reconcile(tx: DbClient, tenantId: string) {
    return tx.$queryRaw<Array<{ party_type: string; party_id: string; balance: Prisma.Decimal; ledger: Prisma.Decimal }>>`
      WITH l AS (SELECT party_type, party_id, SUM(amount) AS ledger FROM party_ledger_entries WHERE tenant_id = ${tenantId}::uuid GROUP BY 1,2)
      SELECT b.party_type::text, b.party_id, b.balance, COALESCE(l.ledger,0) AS ledger FROM party_balances b
      LEFT JOIN l ON l.party_type = b.party_type AND l.party_id = b.party_id
      WHERE b.tenant_id = ${tenantId}::uuid AND b.balance <> COALESCE(l.ledger,0)`;
  }
}
