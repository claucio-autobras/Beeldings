-- Contador de oscilação da ocorrência: quantas vezes reativou (normal -> ativo)
-- antes do reconhecimento, e quando foi a última reativação.
ALTER TABLE "alarm_events" ADD COLUMN "reactivation_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "alarm_events" ADD COLUMN "last_reactivated_at" TIMESTAMP(3);
