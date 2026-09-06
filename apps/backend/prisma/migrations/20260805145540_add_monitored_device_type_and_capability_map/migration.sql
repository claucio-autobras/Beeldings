-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "monitored_device_type" TEXT;

-- Backfill: câmeras existentes (snmp/onvif) → tipo CAMERA.
-- Histórico/alarmes/trends não são afetados (referem-se ao device_id UUID).
UPDATE "devices"
  SET "monitored_device_type" = 'CAMERA'
  WHERE "protocol" IN ('snmp', 'onvif');

-- CreateTable
CREATE TABLE "device_capability_maps" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "probe_value" DOUBLE PRECISION,
    "last_probe_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profile_id" TEXT,
    "profile_layer" TEXT,

    CONSTRAINT "device_capability_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_capability_maps_device_id_metric_key_key" ON "device_capability_maps"("device_id", "metric_key");

-- AddForeignKey
ALTER TABLE "device_capability_maps" ADD CONSTRAINT "device_capability_maps_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
