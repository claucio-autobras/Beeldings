-- Substitui o modelo de alarme antigo (binário, 5 severidades) pelo modelo
-- por-ponto: AlarmRule (config) × AlarmEvent (ocorrência), severidades LOW/MEDIUM/HIGH.
-- ⚠️ DESTRUTIVA: dropa a tabela "alarms" (dados eram mock — autorizado no design).

-- ── Remove o modelo antigo ──────────────────────────────────────────────────
DROP TABLE IF EXISTS "alarms";
DROP TYPE IF EXISTS "Severity";
DROP TYPE IF EXISTS "AlarmStatus";

-- ── Novos enums ─────────────────────────────────────────────────────────────
CREATE TYPE "AlarmType" AS ENUM ('STATE_CHANGE', 'VALUE_RANGE');
CREATE TYPE "AlarmSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "AlarmCondition" AS ENUM ('GT', 'LT', 'GTE', 'LTE', 'BETWEEN', 'OUTSIDE');
CREATE TYPE "AlarmEventState" AS ENUM ('ACTIVE', 'ACTIVE_ACK', 'NORMALIZED_UNACK', 'NORMALIZED_ACK');

-- ── alarm_rules (config por-ponto) ──────────────────────────────────────────
CREATE TABLE "alarm_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "AlarmType" NOT NULL,
    "severity" "AlarmSeverity" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "activation_state" BOOLEAN,
    "condition" "AlarmCondition",
    "limit_value" DOUBLE PRECISION,
    "limit_low" DOUBLE PRECISION,
    "limit_high" DOUBLE PRECISION,
    "hysteresis" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "delay_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alarm_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "alarm_rules_tenant_id_idx" ON "alarm_rules"("tenant_id");
CREATE INDEX "alarm_rules_point_id_idx" ON "alarm_rules"("point_id");

-- ── alarm_events (ocorrências) ──────────────────────────────────────────────
CREATE TABLE "alarm_events" (
    "id" TEXT NOT NULL,
    "alarm_rule_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "state" "AlarmEventState" NOT NULL DEFAULT 'ACTIVE',
    "value_at_trigger" DOUBLE PRECISION,
    "activated_at" TIMESTAMP(3) NOT NULL,
    "normalized_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarm_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "alarm_events_tenant_id_activated_at_idx" ON "alarm_events"("tenant_id", "activated_at" DESC);
CREATE INDEX "alarm_events_alarm_rule_id_idx" ON "alarm_events"("alarm_rule_id");
CREATE INDEX "alarm_events_state_idx" ON "alarm_events"("state");

-- ── FKs ─────────────────────────────────────────────────────────────────────
ALTER TABLE "alarm_rules" ADD CONSTRAINT "alarm_rules_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "device_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alarm_events" ADD CONSTRAINT "alarm_events_alarm_rule_id_fkey" FOREIGN KEY ("alarm_rule_id") REFERENCES "alarm_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
