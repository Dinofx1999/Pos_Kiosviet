-- CreateEnum
CREATE TYPE "CashAccountType" AS ENUM ('CASH', 'BANK', 'EWALLET');

-- CreateEnum
CREATE TYPE "CashTransferStatus" AS ENUM ('POSTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cash_account_id" UUID,
ADD COLUMN     "category_id" UUID,
ADD COLUMN     "transfer_id" UUID;

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "CashAccountType" NOT NULL DEFAULT 'CASH',
    "bank_name" VARCHAR(200),
    "account_number" VARCHAR(100),
    "account_holder" VARCHAR(200),
    "opening_balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "shift_id" UUID,
    "note" VARCHAR(1000),
    "status" "CashTransferStatus" NOT NULL DEFAULT 'POSTED',
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "book_balance" DECIMAL(18,4) NOT NULL,
    "counted_balance" DECIMAL(18,4) NOT NULL,
    "difference" DECIMAL(18,4) NOT NULL,
    "note" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_accounts_tenant_id_branch_id_type_idx" ON "cash_accounts"("tenant_id", "branch_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_tenant_id_code_key" ON "cash_accounts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_categories_tenant_id_direction_name_key" ON "payment_categories"("tenant_id", "direction", "name");

-- CreateIndex
CREATE INDEX "cash_transfers_tenant_id_branch_id_created_at_idx" ON "cash_transfers"("tenant_id", "branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transfers_tenant_id_code_key" ON "cash_transfers"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "cash_reconciliations_tenant_id_account_id_created_at_idx" ON "cash_reconciliations"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_cash_account_id_payment_date_idx" ON "payments"("tenant_id", "cash_account_id", "payment_date");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "payment_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "cash_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_categories" ADD CONSTRAINT "payment_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
