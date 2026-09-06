-- Último diagnóstico de heartbeat MQTT por dispositivo (fallback durável
-- do cache em memória: sobrevive a restart e vale em qualquer instância).
ALTER TABLE "devices" ADD COLUMN "last_heartbeat" JSONB;
