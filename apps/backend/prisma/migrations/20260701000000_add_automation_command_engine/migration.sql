-- Motor de Automação (QUANDO/SE/ENTÃO) — migração ADITIVA. Só cria tipos,
-- tabelas e índices novos; nada é alterado nas tabelas existentes.

-- ─── Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE "AutomationMode" AS ENUM ('ONESHOT', 'CONTINUOUS');
CREATE TYPE "AutomationTriggerType" AS ENUM ('SCHEDULE');
CREATE TYPE "AutomationActionType" AS ENUM ('WRITE_POINT', 'NOTIFY');
CREATE TYPE "AutomationBranch" AS ENUM ('ALWAYS', 'ON_TRUE', 'ON_FALSE');
CREATE TYPE "AutomationExecutesOn" AS ENUM ('CLOUD', 'EDGE');

-- ─── automations ────────────────────────────────────────────────────────────
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_id" TEXT,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" "AutomationMode" NOT NULL DEFAULT 'ONESHOT',
    "trigger_type" "AutomationTriggerType" NOT NULL DEFAULT 'SCHEDULE',
    "trigger_config" JSONB NOT NULL,
    "condition" JSONB,
    "eval_seconds" INTEGER NOT NULL DEFAULT 30,
    "executes_on" "AutomationExecutesOn" NOT NULL DEFAULT 'CLOUD',
    "priority" INTEGER NOT NULL DEFAULT 8,
    "created_by" TEXT,
    "last_run_at" TIMESTAMP(3),
    "last_run_result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- ─── automation_actions ─────────────────────────────────────────────────────
CREATE TABLE "automation_actions" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "branch" "AutomationBranch" NOT NULL DEFAULT 'ALWAYS',
    "type" "AutomationActionType" NOT NULL,
    "target_point_id" TEXT,
    "value" JSONB,
    "delay_seconds" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_actions_pkey" PRIMARY KEY ("id")
);

-- ─── Índices ────────────────────────────────────────────────────────────────
CREATE INDEX "automations_tenant_id_idx" ON "automations"("tenant_id");
CREATE INDEX "automations_enabled_mode_idx" ON "automations"("enabled", "mode");
CREATE INDEX "automation_actions_automation_id_idx" ON "automation_actions"("automation_id");
CREATE INDEX "automation_actions_target_point_id_idx" ON "automation_actions"("target_point_id");

-- ─── FK (cascade nas ações ao remover a automação) ──────────────────────────
ALTER TABLE "automation_actions" ADD CONSTRAINT "automation_actions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
