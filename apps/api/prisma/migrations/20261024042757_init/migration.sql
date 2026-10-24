-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "SequenceResetPolicy" AS ENUM ('NEVER', 'YEARLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('GOODS', 'SERVICE', 'COMBO');

-- CreateEnum
CREATE TYPE "PriceBookStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'REVERSAL', 'PURCHASE', 'PURCHASE_RETURN', 'SALE', 'SALE_RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'STOCKTAKE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "InventoryDocType" AS ENUM ('RECEIPT', 'ISSUE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InventoryDocStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "plan_code" VARCHAR(50) NOT NULL DEFAULT 'FREE',
    "industry" VARCHAR(100),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "currency" VARCHAR(10) NOT NULL DEFAULT 'VND',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" VARCHAR(500),
    "phone" VARCHAR(30),
    "email" VARCHAR(200),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "username" VARCHAR(100) NOT NULL,
    "email" VARCHAR(200),
    "phone" VARCHAR(30),
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "all_branches" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("user_id","branch_id")
);

-- CreateTable
CREATE TABLE "user_warehouse_access" (
    "user_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,

    CONSTRAINT "user_warehouse_access_pkey" PRIMARY KEY ("user_id","warehouse_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(500),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "user_id" UUID,
    "username" VARCHAR(100) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" VARCHAR(200),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "username" VARCHAR(100),
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(64),
    "entity_code" VARCHAR(100),
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "doc_type" VARCHAR(50) NOT NULL,
    "prefix" VARCHAR(20) NOT NULL,
    "padding" INTEGER NOT NULL DEFAULT 6,
    "next_number" BIGINT NOT NULL DEFAULT 1,
    "reset_policy" "SequenceResetPolicy" NOT NULL DEFAULT 'NEVER',
    "period_key" VARCHAR(10) NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "scope" VARCHAR(200) NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "request_hash" VARCHAR(128) NOT NULL,
    "status_code" INTEGER,
    "response_body" JSONB,
    "locked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "type" "ProductType" NOT NULL DEFAULT 'GOODS',
    "category_id" UUID,
    "brand_id" UUID,
    "base_unit" VARCHAR(50),
    "description" TEXT,
    "tax_rate" DECIMAL(5,2),
    "weight" DECIMAL(12,3),
    "track_batch" BOOLEAN NOT NULL DEFAULT false,
    "track_serial" BOOLEAN NOT NULL DEFAULT false,
    "allow_sale" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "has_variants" BOOLEAN NOT NULL DEFAULT false,
    "attribute_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "image_url" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "barcode" VARCHAR(80),
    "name" VARCHAR(400) NOT NULL,
    "attributes" JSONB,
    "sell_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cost_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "last_purchase_price" DECIMAL(18,4),
    "on_hand_total" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "min_stock" DECIMAL(18,3),
    "max_stock" DECIMAL(18,3),
    "weight" DECIMAL(12,3),
    "image_url" VARCHAR(1000),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_name" VARCHAR(50) NOT NULL,
    "conversion_factor" DECIMAL(18,6) NOT NULL,
    "sku" VARCHAR(80),
    "barcode" VARCHAR(80),
    "sell_price" DECIMAL(18,4),
    "is_direct_sale" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "url" VARCHAR(1000) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "combo_product_id" UUID NOT NULL,
    "component_variant_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "combo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_no" VARCHAR(100) NOT NULL,
    "mfg_date" DATE,
    "expiry_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "PriceBookStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "price_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_book_items" (
    "price_book_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "min_quantity" DECIMAL(18,3) NOT NULL DEFAULT 1,

    CONSTRAINT "price_book_items_pkey" PRIMARY KEY ("price_book_id","variant_id","min_quantity")
);

-- CreateTable
CREATE TABLE "price_book_branches" (
    "price_book_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "price_book_branches_pkey" PRIMARY KEY ("price_book_id","branch_id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "batch_key" VARCHAR(36) NOT NULL DEFAULT '',
    "on_hand" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "incoming" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(18,3) NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "document_id" UUID NOT NULL,
    "document_code" VARCHAR(50) NOT NULL,
    "line_id" UUID,
    "reason" VARCHAR(50),
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "quantity_delta" DECIMAL(18,3) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "value_delta" DECIMAL(18,4) NOT NULL,
    "qty_before" DECIMAL(18,3) NOT NULL,
    "qty_after" DECIMAL(18,3) NOT NULL,
    "avg_cost_before" DECIMAL(18,4) NOT NULL,
    "avg_cost_after" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "document_type" VARCHAR(50) NOT NULL,
    "document_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "type" "InventoryDocType" NOT NULL,
    "status" "InventoryDocStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" VARCHAR(50),
    "note" VARCHAR(1000),
    "total_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "posted_at" TIMESTAMPTZ(6),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_document_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity" DECIMAL(18,3) NOT NULL,
    "system_quantity" DECIMAL(18,3),
    "actual_quantity" DECIMAL(18,3),
    "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" VARCHAR(500),

    CONSTRAINT "inventory_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "branches_tenant_id_is_active_idx" ON "branches"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "branches"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "warehouses_tenant_id_branch_id_idx" ON "warehouses"("tenant_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_code_key" ON "warehouses"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_username_key" ON "users"("tenant_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_expires_at_idx" ON "refresh_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "login_history_tenant_id_created_at_idx" ON "login_history"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "login_history_user_id_created_at_idx" ON "login_history"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_user_id_created_at_idx" ON "audit_logs"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_tenant_id_doc_type_key" ON "document_sequences"("tenant_id", "doc_type");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenant_id_scope_key_key" ON "idempotency_keys"("tenant_id", "scope", "key");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_tenant_id_aggregate_type_aggregate_id_idx" ON "outbox_events"("tenant_id", "aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "product_categories_tenant_id_parent_id_idx" ON "product_categories"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_tenant_id_name_key" ON "brands"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenant_id_name_key" ON "units"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "products_tenant_id_name_idx" ON "products"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_brand_id_idx" ON "products"("tenant_id", "brand_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_is_active_deleted_at_idx" ON "products"("tenant_id", "is_active", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_code_key" ON "products"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "product_variants_tenant_id_product_id_idx" ON "product_variants"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "product_variants_tenant_id_name_idx" ON "product_variants"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_sku_key" ON "product_variants"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_barcode_key" ON "product_variants"("tenant_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_tenant_id_product_id_unit_name_key" ON "product_units"("tenant_id", "product_id", "unit_name");

-- CreateIndex
CREATE INDEX "product_images_tenant_id_product_id_idx" ON "product_images"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "combo_items_combo_product_id_component_variant_id_key" ON "combo_items"("combo_product_id", "component_variant_id");

-- CreateIndex
CREATE INDEX "product_batches_tenant_id_expiry_date_idx" ON "product_batches"("tenant_id", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "product_batches_tenant_id_variant_id_batch_no_key" ON "product_batches"("tenant_id", "variant_id", "batch_no");

-- CreateIndex
CREATE UNIQUE INDEX "price_books_tenant_id_code_key" ON "price_books"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "stock_balances_tenant_id_variant_id_idx" ON "stock_balances"("tenant_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_balances_tenant_id_warehouse_id_idx" ON "stock_balances"("tenant_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_tenant_id_warehouse_id_variant_id_batch_key_key" ON "stock_balances"("tenant_id", "warehouse_id", "variant_id", "batch_key");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_variant_id_created_at_idx" ON "stock_movements"("tenant_id", "variant_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_warehouse_id_variant_id_created_a_idx" ON "stock_movements"("tenant_id", "warehouse_id", "variant_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_document_type_document_id_idx" ON "stock_movements"("tenant_id", "document_type", "document_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_created_at_idx" ON "stock_movements"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "cost_ledger_entries_tenant_id_variant_id_created_at_idx" ON "cost_ledger_entries"("tenant_id", "variant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cost_ledger_entries_movement_id_key" ON "cost_ledger_entries"("movement_id");

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_warehouse_id_variant_id_status_idx" ON "stock_reservations"("tenant_id", "warehouse_id", "variant_id", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_document_type_document_id_idx" ON "stock_reservations"("tenant_id", "document_type", "document_id");

-- CreateIndex
CREATE INDEX "inventory_documents_tenant_id_type_status_created_at_idx" ON "inventory_documents"("tenant_id", "type", "status", "created_at");

-- CreateIndex
CREATE INDEX "inventory_documents_tenant_id_warehouse_id_created_at_idx" ON "inventory_documents"("tenant_id", "warehouse_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_documents_tenant_id_code_key" ON "inventory_documents"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "inventory_document_lines_tenant_id_document_id_idx" ON "inventory_document_lines"("tenant_id", "document_id");

-- CreateIndex
CREATE INDEX "inventory_document_lines_tenant_id_variant_id_idx" ON "inventory_document_lines"("tenant_id", "variant_id");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warehouse_access" ADD CONSTRAINT "user_warehouse_access_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_combo_product_id_fkey" FOREIGN KEY ("combo_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_component_variant_id_fkey" FOREIGN KEY ("component_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_price_book_id_fkey" FOREIGN KEY ("price_book_id") REFERENCES "price_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_items" ADD CONSTRAINT "price_book_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_branches" ADD CONSTRAINT "price_book_branches_price_book_id_fkey" FOREIGN KEY ("price_book_id") REFERENCES "price_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_book_branches" ADD CONSTRAINT "price_book_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_ledger_entries" ADD CONSTRAINT "cost_ledger_entries_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
