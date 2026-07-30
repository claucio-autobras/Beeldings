-- AlterTable
ALTER TABLE "device_points" ADD COLUMN     "binding" JSONB;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "config" JSONB;
