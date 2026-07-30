-- Avisos de automação: guarda o id da automação de origem para permitir
-- deep-link do sino para o histórico pré-filtrado na regra.
ALTER TABLE "alarm_events" ADD COLUMN "source_id" TEXT;
