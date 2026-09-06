-- Fundação de dados para IA e manutenção preditiva.
-- 1) Particiona trend_records por mês (RANGE em "timestamp"), preservando dados.
-- 2) Cria tabelas de rollup (horário/diário) + cursor do job incremental.
-- 3) DevicePoint.op_role (contexto operacional) e Tenant.auto_trend_enabled.

-- ─── Colunas novas ─────────────────────────────────────────────────────────────
ALTER TABLE "tenants" ADD COLUMN "auto_trend_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "device_points" ADD COLUMN "op_role" TEXT;

-- ─── Rollups ───────────────────────────────────────────────────────────────────
CREATE TABLE "trend_rollups_hourly" (
    "trend_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,
    "sum" DOUBLE PRECISION NOT NULL,
    "count" INTEGER NOT NULL,
    CONSTRAINT "trend_rollups_hourly_pkey" PRIMARY KEY ("trend_id", "bucket")
);
CREATE INDEX "trend_rollups_hourly_tenant_id_bucket_idx" ON "trend_rollups_hourly"("tenant_id", "bucket" DESC);

CREATE TABLE "trend_rollups_daily" (
    "trend_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "min" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,
    "sum" DOUBLE PRECISION NOT NULL,
    "count" INTEGER NOT NULL,
    CONSTRAINT "trend_rollups_daily_pkey" PRIMARY KEY ("trend_id", "bucket")
);
CREATE INDEX "trend_rollups_daily_tenant_id_bucket_idx" ON "trend_rollups_daily"("tenant_id", "bucket" DESC);

CREATE TABLE "trend_rollup_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_record_id" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trend_rollup_state_pkey" PRIMARY KEY ("id")
);

-- ─── Particionamento de trend_records ─────────────────────────────────────────
-- Estratégia: renomeia a tabela atual, cria a tabela particionada com o MESMO
-- nome e sequence, cria partições cobrindo os dados existentes (+ meses à
-- frente), copia os dados e descarta a antiga. O backend garante partições
-- futuras (mês corrente + próximo) diariamente.

ALTER TABLE "trend_records" RENAME TO "trend_records_old";
ALTER TABLE "trend_records_old" RENAME CONSTRAINT "trend_records_pkey" TO "trend_records_old_pkey";
ALTER INDEX "trend_records_trend_id_timestamp_idx" RENAME TO "trend_records_old_trend_ts_idx";
ALTER INDEX "trend_records_tenant_id_timestamp_idx" RENAME TO "trend_records_old_tenant_ts_idx";

CREATE TABLE "trend_records" (
    "id" BIGINT NOT NULL DEFAULT nextval('trend_records_id_seq'),
    "trend_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "quality" "TrendQuality" NOT NULL DEFAULT 'GOOD',
    CONSTRAINT "trend_records_pkey" PRIMARY KEY ("id", "timestamp")
) PARTITION BY RANGE ("timestamp");

-- A sequence passa a pertencer à nova tabela (não é derrubada com a antiga).
ALTER SEQUENCE "trend_records_id_seq" OWNED BY "trend_records"."id";

CREATE INDEX "trend_records_trend_id_timestamp_idx" ON "trend_records"("trend_id", "timestamp" DESC);
CREATE INDEX "trend_records_tenant_id_timestamp_idx" ON "trend_records"("tenant_id", "timestamp" DESC);

ALTER TABLE "trend_records"
  ADD CONSTRAINT "trend_records_trend_id_fkey"
  FOREIGN KEY ("trend_id") REFERENCES "trends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cria partições mensais do mês mais antigo com dados (ou o mês atual) até 3
-- meses à frente. Nome: trend_records_yYYYYmMM.
DO $$
DECLARE
  first_month date;
  last_month date;
  m date;
  part_name text;
BEGIN
  SELECT date_trunc('month', min("timestamp"))::date INTO first_month FROM "trend_records_old";
  IF first_month IS NULL THEN
    first_month := date_trunc('month', now())::date;
  END IF;
  last_month := (date_trunc('month', now()) + interval '3 months')::date;
  m := first_month;
  WHILE m <= last_month LOOP
    part_name := format('trend_records_y%sm%s', to_char(m, 'YYYY'), to_char(m, 'MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "trend_records" FOR VALUES FROM (%L) TO (%L)',
      part_name, m, (m + interval '1 month')::date
    );
    m := (m + interval '1 month')::date;
  END LOOP;
END $$;

INSERT INTO "trend_records" ("id", "trend_id", "tenant_id", "timestamp", "value", "quality")
SELECT "id", "trend_id", "tenant_id", "timestamp", "value", "quality" FROM "trend_records_old";

DROP TABLE "trend_records_old";
