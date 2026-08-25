-- CreateTable
CREATE TABLE "snmp_credential" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '2c',
    "community" TEXT,
    "security_name" TEXT,
    "security_level" TEXT,
    "auth_protocol" TEXT,
    "auth_key_enc" TEXT,
    "priv_protocol" TEXT,
    "priv_key_enc" TEXT,
    "context_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snmp_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_profile" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT,
    "sys_object_id" TEXT,
    "firmware_range" TEXT,
    "walk_roots" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_metric" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_metric_binding" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "oid" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'point',
    "broken" BOOLEAN NOT NULL DEFAULT false,
    "broken_reason" TEXT,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_metric_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_run" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "total_oids" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "reachable" BOOLEAN NOT NULL DEFAULT true,
    "sys_object_id" TEXT,
    "diff" JSONB,
    "broken_bindings" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "discovery_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_object" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "oid" TEXT NOT NULL,
    "type" TEXT,
    "raw_value" TEXT,
    "mib_name" TEXT,

    CONSTRAINT "discovery_object_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "snmp_credential_device_id_key" ON "snmp_credential"("device_id");

-- CreateIndex
CREATE INDEX "snmp_credential_tenant_id_idx" ON "snmp_credential"("tenant_id");

-- CreateIndex
CREATE INDEX "device_profile_tenant_id_idx" ON "device_profile"("tenant_id");

-- CreateIndex
CREATE INDEX "device_profile_sys_object_id_idx" ON "device_profile"("sys_object_id");

-- CreateIndex
CREATE INDEX "profile_metric_tenant_id_idx" ON "profile_metric"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_metric_profile_id_metric_key_key" ON "profile_metric"("profile_id", "metric_key");

-- CreateIndex
CREATE INDEX "device_metric_binding_tenant_id_idx" ON "device_metric_binding"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_metric_binding_device_id_metric_key_key" ON "device_metric_binding"("device_id", "metric_key");

-- CreateIndex
CREATE INDEX "discovery_run_device_id_started_at_idx" ON "discovery_run"("device_id", "started_at");

-- CreateIndex
CREATE INDEX "discovery_run_tenant_id_idx" ON "discovery_run"("tenant_id");

-- CreateIndex
CREATE INDEX "discovery_object_run_id_idx" ON "discovery_object"("run_id");

-- CreateIndex
CREATE INDEX "discovery_object_tenant_id_idx" ON "discovery_object"("tenant_id");

-- AddForeignKey
ALTER TABLE "snmp_credential" ADD CONSTRAINT "snmp_credential_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_metric" ADD CONSTRAINT "profile_metric_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "device_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_metric_binding" ADD CONSTRAINT "device_metric_binding_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_run" ADD CONSTRAINT "discovery_run_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_object" ADD CONSTRAINT "discovery_object_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "discovery_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
