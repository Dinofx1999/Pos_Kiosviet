import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { CTX } from '../cls/request-context';

/** Models that carry tenant_id and must always be filtered by the current tenant. */
export const TENANT_MODELS = new Set<string>([
  'TenantSetting', 'Branch', 'Warehouse', 'User', 'Role', 'AuditLog', 'DocumentSequence', 'IdempotencyKey',
  'OutboxEvent', 'ProductCategory', 'Brand', 'Unit', 'Product', 'ProductVariant', 'ProductUnit', 'ProductImage',
  'ComboItem', 'ProductBatch', 'PriceBook', 'StockBalance', 'StockMovement', 'CostLedgerEntry', 'StockReservation',
  'InventoryDocument', 'InventoryDocumentLine', 'LoginHistory',
  'Supplier', 'PartyBalance', 'PartyLedgerEntry', 'Payment', 'PaymentAllocation',
  'PurchaseOrder', 'PurchaseOrderLine', 'PurchaseReceipt', 'PurchaseReceiptLine', 'PurchaseReceiptCost', 'PurchaseReturn', 'PurchaseReturnLine',
  'Customer', 'Shift', 'Invoice', 'InvoiceLine', 'SalesReturn', 'SalesReturnLine',
  'CashAccount', 'PaymentCategory', 'CashTransfer', 'CashReconciliation',
  'StockTransfer', 'StockTransferLine', 'Stocktake', 'StocktakeLine',
  'Promotion', 'PromotionVoucher', 'InvoicePromotion',
  'SalesOrder', 'SalesOrderLine', 'Delivery',
  'ImportJob', 'IntegrationConnection', 'CustomerPointEntry', 'CommissionRule', 'Attendance',
]);

export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant context missing for ${model}.${operation}`);
  }
}

/**
 * Prisma client extension: injects tenantId into where/data of every operation on tenant-scoped models.
 * Nested writes are NOT intercepted – services must set tenantId on nested child records explicitly.
 */
export function tenantExtension(cls: ClsService) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args);
          if (cls.isActive() && cls.get(CTX.bypassTenant)) return query(args);
          const tenantId: string | undefined = cls.isActive() ? cls.get(CTX.tenantId) : undefined;
          if (!tenantId) throw new TenantContextMissingError(model, operation);

          const a: any = args ?? {};
          switch (operation) {
            case 'findUnique': case 'findUniqueOrThrow': case 'findFirst': case 'findFirstOrThrow':
            case 'findMany': case 'count': case 'aggregate': case 'groupBy':
            case 'update': case 'updateMany': case 'delete': case 'deleteMany':
              a.where = { ...(a.where ?? {}), tenantId };
              break;
            case 'create':
              a.data = { ...(a.data ?? {}), tenantId };
              break;
            case 'createMany': case 'createManyAndReturn':
              a.data = Array.isArray(a.data) ? a.data.map((d: any) => ({ ...d, tenantId })) : { ...(a.data ?? {}), tenantId };
              break;
            case 'upsert':
              a.where = { ...(a.where ?? {}), tenantId };
              a.create = { ...(a.create ?? {}), tenantId };
              break;
            default:
              break;
          }
          return query(a);
        },
      },
    },
  });
}
