import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { PollingMetricsService } from '../observability/polling-metrics.service';
import { readSnmpOids, readSnmpStrings } from './snmp-read.util';
import {
  CameraTelemetryEngine,
  type EngineTelemetryPoint,
} from '../cameras/camera-telemetry.engine';
import { pingPacketLoss } from '../cameras/ping.util';
import { fetchIsapiUptime } from '../cameras/isapi.util';

/** Ponto SNMP de um device (vem do binding cadastrado no backend). */
interface SnmpPointConfig {
  tag: string;
  /** 'status' | 'uptime' | 'memory' | 'packet_loss' | 'ping_loss' | 'custom'… */
  metric: string;
  /** OID consultado — null para pontos derivados ('status', 'ping_loss'). */
  oid: string | null;
  scale: number;
  unit: string | null;
  /** OID comprovadamente não suportado (diagnóstico) — excluído do GET. */
  unsupported?: boolean;
}

/** Bloco de config de uma câmera SNMP dentro do payload de config do gateway. */
interface SnmpDeviceBlock {
  deviceId: string;
  name: string;
  protocol?: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  pollingIntervalMs: number;
  /** Fabricante do cadastro (manual/probe) — precedência máxima na identificação. */
  manufacturer?: string | null;
  /** Credenciais HTTP p/ fallback proprietário (ex.: ISAPI Hikvision). */
  http?: { username: string; password: string; port?: number } | null;
  points: SnmpPointConfig[];
}

interface GatewayConfigPayload {
  tenantId: string;
  gatewayId: string;
  devices: SnmpDeviceBlock[];
}

interface ActiveSnmpPoll {
  handle: ReturnType<typeof setInterval>;
  polling: boolean;
  engine: CameraTelemetryEngine;
}

/**
 * SnmpPollingService
 *
 * Consome a config publicada pelo backend (tópico .../config) e processa os
 * blocos `protocol: 'snmp'` (câmeras CFTV). A coleta é delegada ao motor
 * genérico de 3 camadas (CameraTelemetryEngine + provider-registry): MIB-II
 * padrão → provider do fabricante (SNMP enterprise/ISAPI) → fallback
 * sintético (ping). Publica no tópico canônico de telemetria:
 *
 *   bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 *
 * Regra central: se a câmera NÃO responde (timeout), publica STATUS=0 e os
 * demais pontos como null — o "offline" é um dado, não um silêncio.
 */
@Injectable()
export class SnmpPollingService implements OnModuleDestroy {
  private readonly logger = new Logger(SnmpPollingService.name);
  private readonly tenantId: string;
  private readonly gatewayId: string;

  /** Polls ativos keyed por deviceId. */
  private readonly activePolls = new Map<string, ActiveSnmpPoll>();
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
    for (const key of this.activePolls.keys()) {
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
    const snmpDevices = payload.devices.filter((d) => d.protocol === 'snmp');
    this.applyConfig(snmpDevices);
  }

  private applyConfig(devices: SnmpDeviceBlock[]): void {
    const newKeys = new Set<string>();
    for (const d of devices) {
      newKeys.add(d.deviceId);
      this.startPoll(d);
    }
    for (const key of this.dynamicKeys) {
      if (!newKeys.has(key)) {
        this.stopPoll(key);
        this.logger.log(`Polling SNMP encerrado para ${key} (câmera removida da config)`);
      }
    }
    this.dynamicKeys = newKeys;
    this.logger.log(`Config dinâmica SNMP aplicada — ${devices.length} câmera(s)`);
  }

  private startPoll(device: SnmpDeviceBlock): void {
    this.stopPoll(device.deviceId);

    const intervalMs = device.pollingIntervalMs || 30_000;
    this.logger.log(
      `Câmera SNMP ${device.deviceId} (${device.ip}:${device.port}, v${device.snmpVersion}): ` +
        `polling a cada ${intervalMs}ms — ${device.points.length} ponto(s)` +
        (device.manufacturer ? `, fabricante=${device.manufacturer}` : ''),
    );

    const state: ActiveSnmpPoll = {
      handle: undefined as never,
      polling: false,
      engine: new CameraTelemetryEngine({
        readNumbers: readSnmpOids,
        readStrings: readSnmpStrings,
        pingLoss: pingPacketLoss,
        isapiUptime: fetchIsapiUptime,
      }),
    };
    void this.pollDevice(state, device);
    state.handle = setInterval(() => {
      void this.pollDevice(state, device);
    }, intervalMs);
    this.activePolls.set(device.deviceId, state);
  }

  private stopPoll(deviceId: string): void {
    const state = this.activePolls.get(deviceId);
    if (!state) {
      return;
    }
    if (state.handle) {
      clearInterval(state.handle);
    }
    this.activePolls.delete(deviceId);
  }

  /** Um ciclo de polling: motor de 3 camadas coleta e o resultado é publicado. */
  private async pollDevice(state: ActiveSnmpPoll, device: SnmpDeviceBlock): Promise<void> {
    if (state.polling) {
      return; // ciclo anterior ainda em andamento (câmera lenta) — pula
    }
    state.polling = true;
    const startedAt = Date.now();

    try {
      const result = await state.engine.runCycle({
        deviceId: device.deviceId,
        ip: device.ip,
        manufacturer: device.manufacturer ?? null,
        snmp: {
          ip: device.ip,
          port: device.port,
          snmpVersion: device.snmpVersion,
          community: device.community,
        },
        http: device.http ?? null,
        points: device.points,
      });

      const points: EngineTelemetryPoint[] = result.points;
      const elapsedMs = Date.now() - startedAt;
      this.pollingMetrics.record({
        protocol: 'snmp',
        deviceId: device.deviceId,
        latencyMs: elapsedMs,
        pointsRead: result.reachable
          ? points.filter((pt) => pt.value !== null).length
          : 0,
        pointsAttempted: device.points.length,
      });

      this.logger.debug(
        `[${device.deviceId}] Ciclo SNMP (${state.engine.providerId ?? 'sem provider'}): ` +
          `${result.reachable ? 'online' : 'OFFLINE'} — ${points.length} ponto(s) em ${elapsedMs}ms`,
      );

      const topic = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/telemetry`;
      this.mqttService.publish(topic, {
        timestamp: new Date().toISOString(),
        deviceId: device.deviceId,
        points,
      });
    } finally {
      state.polling = false;
    }
  }
}
