-- Migration: SNMP metric binding v2
-- Adds confidenceLabel (exact|inferred|manual) to device_metric_binding,
-- and aggregation metadata (memberOids, labels, sysObjectId, firmwareFamily)
-- for profile inheritance and metric-first proposals.
-- All changes are additive (no column drops, no data loss).

-- confidenceLabel: enum-like string replaces the numeric confidence field.
-- Old rows default to 'exact' (confidence=1 meant fully resolved).
ALTER TABLE "device_metric_binding"
  ADD COLUMN IF NOT EXISTS "confidence_label" TEXT NOT NULL DEFAULT 'exact';

-- memberOids: JSON array of member OIDs for aggregated metrics (e.g. per-CPU avg).
ALTER TABLE "device_metric_binding"
  ADD COLUMN IF NOT EXISTS "member_oids" JSONB NOT NULL DEFAULT '[]';

-- labels: JSON map of OID->display label for aggregated metrics.
ALTER TABLE "device_metric_binding"
  ADD COLUMN IF NOT EXISTS "labels" JSONB NOT NULL DEFAULT '{}';

-- sysObjectId + firmwareFamily on device_metric_binding for inheritance queries.
ALTER TABLE "device_metric_binding"
  ADD COLUMN IF NOT EXISTS "sys_object_id" TEXT;

ALTER TABLE "device_metric_binding"
  ADD COLUMN IF NOT EXISTS "firmware_family" TEXT;

-- Index to support same-tenant same-sysObjectID inheritance queries.
CREATE INDEX IF NOT EXISTS "device_metric_binding_sys_object_id_idx"
  ON "device_metric_binding"("sys_object_id");

CREATE INDEX IF NOT EXISTS "device_metric_binding_confidence_label_idx"
  ON "device_metric_binding"("confidence_label");
