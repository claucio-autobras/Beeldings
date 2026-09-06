import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

/** Protocolos de polling ativo + o modelo passivo MQTT (bridge). */
export type MetricProtocol = 'bacnet' | 'modbus' | 'snmp' | 'onvif' | 'mqtt';

/** Métricas do último ciclo de polling de um device (por protocolo). */
export interface DevicePollingMetric {
  protocol: MetricProtocol;
  deviceId: string;
  /** Latência do último ciclo de polling (ms). Para MQTT (passivo) é 0. */
  lastLatencyMs: number;
  /** Pontos lidos com sucesso no último ciclo. */
  lastPointsRead: number;
  /** Objetos/registradores tentados no último ciclo. */
  lastPointsAttempted: number;
  /** Instante do último ciclo concluído (ISO). Vazio se nunca houve. */
  lastPollAt: string;
  /** Total de ciclos de polling concluídos desde o boot. */
  totalCycles: number;
  /** Instante da última leitura BEM-SUCEDIDA (>0 pontos lidos), se houver. */
  lastSuccessAt?: string;
  /** Ciclos pulados porque o anterior ainda estava em andamento (busy). */
  skippedCycles?: number;
  /** Ciclos cuja duração excedeu o intervalo configurado do device. */
  intervalOverruns?: number;
  /** Intervalo de polling configurado (ms) — contexto para os estouros. */
  intervalMs?: number;
  /** MQTT (passivo): total de mensagens recebidas desde o boot. */
  messagesReceived?: number;
  /** MQTT (passivo): instante da última mensagem recebida (ISO). */
  lastMessageAt?: string;
}

/** Bloco mínimo de device dentro do payload de config do gateway. */
interface ConfigDeviceBlock {
  deviceId?: string;
  protocol?: string;
}

/**
 * PollingMetricsService — registro central e observacional das latências de
 * polling BACnet/Modbus do gateway. Os serviços de polling reportam a duração
 * de cada ciclo aqui; o HealthController lê o snapshot. Não interfere no
 * comportamento do polling — apenas guarda os últimos números por device.
 *
 * Também sincroniza com a config publicada pelo backend: devices removidos da
 * config somem imediatamente do snapshot (sem reiniciar o gateway) e devices
 * MQTT (passivos, sem polling) ganham uma entrada com métricas de mensagens.
 */
@Injectable()
export class PollingMetricsService {
  private readonly logger = new Logger(PollingMetricsService.name);
  private readonly metrics = new Map<string, DevicePollingMetric>();

  /** Registra o resultado de um ciclo de polling concluído. */
  record(params: {
    protocol: 'bacnet' | 'modbus' | 'snmp' | 'onvif';
    deviceId: string;
    latencyMs: number;
    pointsRead: number;
    pointsAttempted: number;
    /** Intervalo configurado do device (ms) — habilita a contagem de estouros. */
    intervalMs?: number;
  }): void {
    const key = `${params.protocol}:${params.deviceId}`;
    const prev = this.metrics.get(key);
    const now = new Date().toISOString();
    const overran =
      typeof params.intervalMs === 'number' &&
      params.intervalMs > 0 &&
      params.latencyMs > params.intervalMs;
    this.metrics.set(key, {
      protocol: params.protocol,
      deviceId: params.deviceId,
      lastLatencyMs: params.latencyMs,
      lastPointsRead: params.pointsRead,
      lastPointsAttempted: params.pointsAttempted,
      lastPollAt: now,
      totalCycles: (prev?.totalCycles ?? 0) + 1,
      lastSuccessAt: params.pointsRead > 0 ? now : prev?.lastSuccessAt,
      skippedCycles: prev?.skippedCycles ?? 0,
      intervalOverruns: (prev?.intervalOverruns ?? 0) + (overran ? 1 : 0),
      intervalMs: params.intervalMs ?? prev?.intervalMs,
    });
  }

  /**
   * Registra um ciclo PULADO: o intervalo disparou mas o ciclo anterior do
   * device ainda estava em andamento (guard de sobreposição). Contabilizado
   * para dar visibilidade a devices que não cabem no intervalo configurado.
   */
  recordSkipped(params: {
    protocol: 'bacnet' | 'modbus' | 'snmp' | 'onvif';
    deviceId: string;
    intervalMs?: number;
  }): void {
    const key = `${params.protocol}:${params.deviceId}`;
    const prev = this.metrics.get(key);
    this.metrics.set(key, {
      protocol: params.protocol,
      deviceId: params.deviceId,
      lastLatencyMs: prev?.lastLatencyMs ?? 0,
      lastPointsRead: prev?.lastPointsRead ?? 0,
      lastPointsAttempted: prev?.lastPointsAttempted ?? 0,
      lastPollAt: prev?.lastPollAt ?? '',
      totalCycles: prev?.totalCycles ?? 0,
      lastSuccessAt: prev?.lastSuccessAt,
      skippedCycles: (prev?.skippedCycles ?? 0) + 1,
      intervalOverruns: prev?.intervalOverruns ?? 0,
      intervalMs: params.intervalMs ?? prev?.intervalMs,
    });
  }

  /**
   * Registra uma mensagem recebida via bridge MQTT (modelo passivo): conta a
   * mensagem e marca o instante; pointsRead>0 conta como leitura bem-sucedida.
   */
  recordBridgeMessage(deviceId: string, pointsRead: number, pointsAttempted: number): void {
    const key = `mqtt:${deviceId}`;
    const prev = this.metrics.get(key);
    const now = new Date().toISOString();
    this.metrics.set(key, {
      protocol: 'mqtt',
      deviceId,
      lastLatencyMs: 0,
      lastPointsRead: pointsRead,
      lastPointsAttempted: pointsAttempted,
      lastPollAt: now,
      totalCycles: (prev?.totalCycles ?? 0) + 1,
      lastSuccessAt: pointsRead > 0 ? now : prev?.lastSuccessAt,
      messagesReceived: (prev?.messagesReceived ?? 0) + 1,
      lastMessageAt: now,
    });
  }

  /**
   * Sincroniza o registro com a config recém-aplicada: remove métricas de
   * devices que saíram da config (fantasmas) e garante uma entrada zerada para
   * cada device MQTT (que é passivo e nunca "reporta ciclo").
   */
  @OnEvent('mqtt.message')
  handleConfigMessage(event: { topic: string; message: Record<string, unknown> }): void {
    if (!event.topic.endsWith('/config')) return;
    const devices = (event.message as { devices?: unknown }).devices;
    if (!Array.isArray(devices)) return;
    this.syncWithConfig(devices as ConfigDeviceBlock[]);
  }

  private syncWithConfig(devices: ConfigDeviceBlock[]): void {
    const allowedIds = new Set(
      devices.map((d) => d.deviceId).filter((id): id is string => typeof id === 'string' && id.length > 0),
    );

    let removed = 0;
    for (const [key, metric] of this.metrics) {
      if (!allowedIds.has(metric.deviceId)) {
        this.metrics.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      this.logger.log(`Métricas de ${removed} device(s) removido(s) da config foram limpas`);
    }

    // Devices MQTT são passivos: registra a entrada já na config para que
    // apareçam no resumo de saúde mesmo antes da primeira mensagem.
    for (const d of devices) {
      if (d.protocol !== 'mqtt' || !d.deviceId) continue;
      const key = `mqtt:${d.deviceId}`;
      if (this.metrics.has(key)) continue;
      this.metrics.set(key, {
        protocol: 'mqtt',
        deviceId: d.deviceId,
        lastLatencyMs: 0,
        lastPointsRead: 0,
        lastPointsAttempted: 0,
        lastPollAt: '',
        totalCycles: 0,
        messagesReceived: 0,
      });
    }
  }

  /** Snapshot de todas as métricas de polling conhecidas. */
  getSnapshot(): DevicePollingMetric[] {
    return [...this.metrics.values()];
  }
}
