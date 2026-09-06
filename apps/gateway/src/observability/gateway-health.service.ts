import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import type { GatewayMqttStatus } from '../mqtt/gateway-mqtt.service';
import { StoreAndForwardService } from '../mqtt/store-and-forward.service';
import { PollingMetricsService } from './polling-metrics.service';
import type { DevicePollingMetric } from './polling-metrics.service';
import { isOtaSupported, resolveGatewayVersion } from '../ota/gateway-version';

/** Resumo consolidado de saúde das comunicações do gateway (read-only, sem segredos). */
export interface GatewayHealthSnapshot {
  /** Instante da coleta (ISO). */
  timestamp: string;
  /** Identificador do gateway. */
  gatewayId: string;
  /** Tenant deste gateway. */
  tenantId: string;
  /** Segundos desde o boot do processo. */
  uptimeSeconds: number;
  /** Versão do gateway em execução (package.json da instalação). */
  version: string;
  /** True quando o gateway roda sob o launcher OTA (suporta atualização remota). */
  otaSupported: boolean;
  /** Estado da conexão MQTT do gateway com o broker. */
  mqtt: GatewayMqttStatus;
  /** Profundidade e descartes da fila de store-and-forward. */
  storeAndForward: { pending: number; dropped: number };
  /** Latência do último ciclo de polling por device (BACnet/Modbus). */
  polling: DevicePollingMetric[];
}

/**
 * GatewayHealthService — monta o resumo de saúde das comunicações do gateway
 * (conexão MQTT + reconexões, fila offline pending/dropped, latência de polling
 * por device) a partir das fontes observacionais já existentes.
 *
 * Fonte única do payload de saúde, reaproveitada tanto pelo endpoint HTTP local
 * (`GET /health`) quanto pelo publicador periódico via MQTT. Read-only: não
 * altera o comportamento das comunicações e não expõe credenciais (a URL do
 * broker é sanitizada no próprio GatewayMqttService).
 */
@Injectable()
export class GatewayHealthService {
  constructor(
    private readonly mqtt: GatewayMqttService,
    private readonly storeAndForward: StoreAndForwardService,
    private readonly polling: PollingMetricsService,
    private readonly config: ConfigService,
  ) {}

  buildSnapshot(): GatewayHealthSnapshot {
    return {
      timestamp: new Date().toISOString(),
      gatewayId: this.config.get<string>('GATEWAY_ID', 'gw-01'),
      tenantId: this.config.get<string>('TENANT_ID', 'default'),
      uptimeSeconds: Math.floor(process.uptime()),
      version: resolveGatewayVersion(),
      otaSupported: isOtaSupported(),
      mqtt: this.mqtt.getConnectionStatus(),
      storeAndForward: {
        pending: this.storeAndForward.pendingCount(),
        dropped: this.storeAndForward.droppedMessages(),
      },
      polling: this.polling.getSnapshot(),
    };
  }
}
