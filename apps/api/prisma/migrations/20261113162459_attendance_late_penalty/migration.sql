-- AlterTable
ALTER TABLE "attendances" ADD COLUMN     "late_minutes" INTEGER,
ADD COLUMN     "late_penalty" DECIMAL(18,4);
