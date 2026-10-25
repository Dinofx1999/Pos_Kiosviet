-- CreateEnum
CREATE TYPE "BankRequestPurpose" AS ENUM ('POS', 'INVOICE', 'SALES_ORDER');

-- CreateEnum
CREATE TYPE "BankRequestStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "bank_gateway_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'SEPAY',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "bank_code" VARCHAR(40),
    "account_number" VARCHAR(40),
    "account_name" VARCHAR(120),
    "cash_account_id" UUID,
    "code_prefix" VARCHAR(5) NOT NULL DEFAULT 'BA',
    "pos_ttl_minutes" INTEGER NOT NULL DEFAULT 15,
    "webhook_key_hash" VARCHAR(64),
    "webhook_key_last4" VARCHAR(4),
    "last_webhook_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_gateway_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transfer_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "purpose" "BankRequestPurpose" NOT NULL,
    "status" "BankRequestStatus" NOT NULL DEFAULT 'PENDING',
    "branch_id" UUID NOT NULL,
    "document_id" UUID,
    "document_code" VARCHAR(50),
    "customer_id" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "used_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "cash_account_id" UUID,
    "bank_code" VARCHAR(40) NOT NULL,
    "account_number" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(120),
    "note" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "consumed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'SEPAY',
    "external_id" VARCHAR(64) NOT NULL,
    "gateway" VARCHAR(60),
    "account_number" VARCHAR(40),
    "sub_account" VARCHAR(40),
    "transfer_type" VARCHAR(5) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "accumulated" DECIMAL(18,4),
    "content" VARCHAR(1000),
    "code" VARCHAR(60),
    "reference_code" VARCHAR(120),
    "description" VARCHAR(1000),
    "transaction_date" TIMESTAMPTZ(6) NOT NULL,
    "raw" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNMATCHED',
    "request_id" UUID,
    "payment_id" UUID,
    "match_note" VARCHAR(500),
    "handled_by_id" UUID,
    "handled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_gateway_configs_webhook_key_hash_key" ON "bank_gateway_configs"("webhook_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "bank_gateway_configs_tenant_id_provider_key" ON "bank_gateway_configs"("tenant_id", "provider");

-- CreateIndex
CREATE INDEX "bank_transfer_requests_tenant_id_status_created_at_idx" ON "bank_transfer_requests"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "bank_transfer_requests_tenant_id_document_id_idx" ON "bank_transfer_requests"("tenant_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transfer_requests_tenant_id_code_key" ON "bank_transfer_requests"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "bank_transactions_tenant_id_status_created_at_idx" ON "bank_transactions"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_tenant_id_provider_external_id_key" ON "bank_transactions"("tenant_id", "provider", "external_id");

-- AddForeignKey
ALTER TABLE "bank_gateway_configs" ADD CONSTRAINT "bank_gateway_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_gateway_configs" ADD CONSTRAINT "bank_gateway_configs_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_requests" ADD CONSTRAINT "bank_transfer_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_requests" ADD CONSTRAINT "bank_transfer_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_requests" ADD CONSTRAINT "bank_transfer_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "bank_transfer_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
