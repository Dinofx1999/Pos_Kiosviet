-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShortageAction" AS ENUM ('WRITE_OFF', 'RETURN_TO_SOURCE');

-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "note" VARCHAR(1000),
    "total_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "received_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "shortage_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "shortage_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shortage_action" "ShortageAction",
    "receive_note" VARCHAR(1000),
    "dispatched_at" TIMESTAMPTZ(6),
    "dispatched_by_id" UUID,
    "received_at" TIMESTAMPTZ(6),
    "received_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "received_quantity" DECIMAL(18,3),
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" VARCHAR(500),

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" VARCHAR(20) NOT NULL DEFAULT 'SELECTED',
    "note" VARCHAR(1000),
    "snapshot_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_lines" INTEGER NOT NULL DEFAULT 0,
    "counted_lines" INTEGER NOT NULL DEFAULT 0,
    "increase_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "decrease_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "increase_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "decrease_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "uncounted_as" VARCHAR(10),
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "stocktake_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "batch_key" VARCHAR(36) NOT NULL DEFAULT '',
    "system_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "counted_quantity" DECIMAL(18,3),
    "delta_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "delta_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "counted_by_id" UUID,
    "counted_at" TIMESTAMPTZ(6),
    "note" VARCHAR(500),

    CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_status_created_at_idx" ON "stock_transfers"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_from_warehouse_id_created_at_idx" ON "stock_transfers"("tenant_id", "from_warehouse_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_to_warehouse_id_created_at_idx" ON "stock_transfers"("tenant_id", "to_warehouse_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_code_key" ON "stock_transfers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_tenant_id_transfer_id_idx" ON "stock_transfer_lines"("tenant_id", "transfer_id");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_tenant_id_variant_id_idx" ON "stock_transfer_lines"("tenant_id", "variant_id");

-- CreateIndex
CREATE INDEX "stocktakes_tenant_id_status_created_at_idx" ON "stocktakes"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "stocktakes_tenant_id_warehouse_id_created_at_idx" ON "stocktakes"("tenant_id", "warehouse_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stocktakes_tenant_id_code_key" ON "stocktakes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "stocktake_lines_tenant_id_stocktake_id_idx" ON "stocktake_lines"("tenant_id", "stocktake_id");

-- CreateIndex
CREATE INDEX "stocktake_lines_tenant_id_variant_id_idx" ON "stocktake_lines"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_lines_stocktake_id_variant_id_batch_key_key" ON "stocktake_lines"("stocktake_id", "variant_id", "batch_key");

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktake_id_fkey" FOREIGN KEY ("stocktake_id") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
