import { Injectable } from '@nestjs/common';

/** Estado da conexão MQTT do gateway, conforme reportado no resumo de saúde. */
export interface GatewayMqttHealth {
  connected: boolean;
  broker?: string;
  connectCount?: number;
  reconnectCount?: number;
  lastConnectedAt?: string | null;
  lastDisconnectedAt?: string | null;
  lastError?: string | null;
}

/** Latência do último ciclo de polling de um device, conforme o resumo. */
export interface GatewayPollingHealth {
  protocol: string;
  deviceId: string;
  /** Nome do device (enriquecido a partir do cadastro no read; opcional). */
  deviceName?: string;
  lastLatencyMs: number;
  lastPointsRead: number;
  lastPointsAttempted: number;
  lastPollAt: string;
  totalCycles: number;
  /** Instante da última leitura bem-sucedida (>0 pontos), se houver. */
  lastSuccessAt?: string;
  /** MQTT (passivo): total de mensagens recebidas desde o boot. */
  messagesReceived?: number;
  /** MQTT (passivo): instante da última mensagem recebida (ISO). */
  lastMessageAt?: string;
}

/** Resumo de saúde recebido de um gateway pelo tópico `.../health`. */
export interface GatewayHealthSummary {
  /** Instante da coleta no gateway (ISO). */
  timestamp: string;
  /** Instante em que o backend recebeu este resumo (ISO). */
  receivedAt: string;
  /** Segundos desde o boot do gateway. */
  uptimeSeconds: number;
  /** Versão do gateway em execução (undefined em gateways antigos). */
  version?: string;
  /** True quando o gateway roda sob o launcher OTA (suporta atualização remota). */
  otaSupported?: boolean;
  mqtt: GatewayMqttHealth;
  storeAndForward: { pending: number; dropped: number };
  polling: GatewayPollingHealth[];
}

/**
 * GatewayHealthService (backend)
 *
 * Guarda, EM MEMÓRIA, o ÚLTIMO resumo de saúde recebido de cada gateway pelo
 * tópico `bluebee/{tenant}/gateway/{id}/health`. Não persiste série temporal —
 * apenas o resumo mais recente por gateway (Task foca no último estado).
 *
 * É totalmente aditivo e independente do liveness (LWT/heartbeat): não altera o
 * status online/offline, apenas enriquece a tela de Gateway com métricas de
 * comunicação (fila offline, reconexões MQTT, latência de polling).
 */
@Injectable()
export class GatewayHealthService {
  private readonly summaries = new Map<string, GatewayHealthSummary>();

  /** Aplica um resumo de saúde recebido de um gateway. */
  apply(gatewayId: string, summary: GatewayHealthSummary): void {
    if (!gatewayId) return;
    this.summaries.set(gatewayId, summary);
  }

  /** Último resumo de saúde conhecido de um gateway, ou null. */
  get(gatewayId: string): GatewayHealthSummary | null {
    return this.summaries.get(gatewayId) ?? null;
  }
}
