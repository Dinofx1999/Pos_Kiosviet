-- CreateEnum
CREATE TYPE "CommissionBasis" AS ENUM ('REVENUE', 'GROSS_PROFIT', 'QUANTITY');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "plan_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "plan_note" VARCHAR(500),
ADD COLUMN     "trial_ends_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "base_salary" DECIMAL(18,4),
ADD COLUMN     "employee_note" VARCHAR(1000),
ADD COLUMN     "hired_at" DATE,
ADD COLUMN     "position" VARCHAR(100);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "user_id" UUID,
    "category_id" UUID,
    "variant_id" UUID,
    "basis" "CommissionBasis" NOT NULL DEFAULT 'REVENUE',
    "rate" DECIMAL(18,4) NOT NULL,
    "min_revenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID,
    "check_in_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "check_out_at" TIMESTAMPTZ(6),
    "minutes" INTEGER,
    "source" VARCHAR(20) NOT NULL DEFAULT 'APP',
    "note" VARCHAR(500),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "edited_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_rules_tenant_id_is_active_idx" ON "commission_rules"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "attendances_tenant_id_user_id_check_in_at_idx" ON "attendances"("tenant_id", "user_id", "check_in_at");

-- CreateIndex
CREATE INDEX "attendances_tenant_id_check_in_at_idx" ON "attendances"("tenant_id", "check_in_at");

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
