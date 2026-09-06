-- Job assíncrono de diagnóstico SNMP guiado (câmera/controladora): guarda o
-- resultado final por diagnoseId até o polling do frontend buscá-lo.
CREATE TABLE "snmp_diagnose_job" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "snmp_diagnose_job_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "snmp_diagnose_job_device_id_created_at_idx" ON "snmp_diagnose_job"("device_id", "created_at");

CREATE INDEX "snmp_diagnose_job_tenant_id_idx" ON "snmp_diagnose_job"("tenant_id");
