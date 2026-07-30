-- Trends (histórico de variáveis, opt-in por ponto). Migração ADITIVA — não
-- altera nenhuma tabela existente além de adicionar a relação em device_points.

CREATE TYPE "TrendMode" AS ENUM ('ON_CHANGE', 'INTERVAL');
CREATE TYPE "TrendQuality" AS ENUM ('GOOD', 'BAD', 'UNAVAILABLE');

CREATE TABLE "trends" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "TrendMode" NOT NULL,
    "interval_seconds" INTEGER,
    "retention_days" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trends_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trends_tenant_id_idx" ON "trends"("tenant_id");
CREATE INDEX "trends_point_id_idx" ON "trends"("point_id");

CREATE TABLE "trend_records" (
    "id" BIGSERIAL NOT NULL,
    "trend_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "quality" "TrendQuality" NOT NULL DEFAULT 'GOOD',

    CONSTRAINT "trend_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trend_records_trend_id_timestamp_idx" ON "trend_records"("trend_id", "timestamp" DESC);
CREATE INDEX "trend_records_tenant_id_timestamp_idx" ON "trend_records"("tenant_id", "timestamp" DESC);

ALTER TABLE "trends" ADD CONSTRAINT "trends_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "device_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trend_records" ADD CONSTRAINT "trend_records_trend_id_fkey" FOREIGN KEY ("trend_id") REFERENCES "trends"("id") ON DELETE CASCADE ON UPDATE CASCADE;
