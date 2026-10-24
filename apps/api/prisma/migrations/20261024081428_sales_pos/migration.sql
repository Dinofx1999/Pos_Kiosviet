-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "shift_id" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "phone" VARCHAR(30),
    "email" VARCHAR(200),
    "address" VARCHAR(500),
    "gender" VARCHAR(10),
    "birthday" DATE,
    "tax_code" VARCHAR(50),
    "group_name" VARCHAR(100),
    "note" VARCHAR(1000),
    "credit_limit" DECIMAL(18,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "opening_cash" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expected_cash" DECIMAL(18,4),
    "counted_cash" DECIMAL(18,4),
    "difference" DECIMAL(18,4),
    "note" VARCHAR(1000),
    "closed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "customer_id" UUID,
    "shift_id" UUID,
    "seller_id" UUID,
    "price_book_id" UUID,
    "code" VARCHAR(50) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoice_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "returned_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "product_unit_id" UUID,
    "unit_name" VARCHAR(50),
    "conversion_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "quantity" DECIMAL(18,3) NOT NULL,
    "base_quantity" DECIMAL(18,3) NOT NULL,
    "returned_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "list_price" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" VARCHAR(500),

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenant_id_name_idx" ON "customers"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "customers_tenant_id_phone_idx" ON "customers"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_code_key" ON "customers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_branch_id_status_idx" ON "shifts"("tenant_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_user_id_status_idx" ON "shifts"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_code_key" ON "shifts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_invoice_date_idx" ON "invoices"("tenant_id", "status", "invoice_date");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_branch_id_invoice_date_idx" ON "invoices"("tenant_id", "branch_id", "invoice_date");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_customer_id_invoice_date_idx" ON "invoices"("tenant_id", "customer_id", "invoice_date");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_seller_id_invoice_date_idx" ON "invoices"("tenant_id", "seller_id", "invoice_date");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_shift_id_idx" ON "invoices"("tenant_id", "shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_code_key" ON "invoices"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_invoice_id_idx" ON "invoice_lines"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_variant_id_idx" ON "invoice_lines"("tenant_id", "variant_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_shift_id_idx" ON "payments"("tenant_id", "shift_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
