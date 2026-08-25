ALTER TABLE "snmp_mibs"
  ADD COLUMN "manufacturer" TEXT,
  ADD COLUMN "is_offline" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "devices"
  ADD COLUMN "snmp_mib_id" TEXT;

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_snmp_mib_id_fkey"
  FOREIGN KEY ("snmp_mib_id") REFERENCES "snmp_mibs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "devices_snmp_mib_id_idx" ON "devices"("snmp_mib_id");