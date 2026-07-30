-- Evolução das Trends (Fase 1): COV/deadband + heartbeat por trend.
-- Campos opcionais; trends existentes ficam NULL e mantêm o comportamento atual.
ALTER TABLE "trends" ADD COLUMN "cov_threshold" DOUBLE PRECISION;
ALTER TABLE "trends" ADD COLUMN "max_interval_seconds" INTEGER;
