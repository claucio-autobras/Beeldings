-- Campos de OTA do gateway: versão reportada e último resultado de atualização
ALTER TABLE "gateways" ADD COLUMN "reported_version" TEXT;
ALTER TABLE "gateways" ADD COLUMN "ota_state" TEXT;
ALTER TABLE "gateways" ADD COLUMN "ota_message" TEXT;
ALTER TABLE "gateways" ADD COLUMN "ota_at" TIMESTAMP(3);
