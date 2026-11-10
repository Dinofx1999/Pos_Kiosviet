-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "accuracy" DECIMAL(8,1),
ADD COLUMN     "device_id" VARCHAR(80),
ADD COLUMN     "distance_meters" INTEGER,
ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ip" VARCHAR(64),
ADD COLUMN     "out_distance_meters" INTEGER,
ADD COLUMN     "out_latitude" DECIMAL(9,6),
ADD COLUMN     "out_longitude" DECIMAL(9,6),
ADD COLUMN     "user_agent" VARCHAR(300);

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "radius_meters" INTEGER;

-- CreateTable
CREATE TABLE "attendance_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200),
    "status" VARCHAR(20) NOT NULL DEFAULT 'TRUSTED',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_devices_tenant_id_user_id_idx" ON "attendance_devices"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_devices_tenant_id_device_id_key" ON "attendance_devices"("tenant_id", "device_id");

-- AddForeignKey
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
