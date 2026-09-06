-- Idempotência da geração AGENDADA no banco: no máximo 1 insight scheduled por
-- tenant/frequência/início de período, mesmo com race entre líderes em failover.
-- Índice parcial (trigger='scheduled') porque a geração MANUAL permite duplicatas
-- de propósito — por isso vive em SQL puro e não no schema.prisma.
CREATE UNIQUE INDEX IF NOT EXISTS "ai_insights_scheduled_unique"
  ON "ai_insights" ("tenant_id", "frequency", "period_start")
  WHERE "trigger" = 'scheduled';
