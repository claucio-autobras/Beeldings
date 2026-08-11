import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { PollingMetricsService } from '../observability/polling-metrics.service';
import { computeStartJitterMs } from '../observability/poll-jitter.util';
import { OnvifDriver } from '../drivers/onvif.driver';
import type { DriverTelemetryPoint } from '../drivers/collection-driver.interface';

/** Ponto ONVIF de um device (vem do binding cadastrado no backend). */
interface OnvifPointConfig {
  tag: string;
  /**
   * 'status' | 'uptime' | 'stream' | 'motion' | 'tamper' | 'video_loss'
   * ou métrica de saúde via SNMP ('cpu' | 'memory' | 'temperature' | 'packet_loss').
   */
  metric: string;
  unit: string | null;
  /** OID SNMP do ponto de saúde (só quando o canal SNMP está habilitado). */
  oid?: string | null;
  /** Fator de escala do valor cru SNMP. */
  scale?: number;
  /** OID comprovadamente não suportado (diagnóstico) — excluído do GET. */
  unsupported?: boolean;
}

/** Canal SNMP opcional de saúde de uma câmera ONVIF (monitoramento híbrido). */
interface SnmpHealthChannel {
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
}

/** Bloco de config de uma câmera ONVIF dentro do payload de config do gateway. */
interface OnvifDeviceBlock {
  deviceId: string;
  name: string;
  protocol?: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  pollingIntervalMs: number;
  /** Tipo do dispositivo monitorado (para o sistema de perfis). */
  monitoredDeviceType?: string | null;
  /** Fabricante detectado no probe ONVIF (habilita fallback ISAPI etc.). */
  manufacturer?: string | null;
  /** Presente quando o usuário habilitou "saúde via SNMP" no cadastro. */
  snmpHealth?: SnmpHealthChannel | null;
  points: OnvifPointConfig[];
}

interface GatewayConfigPayload {
  tenantId: string;
  gatewayId: string;
  devices: OnvifDeviceBlock[];
}

interface ActiveOnvifPoll {
  handle: ReturnType<typeof setInterval> | null;
  /** Delay de partida (jitter) — pendente até o primeiro ciclo. */
  startTimeout: ReturnType<typeof setTimeout> | null;
  polling: boolean;
  driver: OnvifDriver;
  /** Intervalo configurado (ms) — usado na contagem de ciclos pulados. */
  intervalMs: number;
  /** Snapshot JSON do bloco de config — detecta mudanças sem reiniciar tudo. */
  configKey: string;
}

/**
 * OnvifPollingService
 *
 * Consome a config publicada pelo backend (tópico .../config) e processa os
 * blocos `protocol: 'onvif'` (câmeras ONVIF). Cada câmera é gerenciada por
 * um OnvifDriver stateful que encapsula conexão, eventos e leituras híbridas.
 *
 * Usa resolveProfile() (via OnvifDriver) para determinar suporte ISAPI —
 * substituindo o resolveProvider() do código anterior.
 *
 * Publica no tópico canônico de telemetria:
 *   bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 */
@Injectable()
export class OnvifPollingService implements OnModuleDestroy {
  private readonly logger = new Logger(OnvifPollingService.name);
  private readonly tenantId: string;
  private readonly gatewayId: string;

  private readonly activePolls = new Map<string, ActiveOnvifPoll>();
  private dynamicKeys = new Set<string>();

  constructor(
    private readonly mqttService: GatewayMqttService,
    private readonly configService: ConfigService,
    private readonly pollingMetrics: PollingMetricsService,
  ) {
    this.tenantId = this.configService.get<string>('TENANT_ID', 'default');
    this.gatewayId = this.configService.get<string>('GATEWAY_ID', 'gw-01');
  }

  onModuleDestroy(): void {
    for (const key of [...this.activePolls.keys()]) {
      this.stopPoll(key);
    }
  }

  @OnEvent('mqtt.message')
  handleConfigMessage(event: { topic: string; message: Record<string, unknown> }): void {
    if (!event.topic.endsWith('/config')) {
      return;
    }
    const payload = event.message as unknown as GatewayConfigPayload;
    if (!Array.isArray(payload.devices)) {
      return;
    }
    const onvifDevices = payload.devices.filter((d) => d.protocol === 'onvif');
    this.applyConfig(onvifDevices);
  }

  private applyConfig(devices: OnvifDeviceBlock[]): void {
    const newKeys = new Set<string>();
    let started = 0;
    for (const d of devices) {
      newKeys.add(d.deviceId);
      // Config inalterada NÃO reinicia (mantém conexão + assinatura de eventos).
      const configKey = this.configKeyFor(d);
      const existing = this.activePolls.get(d.deviceId);
      if (existing && existing.configKey === configKey) {
        continue;
      }
      this.startPoll(d, configKey);
      started++;
    }
    for (const key of this.dynamicKeys) {
      if (!newKeys.has(key)) {
        this.stopPoll(key);
        this.logger.log(`Polling ONVIF encerrado para ${key} (câmera removida da config)`);
      }
    }
    this.dynamicKeys = newKeys;
    this.logger.log(
      `Config dinâmica ONVIF aplicada — ${devices.length} câmera(s), ${started} (re)iniciada(s)`,
    );
  }

  /**
   * Chave estável do bloco de config: pontos ordenados por tag antes do
   * stringify para evitar reinicialização por diferença de ordem.
   */
  private configKeyFor(device: OnvifDeviceBlock): string {
    return JSON.stringify({
      ...device,
      points: [...(device.points ?? [])].sort((a, b) => a.tag.localeCompare(b.tag)),
    });
  }

  private startPoll(device: OnvifDeviceBlock, configKey?: string): void {
    this.stopPoll(device.deviceId);

    const intervalMs = device.pollingIntervalMs || 30_000;
    // Jitter determinístico de partida: espalha os ciclos das câmeras do
    // gateway dentro do intervalo, evitando rajadas sincronizadas no broker.
    const jitterMs = computeStartJitterMs(device.deviceId, intervalMs);
    this.logger.log(
      `Câmera ONVIF ${device.deviceId} (${device.ip}:${device.port}, user=${device.username}): ` +
        `polling a cada ${intervalMs}ms — ${device.points.length} ponto(s) (partida em ${jitterMs}ms)`,
    );

    const driver = new OnvifDriver(
      {
        deviceId: device.deviceId,
        ip: device.ip,
        port: device.port,
        username: device.username,
        password: device.password,
        pollingIntervalMs: intervalMs,
        monitoredDeviceType: device.monitoredDeviceType,
        manufacturer: device.manufacturer,
        snmpHealth: device.snmpHealth,
        points: device.points,
      },
      // Callback de publicação imediata de eventos.
      (points) => this.publishTelemetry(device.deviceId, points),
    );

    const state: ActiveOnvifPoll = {
      handle: null,
      startTimeout: null,
      polling: false,
      driver,
      intervalMs,
      configKey: configKey ?? this.configKeyFor(device),
    };
    this.activePolls.set(device.deviceId, state);

    state.startTimeout = setTimeout(() => {
      state.startTimeout = null;
      void this.pollDevice(state);
      state.handle = setInterval(() => {
        void this.pollDevice(state);
      }, intervalMs);
    }, jitterMs);
  }

  private stopPoll(deviceId: string): void {
    const state = this.activePolls.get(deviceId);
    if (!state) {
      return;
    }
    if (state.startTimeout) {
      clearTimeout(state.startTimeout);
    }
    if (state.handle) {
      clearInterval(state.handle);
    }
    state.driver.dispose();
    this.activePolls.delete(deviceId);
  }

  /** Um ciclo de polling: driver executa runCycle e o resultado é publicado. */
  private async pollDevice(state: ActiveOnvifPoll): Promise<void> {
    if (state.driver.disposed) {
      return;
    }
    if (state.polling) {
      // Ciclo anterior ainda em andamento (câmera lenta) — pula e contabiliza.
      this.pollingMetrics.recordSkipped({
        protocol: 'onvif',
        deviceId: state.driver.deviceId,
        intervalMs: state.intervalMs,
      });
      return;
    }
    state.polling = true;
    const startedAt = Date.now();
    const deviceId = state.driver.deviceId;

    try {
      const result = await state.driver.collect();
      const points: DriverTelemetryPoint[] = result.points;
      const elapsedMs = Date.now() - startedAt;

      this.pollingMetrics.record({
        protocol: 'onvif',
        deviceId,
        latencyMs: elapsedMs,
        pointsRead: result.reachable ? points.filter((pt) => pt.value !== null).length : 0,
        pointsAttempted: points.length,
        intervalMs: state.intervalMs,
      });

      this.logger.debug(
        `[${deviceId}] Ciclo ONVIF: ${result.reachable ? 'online' : 'OFFLINE'} — ` +
          `${points.length} ponto(s) em ${elapsedMs}ms`,
      );

      this.publishTelemetry(deviceId, points);
    } finally {
      state.polling = false;
    }
  }

  private publishTelemetry(deviceId: string, points: DriverTelemetryPoint[]): void {
    const topic = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/telemetry`;
    this.mqttService.publish(topic, {
      timestamp: new Date().toISOString(),
      deviceId,
      points,
    });
  }
}
