-- Estado do último valor de pontos de câmera CFTV ('waiting_event' |
-- 'unsupported' | 'error' | 'estimated'; null = leitura real do hardware).
ALTER TABLE "device_points" ADD COLUMN "last_value_state" TEXT;
