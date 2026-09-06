-- AlterTable
ALTER TABLE "alarm_events" ADD COLUMN     "ack_note" TEXT;

-- AddForeignKey
ALTER TABLE "telemetry" ADD CONSTRAINT "telemetry_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
