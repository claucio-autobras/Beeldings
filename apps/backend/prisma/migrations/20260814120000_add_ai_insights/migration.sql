-- CreateEnum
CREATE TYPE "InsightFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "tenant_insight_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" "InsightFrequency" NOT NULL DEFAULT 'WEEKLY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_insight_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "frequency" "InsightFrequency" NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "period_label" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "theme" TEXT,
    "summary" TEXT,
    "narrative" JSONB,
    "ai_failed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_insight_configs_tenant_id_key" ON "tenant_insight_configs"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_insights_tenant_id_created_at_idx" ON "ai_insights"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_insights_tenant_id_frequency_period_start_idx" ON "ai_insights"("tenant_id", "frequency", "period_start");

-- AddForeignKey
ALTER TABLE "tenant_insight_configs" ADD CONSTRAINT "tenant_insight_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
