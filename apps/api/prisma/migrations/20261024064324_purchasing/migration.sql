-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('SUPPLIER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('PURCHASE', 'PURCHASE_RETURN', 'PAYMENT', 'REFUND', 'SALE', 'SALE_RETURN', 'RECEIPT', 'ADJUSTMENT', 'OPENING', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'EWALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseDocStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CostAllocationMethod" AS ENUM ('BY_VALUE', 'BY_QUANTITY');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(200),
    "address" VARCHAR(500),
    "tax_code" VARCHAR(50),
    "contact_name" VARCHAR(200),
    "note" VARCHAR(1000),
    "group_name" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_balances" (
    "tenant_id" UUID NOT NULL,
    "party_type" "PartyType" NOT NULL,
    "party_id" UUID NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "party_balances_pkey" PRIMARY KEY ("tenant_id","party_type","party_id")
);

-- CreateTable
CREATE TABLE "party_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "party_type" "PartyType" NOT NULL,
    "party_id" UUID NOT NULL,
    "branch_id" UUID,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "balance_after" DECIMAL(18,4) NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "document_id" UUID NOT NULL,
    "document_code" VARCHAR(50) NOT NULL,
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "party_type" "PartyType",
    "party_id" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "allocated" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "payment_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" VARCHAR(200),
    "note" VARCHAR(1000),
    "status" "PaymentStatus" NOT NULL DEFAULT 'POSTED',
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "document_id" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_date" TIMESTAMPTZ(6),
    "note" VARCHAR(1000),
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "received_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "note" VARCHAR(500),

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "order_id" UUID,
    "code" VARCHAR(50) NOT NULL,
    "status" "PurchaseDocStatus" NOT NULL DEFAULT 'DRAFT',
    "receipt_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_invoice_no" VARCHAR(100),
    "note" VARCHAR(1000),
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "landed_cost_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "returned_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "order_line_id" UUID,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "returned_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "allocated_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" VARCHAR(500),

    CONSTRAINT "purchase_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_costs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "allocation_method" "CostAllocationMethod" NOT NULL DEFAULT 'BY_VALUE',
    "pay_to_supplier" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "purchase_receipt_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "status" "PurchaseDocStatus" NOT NULL DEFAULT 'DRAFT',
    "return_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(200),
    "note" VARCHAR(1000),
    "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "receipt_line_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "line_total" DECIMAL(18,4) NOT NULL,
    "note" VARCHAR(500),

    CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_name_idx" ON "suppliers"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "suppliers_tenant_id_phone_idx" ON "suppliers"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenant_id_code_key" ON "suppliers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "party_ledger_entries_tenant_id_party_type_party_id_created__idx" ON "party_ledger_entries"("tenant_id", "party_type", "party_id", "created_at");

-- CreateIndex
CREATE INDEX "party_ledger_entries_tenant_id_document_type_document_id_idx" ON "party_ledger_entries"("tenant_id", "document_type", "document_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_party_type_party_id_payment_date_idx" ON "payments"("tenant_id", "party_type", "party_id", "payment_date");

-- CreateIndex
CREATE INDEX "payments_tenant_id_branch_id_payment_date_idx" ON "payments"("tenant_id", "branch_id", "payment_date");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_code_key" ON "payments"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "payment_allocations_tenant_id_document_type_document_id_idx" ON "payment_allocations"("tenant_id", "document_type", "document_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_status_order_date_idx" ON "purchase_orders"("tenant_id", "status", "order_date");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_supplier_id_idx" ON "purchase_orders"("tenant_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_code_key" ON "purchase_orders"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_order_id_idx" ON "purchase_order_lines"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "purchase_receipts_tenant_id_status_receipt_date_idx" ON "purchase_receipts"("tenant_id", "status", "receipt_date");

-- CreateIndex
CREATE INDEX "purchase_receipts_tenant_id_supplier_id_receipt_date_idx" ON "purchase_receipts"("tenant_id", "supplier_id", "receipt_date");

-- CreateIndex
CREATE INDEX "purchase_receipts_tenant_id_warehouse_id_idx" ON "purchase_receipts"("tenant_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_tenant_id_code_key" ON "purchase_receipts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "purchase_receipt_lines_tenant_id_receipt_id_idx" ON "purchase_receipt_lines"("tenant_id", "receipt_id");

-- CreateIndex
CREATE INDEX "purchase_receipt_lines_tenant_id_variant_id_idx" ON "purchase_receipt_lines"("tenant_id", "variant_id");

-- CreateIndex
CREATE INDEX "purchase_receipt_costs_tenant_id_receipt_id_idx" ON "purchase_receipt_costs"("tenant_id", "receipt_id");

-- CreateIndex
CREATE INDEX "purchase_returns_tenant_id_status_return_date_idx" ON "purchase_returns"("tenant_id", "status", "return_date");

-- CreateIndex
CREATE INDEX "purchase_returns_tenant_id_receipt_id_idx" ON "purchase_returns"("tenant_id", "receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_tenant_id_code_key" ON "purchase_returns"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "purchase_return_lines_tenant_id_return_id_idx" ON "purchase_return_lines"("tenant_id", "return_id");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_balances" ADD CONSTRAINT "party_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_ledger_entries" ADD CONSTRAINT "party_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_costs" ADD CONSTRAINT "purchase_receipt_costs_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_receipt_line_id_fkey" FOREIGN KEY ("receipt_line_id") REFERENCES "purchase_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
