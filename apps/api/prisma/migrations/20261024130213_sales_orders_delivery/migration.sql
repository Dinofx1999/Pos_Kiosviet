-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PICKING', 'DELIVERING', 'DELIVERED', 'RETURNING', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "customer_id" UUID,
    "seller_id" UUID,
    "price_book_id" UUID,
    "invoice_id" UUID,
    "code" VARCHAR(50) NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "source" VARCHAR(30) NOT NULL DEFAULT 'POS',
    "order_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_at" TIMESTAMPTZ(6),
    "note" VARCHAR(1000),
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "deposit_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "product_unit_id" UUID,
    "unit_name" VARCHAR(50),
    "conversion_factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "quantity" DECIMAL(18,3) NOT NULL,
    "base_quantity" DECIMAL(18,3) NOT NULL,
    "list_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "note" VARCHAR(500),

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "order_id" UUID,
    "invoice_id" UUID,
    "customer_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "receiver_name" VARCHAR(200) NOT NULL,
    "receiver_phone" VARCHAR(30),
    "address" VARCHAR(500) NOT NULL,
    "ward" VARCHAR(100),
    "district" VARCHAR(100),
    "province" VARCHAR(100),
    "carrier" VARCHAR(100),
    "tracking_code" VARCHAR(100),
    "shipping_fee" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "shipping_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cod_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cod_collected" BOOLEAN NOT NULL DEFAULT false,
    "weight_gram" INTEGER,
    "note" VARCHAR(1000),
    "expected_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_invoice_id_key" ON "sales_orders"("invoice_id");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_status_order_date_idx" ON "sales_orders"("tenant_id", "status", "order_date");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_customer_id_idx" ON "sales_orders"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenant_id_code_key" ON "sales_orders"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "sales_order_lines_tenant_id_order_id_idx" ON "sales_order_lines"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "sales_order_lines_tenant_id_variant_id_idx" ON "sales_order_lines"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_order_id_key" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_tenant_id_status_created_at_idx" ON "deliveries"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "deliveries_tenant_id_invoice_id_idx" ON "deliveries"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_tenant_id_code_key" ON "deliveries"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "delivery_events_delivery_id_created_at_idx" ON "delivery_events"("delivery_id", "created_at");

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
