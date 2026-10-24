-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('INVOICE_DISCOUNT', 'INVOICE_GIFT', 'PRODUCT_DISCOUNT', 'BUY_X_GET_Y', 'VOUCHER');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'USED', 'DISABLED');

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "is_gift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "promotion_discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "promotion_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "promotion_discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "voucher_code" VARCHAR(50);

-- AlterTable
ALTER TABLE "price_books" ADD COLUMN     "customer_groups" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "PromotionType" NOT NULL,
    "status" "PromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" VARCHAR(1000),
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "days_of_week" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "time_from" VARCHAR(5),
    "time_to" VARCHAR(5),
    "customer_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "usage_limit" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "per_customer_limit" INTEGER,
    "config" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_branches" (
    "promotion_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "promotion_branches_pkey" PRIMARY KEY ("promotion_id","branch_id")
);

-- CreateTable
CREATE TABLE "promotion_vouchers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "customer_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_promotions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "voucher_id" UUID,
    "type" "PromotionType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gift_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_tenant_id_status_type_idx" ON "promotions"("tenant_id", "status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_tenant_id_code_key" ON "promotions"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "promotion_vouchers_tenant_id_promotion_id_status_idx" ON "promotion_vouchers"("tenant_id", "promotion_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_vouchers_tenant_id_code_key" ON "promotion_vouchers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "invoice_promotions_tenant_id_promotion_id_created_at_idx" ON "invoice_promotions"("tenant_id", "promotion_id", "created_at");

-- CreateIndex
CREATE INDEX "invoice_promotions_tenant_id_invoice_id_idx" ON "invoice_promotions"("tenant_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_branches" ADD CONSTRAINT "promotion_branches_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_branches" ADD CONSTRAINT "promotion_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_vouchers" ADD CONSTRAINT "promotion_vouchers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_vouchers" ADD CONSTRAINT "promotion_vouchers_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_promotions" ADD CONSTRAINT "invoice_promotions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_promotions" ADD CONSTRAINT "invoice_promotions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_promotions" ADD CONSTRAINT "invoice_promotions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_promotions" ADD CONSTRAINT "invoice_promotions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "promotion_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
