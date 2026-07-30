import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MqttService } from './mqtt.service.js';
import {
  TelemetryGateway,
  BacnetTelemetryPayload,
  CommandResultPayload,
} from './telemetry.gateway.js';
import { DeviceStatusService } from './device-status.service.js';
import { GatewayStatusService } from './gateway-status.service.js';
import { GatewayHealthService } from './gateway-health.service.js';
import { DeviceHeartbeatService } from './device-heartbeat.service.js';
import type { GatewayHealthSummary } from './gateway-health.service.js';
import { GatewayOtaService } from './gateway-ota.service.js';
import type { GatewayOtaProgress, GatewayOtaStage } from './gateway-ota.service.js';
import { TrendRecorderService } from '../trends/trend-recorder.service.js';
import { AlarmEngineService } from '../alarms/alarm-engine.service.js';
import { IngestionMetricsService } from './ingestion-metrics.service.js';
import { CameraLastValueService } from './camera-last-value.service.js';

interface GatewayStatusPayload {
  status?: string;
  gatewayId?: string;
  reason?: string;
}

@Injectable()
export class BacnetMqttSubscriber implements OnModuleInit {
  private readonly logger = new Logger(BacnetMqttSubscriber.name);

  constructor(
    private readonly mqttService: MqttService,
    private readonly telemetryGateway: TelemetryGateway,
    private readonly deviceStatus: DeviceStatusService,
    private readonly gatewayStatus: GatewayStatusService,
    private readonly gatewayHealth: GatewayHealthService,
    private readonly deviceHeartbeat: DeviceHeartbeatService,
    private readonly gatewayOta: GatewayOtaService,
    private readonly trendRecorder: TrendRecorderService,
    private readonly alarmEngine: AlarmEngineService,
    private readonly metrics: IngestionMetricsService,
    private readonly cameraLastValue: CameraLastValueService,
  ) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/telemetry', 0);
    this.mqttService.subscribe('bluebee/+/gateway/+/commands/result', 0);
    // QoS 1 no status: LWT/heartbeat são sinais de estado que não podem se
    // perder; retido garante reentrega do último status ao (re)subscrever.
    this.mqttService.subscribe('bluebee/+/gateway/+/status', 1);
    // Resumo de saúde do gateway (aditivo): fila offline, reconexões MQTT e
    // latência de polling. Retido no gateway → reentrega o último ao (re)subscrever.
    this.mqttService.subscribe('bluebee/+/gateway/+/health', 0);
    // Progresso da atualização remota (OTA) — baixando/aplicando/reiniciando/
    // concluído/falhou. QoS 1: estágios finais não podem se perder.
    this.mqttService.subscribe('bluebee/+/gateway/+/ota', 1);
    // Presença/heartbeat de DISPOSITIVOS MQTT (equipamentos que publicam só na
    // mudança de valor) — o gateway assina o tópico de presença declarado e
    // reencaminha aqui para manter o device online sem telemetria nova.
    this.mqttService.subscribe('bluebee/+/gateway/+/device-heartbeat', 0);
    this.mqttService.onMessage(this.handleMessage.bind(this));

    this.logger.log(
      'BacnetMqttSubscriber initialized — listening for telemetry, command results, gateway status and health',
    );
  }

  private handleMessage(topic: string, rawPayload: Buffer): void {
    if (topic.endsWith('/telemetry')) {
      this.handleTelemetry(topic, rawPayload);
      return;
    }

    if (topic.endsWith('/commands/result')) {
      this.handleCommandResult(topic, rawPayload);
      return;
    }

    if (topic.endsWith('/status')) {
      this.handleGatewayStatus(topic, rawPayload);
      return;
    }

    if (topic.endsWith('/health')) {
      this.handleGatewayHealth(topic, rawPayload);
      return;
    }

    if (topic.endsWith('/ota')) {
      this.handleGatewayOta(topic, rawPayload);
      return;
    }

    if (topic.endsWith('/device-heartbeat')) {
      this.handleDeviceHeartbeat(topic, rawPayload);
      return;
    }
  }

  /**
   * Heartbeat de presença de um dispositivo MQTT (reenviado pelo gateway a
   * partir do tópico de presença declarado no cadastro). Mantém o device
   * online pela janela configurada mesmo sem mudança de valor nos pontos.
   * Tópico: bluebee/{tenant}/gateway/{id}/device-heartbeat
   */
  private handleDeviceHeartbeat(topic: string, rawPayload: Buffer): void {
    if (rawPayload.length === 0) return;

    let data: { deviceId?: string; timeoutSeconds?: number; payload?: unknown };
    try {
      data = JSON.parse(rawPayload.toString()) as {
        deviceId?: string;
        timeoutSeconds?: number;
        payload?: unknown;
      };
    } catch {
      this.metrics.recordParseError();
      this.logger.error(`Failed to parse device heartbeat payload from topic: ${topic}`);
      return;
    }

    if (!data.deviceId) return;
    const timeoutSeconds = Number(data.timeoutSeconds);
    const windowMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds * 1000
      : undefined;

    this.deviceStatus.markDeviceHeartbeat(data.deviceId, windowMs);
    // Diagnóstico do heartbeat (RSSI/IP/uptime quando o firmware reporta) —
    // guarda o último por dispositivo, em memória, para a tela do device.
    this.deviceHeartbeat.apply(
      data.deviceId,
      data.payload ?? null,
      Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : null,
    );
    this.logger.debug(
      `Device heartbeat — device: ${data.deviceId}, window: ${windowMs ?? 'default'}ms`,
    );
  }

  /**
   * Progresso da atualização OTA reportado pelo gateway.
   * Tópico: bluebee/{tenant}/gateway/{id}/ota
   */
  private handleGatewayOta(topic: string, rawPayload: Buffer): void {
    if (rawPayload.length === 0) return;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawPayload.toString()) as Record<string, unknown>;
    } catch {
      this.metrics.recordParseError();
      this.logger.error(`Failed to parse gateway OTA payload from topic: ${topic}`);
      return;
    }

    const gatewayId = topic.split('/')[3];
    const stage = String(data.stage ?? '');
    const validStages: GatewayOtaStage[] = [
      'downloading',
      'applying',
      'restarting',
      'completed',
      'failed',
      'rolled_back',
    ];
    if (!gatewayId || !validStages.includes(stage as GatewayOtaStage)) return;

    const progress: GatewayOtaProgress = {
      commandId: String(data.command_id ?? ''),
      stage: stage as GatewayOtaStage,
      version: String(data.version ?? ''),
      fromVersion: String(data.fromVersion ?? ''),
      error: typeof data.error === 'string' && data.error ? data.error : null,
      ts: typeof data.ts === 'string' ? data.ts : new Date().toISOString(),
      receivedAt: new Date().toISOString(),
    };
    this.gatewayOta.apply(gatewayId, progress);
    this.logger.log(
      `Gateway OTA progress — gateway: ${gatewayId}, stage: ${progress.stage}, version: ${progress.version}`,
    );
  }

  /**
   * Resumo de saúde do gateway — sinal OBSERVACIONAL (fila offline, reconexões
   * MQTT, latência de polling), independente do liveness (LWT/heartbeat).
   * Tópico: bluebee/{tenant}/gateway/{id}/health
   * Aditivo: não altera status online/offline nem os assinantes existentes.
   */
  private handleGatewayHealth(topic: string, rawPayload: Buffer): void {
    // Payload vazio = mensagem retida sendo limpa; nada a fazer.
    if (rawPayload.length === 0) return;

    let data: Partial<GatewayHealthSummary>;
    try {
      data = JSON.parse(rawPayload.toString()) as Partial<GatewayHealthSummary>;
    } catch {
      this.metrics.recordParseError();
      this.logger.error(`Failed to parse gateway health payload from topic: ${topic}`);
      return;
    }

    const gatewayId = topic.split('/')[3];
    if (!gatewayId || typeof data !== 'object' || data === null || !data.mqtt) return;

    const summary: GatewayHealthSummary = {
      timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      uptimeSeconds: typeof data.uptimeSeconds === 'number' ? data.uptimeSeconds : 0,
      version: typeof data.version === 'string' && data.version ? data.version : undefined,
      otaSupported: data.otaSupported === true,
      mqtt: {
        connected: Boolean(data.mqtt.connected),
        broker: data.mqtt.broker,
        connectCount: data.mqtt.connectCount,
        reconnectCount: data.mqtt.reconnectCount,
        lastConnectedAt: data.mqtt.lastConnectedAt ?? null,
        lastDisconnectedAt: data.mqtt.lastDisconnectedAt ?? null,
        lastError: data.mqtt.lastError ?? null,
      },
      storeAndForward: {
        pending: Number(data.storeAndForward?.pending ?? 0),
        dropped: Number(data.storeAndForward?.dropped ?? 0),
      },
      polling: Array.isArray(data.polling) ? data.polling : [],
    };

    this.gatewayHealth.apply(gatewayId, summary);
    // Persiste a versão reportada (só quando muda) — visível mesmo após restart.
    if (summary.version) {
      this.gatewayOta.recordReportedVersion(gatewayId, summary.version);
    }
    this.logger.debug(
      `Gateway health received — gateway: ${gatewayId}, pending: ${summary.storeAndForward.pending}, dropped: ${summary.storeAndForward.dropped}`,
    );
  }

  /**
   * Status de liveness do gateway (LWT/heartbeat) — sinal EXPLÍCITO de
   * online/offline, independente da recência de telemetria.
   * Tópico: bluebee/{tenant}/gateway/{id}/status
   */
  private handleGatewayStatus(topic: string, rawPayload: Buffer): void {
    // Payload vazio = mensagem retida sendo limpa; nada a fazer.
    if (rawPayload.length === 0) return;

    let data: GatewayStatusPayload;
    try {
      data = JSON.parse(rawPayload.toString()) as GatewayStatusPayload;
    } catch {
      this.metrics.recordParseError();
      this.logger.error(`Failed to parse gateway status payload from topic: ${topic}`);
      return;
    }

    this.metrics.recordStatus();

    const gatewayId = topic.split('/')[3];
    if (!gatewayId || (data.status !== 'online' && data.status !== 'offline')) return;

    this.logger.debug(
      `Gateway status received — gateway: ${gatewayId}, status: ${data.status}, reason: ${data.reason ?? 'heartbeat'}`,
    );

    void this.gatewayStatus.apply(gatewayId, data.status);
  }

  private handleTelemetry(topic: string, rawPayload: Buffer): void {
    let data: BacnetTelemetryPayload;

    try {
      data = JSON.parse(rawPayload.toString()) as BacnetTelemetryPayload;
    } catch {
      this.metrics.recordParseError();
      this.logger.error(`Failed to parse telemetry payload from topic: ${topic}`);
      return;
    }

    const pointCount = Array.isArray(data.points) ? data.points.length : 0;
    this.metrics.recordTelemetry(pointCount);
    this.logger.debug(
      `Telemetry received — topic: ${topic}, device: ${data.deviceId ?? 'unknown'}, points: ${pointCount}`,
    );

    // Marca device E gateway como vistos agora — base única do status ao vivo
    // (online/offline). tenant/gateway vêm do tópico: bluebee/{tenant}/gateway/{id}/telemetry
    const parts = topic.split('/');
    const tenantId = parts[1];
    if (data.deviceId) {
      this.deviceStatus.markSeen(data.deviceId);
    }
    const gatewayId = parts[3];
    if (gatewayId) {
      this.deviceStatus.markSeen(gatewayId);
    }

    // Escopo por tenant (room) — isolamento entre clientes de tenants diferentes.
    this.telemetryGateway.emitTelemetry(data, tenantId);

    // Persiste histórico apenas dos pontos com Trend configurada (opt-in).
    this.trendRecorder.consume(data);

    // Câmeras CFTV: persiste o último valor lido de cada ponto (status inicial
    // imediato na UI). No-op para os demais dispositivos.
    this.cameraLastValue.consume(data);

    // Avalia as regras de alarme dos pontos presentes neste ciclo.
    this.alarmEngine.consume(data);
  }

  private handleCommandResult(topic: string, rawPayload: Buffer): void {
    let data: CommandResultPayload;

    try {
      data = JSON.parse(rawPayload.toString()) as CommandResultPayload;
    } catch {
      this.metrics.recordParseError();
      this.logger.error(
        `Failed to parse command result payload from topic: ${topic}`,
      );
      return;
    }

    this.metrics.recordCommandResult();

    this.logger.debug(
      `Command result received — topic: ${topic}, command_id: ${data.command_id}, success: ${data.success}`,
    );

    // Escopo por tenant (room), extraído do tópico:
    // bluebee/{tenant}/gateway/{id}/commands/result
    const tenantId = topic.split('/')[1];
    this.telemetryGateway.emitCommandResult(data, tenantId);
  }
}
