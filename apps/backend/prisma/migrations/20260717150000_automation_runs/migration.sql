-- CreateEnum
CREATE TYPE "AutomationRunResult" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILURE');

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "automation_name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "result" "AutomationRunResult" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "details" JSONB NOT NULL,
    "error_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_runs_tenant_id_started_at_idx" ON "automation_runs"("tenant_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "automation_runs_automation_id_started_at_idx" ON "automation_runs"("automation_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
