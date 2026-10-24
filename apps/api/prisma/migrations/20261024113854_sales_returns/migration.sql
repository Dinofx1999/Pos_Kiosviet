-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('RESTOCK', 'DAMAGED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'OFFSET';

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "customer_id" UUID,
    "shift_id" UUID,
    "exchange_invoice_id" UUID,
    "code" VARCHAR(50) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "return_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(200),
    "note" VARCHAR(1000),
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "fee_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_refund" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "restock_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "damaged_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "unit_name" VARCHAR(50),
    "conversion_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "quantity" DECIMAL(18,3) NOT NULL,
    "base_quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "line_total" DECIMAL(18,4) NOT NULL,
    "condition" "ReturnCondition" NOT NULL DEFAULT 'RESTOCK',
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" VARCHAR(500),

    CONSTRAINT "sales_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_returns_tenant_id_status_return_date_idx" ON "sales_returns"("tenant_id", "status", "return_date");

-- CreateIndex
CREATE INDEX "sales_returns_tenant_id_invoice_id_idx" ON "sales_returns"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "sales_returns_tenant_id_customer_id_return_date_idx" ON "sales_returns"("tenant_id", "customer_id", "return_date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_tenant_id_code_key" ON "sales_returns"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "sales_return_lines_tenant_id_return_id_idx" ON "sales_return_lines"("tenant_id", "return_id");

-- CreateIndex
CREATE INDEX "sales_return_lines_tenant_id_variant_id_idx" ON "sales_return_lines"("tenant_id", "variant_id");

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_exchange_invoice_id_fkey" FOREIGN KEY ("exchange_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
