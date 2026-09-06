-- Memória operacional anonimizada da IA: casos globais (cross-tenant) derivados
-- de ocorrências de alarme resolvidas + reconhecidas com motivo. Whitelist
-- estrita de campos não identificáveis (LGPD) — sem tenant/site/device/nomes.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "operational_cases" (
    "id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "monitored_device_type" TEXT,
    "protocol" TEXT NOT NULL,
    "alarm_name" TEXT NOT NULL,
    "alarm_message" TEXT,
    "alarm_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "value_at_trigger" DOUBLE PRECISION,
    "recurrence_count" INTEGER NOT NULL DEFAULT 0,
    "time_to_resolve_minutes" INTEGER,
    "resolution" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "composed_text" TEXT NOT NULL,
    "embedding" vector(1536),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_cases_source_event_id_key" ON "operational_cases"("source_event_id");
CREATE INDEX "operational_cases_monitored_device_type_idx" ON "operational_cases"("monitored_device_type");
CREATE INDEX "operational_cases_alarm_type_idx" ON "operational_cases"("alarm_type");
CREATE INDEX "operational_cases_embedding_idx" ON "operational_cases" USING hnsw ("embedding" vector_cosine_ops);
