-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "client_ref" VARCHAR(64);

-- CreateTable
CREATE TABLE "flash_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "flash_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sale_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "flash_sale_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sale_price" DECIMAL(18,4) NOT NULL,
    "quantity_limit" INTEGER,
    "per_order_limit" INTEGER,
    "sold_quantity" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flash_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flash_sale_usages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flash_sale_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flash_sales_tenant_id_is_active_ends_at_idx" ON "flash_sales"("tenant_id", "is_active", "ends_at");

-- CreateIndex
CREATE INDEX "flash_sale_items_tenant_id_variant_id_idx" ON "flash_sale_items"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "flash_sale_items_flash_sale_id_variant_id_key" ON "flash_sale_items"("flash_sale_id", "variant_id");

-- CreateIndex
CREATE INDEX "flash_sale_usages_tenant_id_order_id_idx" ON "flash_sale_usages"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenant_id_client_ref_key" ON "sales_orders"("tenant_id", "client_ref");

-- AddForeignKey
ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_flash_sale_id_fkey" FOREIGN KEY ("flash_sale_id") REFERENCES "flash_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_usages" ADD CONSTRAINT "flash_sale_usages_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "flash_sale_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flash_sale_usages" ADD CONSTRAINT "flash_sale_usages_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

