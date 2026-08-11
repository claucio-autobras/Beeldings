import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { PollingMetricsService } from '../observability/polling-metrics.service';
import { readSnmpOids, readSnmpStrings, readSnmpTable } from './snmp-read.util';
import { pingPacketLoss } from '../cameras/ping.util';
import { fetchIsapiUptime } from '../cameras/isapi.util';
import { SnmpDriver } from '../drivers/snmp.driver';
import type { DriverTelemetryPoint } from '../drivers/collection-driver.interface';

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
  /**
   * Para pontos de tabela IF-MIB (switches): índice da linha da tabela.
   * Ex.: ifIndex=3 → coleta o row .3 da coluna configurada no perfil.
   */
  ifIndex?: number;
  /**
   * 'table' → ponto coletado via subtree walk (readTable).
   * Ausente ou 'scalar' → GET escalar em lote (comportamento histórico).
   */
  collectionType?: 'scalar' | 'table';
}

/** Bloco de config de um device SNMP monitorado dentro do payload de config do gateway. */
interface SnmpDeviceBlock {
  deviceId: string;
  name: string;
  protocol?: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  pollingIntervalMs: number;
  /** Tipo do dispositivo monitorado: 'CAMERA' | 'SWITCH' | 'NVR' | … */
  monitoredDeviceType?: string | null;
  /** Fabricante do cadastro (manual/probe) — precedência máxima na identificação. */
  manufacturer?: string | null;
  /** ID de perfil forçado (Device.config.profileId). */
  profileId?: string | null;
  /** Overrides de mapeamento por métrica (Device.config.profileOverrides). */
  profileOverrides?: Record<string, unknown> | null;
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
  driver: SnmpDriver;
}

/**
 * SnmpPollingService
 *
 * Consome a config publicada pelo backend (tópico .../config) e processa os
 * blocos `protocol: 'snmp'` (dispositivos monitorados via SNMP). A coleta é
 * delegada ao SnmpDriver (motor de perfis declarativos de 3 camadas):
 *
 *   1. MIB-II padrão (sysUpTime, ifInDiscards/ifInErrors) — universal.
 *   2. Perfil do fabricante (OIDs enterprise + ISAPI) — via profile-registry.
 *   3. Fallback sintético (ping).
 *
 * Publica no tópico canônico de telemetria:
 *   bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 *
 * Regra central: se o device NÃO responde (timeout), publica STATUS=0 e os
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
        this.logger.log(`Polling SNMP encerrado para ${key} (device removido da config)`);
      }
    }
    this.dynamicKeys = newKeys;
    this.logger.log(`Config dinâmica SNMP aplicada — ${devices.length} device(s)`);
  }

  private startPoll(device: SnmpDeviceBlock): void {
    this.stopPoll(device.deviceId);

    const intervalMs = device.pollingIntervalMs || 30_000;
    this.logger.log(
      `SNMP ${device.deviceId} (${device.ip}:${device.port}, v${device.snmpVersion}): ` +
        `polling a cada ${intervalMs}ms — ${device.points.length} ponto(s)` +
        (device.manufacturer ? `, fabricante=${device.manufacturer}` : '') +
        (device.monitoredDeviceType ? `, tipo=${device.monitoredDeviceType}` : ''),
    );

    const state: ActiveSnmpPoll = {
      handle: undefined as never,
      polling: false,
      driver: new SnmpDriver({
        readNumbers: readSnmpOids,
        readStrings: readSnmpStrings,
        pingLoss: pingPacketLoss,
        isapiUptime: fetchIsapiUptime,
        // Injeta readTable para devices que usam coleta por subtree walk:
        //   SWITCH → tabela IF-MIB por porta (ifIndex)
        //   NVR    → tabelas de disco/canal (slotIndex / channelIndex)
        ...(device.monitoredDeviceType === 'SWITCH' || device.monitoredDeviceType === 'NVR'
          ? { readTable: readSnmpTable }
          : {}),
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
    state.driver.dispose();
    this.activePolls.delete(deviceId);
  }

  /** Um ciclo de polling: driver coleta com motor de perfis e o resultado é publicado. */
  private async pollDevice(state: ActiveSnmpPoll, device: SnmpDeviceBlock): Promise<void> {
    if (state.polling) {
      return; // ciclo anterior ainda em andamento (device lento) — pula
    }
    state.polling = true;
    const startedAt = Date.now();

    try {
      const result = await state.driver.runCycle({
        deviceId: device.deviceId,
        ip: device.ip,
        monitoredDeviceType: device.monitoredDeviceType,
        manufacturer: device.manufacturer ?? null,
        profileId: device.profileId ?? null,
        profileOverrides: device.profileOverrides ?? null,
        snmp: {
          ip: device.ip,
          port: device.port,
          snmpVersion: device.snmpVersion,
          community: device.community,
        },
        http: device.http ?? null,
        points: device.points,
      });

      const points: DriverTelemetryPoint[] = result.points;
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
        `[${device.deviceId}] Ciclo SNMP (perfil=${state.driver.profileId ?? 'base'}): ` +
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
