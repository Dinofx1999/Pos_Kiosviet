-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PREVIEW', 'RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "external_ref" VARCHAR(100),
ADD COLUMN     "imported" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "source" VARCHAR(30) NOT NULL DEFAULT 'EXCEL',
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PREVIEW',
    "file_name" VARCHAR(255),
    "headers" JSONB,
    "mapping" JSONB,
    "options" JSONB,
    "payload" JSONB,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "totals" JSONB,
    "errors" JSONB,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "retailer" VARCHAR(100),
    "client_id" VARCHAR(200),
    "secret_enc" VARCHAR(1000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DISCONNECTED',
    "branch_map" JSONB,
    "last_test_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_tenant_id_created_at_idx" ON "import_jobs"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_tenant_id_provider_key" ON "integration_connections"("tenant_id", "provider");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
