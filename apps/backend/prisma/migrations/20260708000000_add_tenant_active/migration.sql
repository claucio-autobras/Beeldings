-- Cliente ativo/inativo: inativo bloqueia login/sessões e silencia notificações,
-- mas mantém o registro de alarmes/telemetria no histórico.
ALTER TABLE "tenants" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
