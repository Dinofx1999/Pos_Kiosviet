-- CreateEnum
CREATE TYPE "PointEntryType" AS ENUM ('EARN', 'REDEEM', 'ADJUST', 'REVERSAL', 'EXPIRE');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'POINTS';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "points" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "points_earned" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "points_redeemed" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "points_value" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customer_point_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "PointEntryType" NOT NULL,
    "points" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "document_type" VARCHAR(50),
    "document_id" UUID,
    "document_code" VARCHAR(50),
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_point_entries_tenant_id_customer_id_created_at_idx" ON "customer_point_entries"("tenant_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_point_entries_tenant_id_document_type_document_id_idx" ON "customer_point_entries"("tenant_id", "document_type", "document_id");

-- AddForeignKey
ALTER TABLE "customer_point_entries" ADD CONSTRAINT "customer_point_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_point_entries" ADD CONSTRAINT "customer_point_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
