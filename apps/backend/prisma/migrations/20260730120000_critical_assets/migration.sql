-- Ativos críticos: marcação por device e por ponto para o card do dashboard
-- e consumo pela IA (manutenção preditiva).
ALTER TABLE "devices" ADD COLUMN "is_critical" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "device_points" ADD COLUMN "is_critical" BOOLEAN NOT NULL DEFAULT false;
