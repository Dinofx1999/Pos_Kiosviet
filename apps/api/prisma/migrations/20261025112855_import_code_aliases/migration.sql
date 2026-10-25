-- CreateTable
CREATE TABLE "import_code_aliases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source" VARCHAR(30) NOT NULL DEFAULT 'KIOTVIET',
    "code" VARCHAR(80) NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_unit_id" UUID,
    "unit_name" VARCHAR(50),
    "factor" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_code_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_code_aliases_tenant_id_source_code_key" ON "import_code_aliases"("tenant_id", "source", "code");

-- AddForeignKey
ALTER TABLE "import_code_aliases" ADD CONSTRAINT "import_code_aliases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_code_aliases" ADD CONSTRAINT "import_code_aliases_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
