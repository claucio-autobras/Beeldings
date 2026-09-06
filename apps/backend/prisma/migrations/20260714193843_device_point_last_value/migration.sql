-- AlterTable
ALTER TABLE "device_points" ADD COLUMN     "last_value" DOUBLE PRECISION,
ADD COLUMN     "last_value_at" TIMESTAMP(3);
