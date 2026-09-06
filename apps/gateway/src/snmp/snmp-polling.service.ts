import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { PollingMetricsService } from '../observability/polling-metrics.service';
import { computeStartJitterMs } from '../observability/poll-jitter.util';
import {
  readSnmpOids,
  readSnmpStrings,
  readSnmpTable,
  type SnmpV3Credentials,
} from './snmp-read.util';
import { walkSnmpSubtree } from './snmp-walk.util';
import { pingPacketLoss } from '../cameras/ping.util';
import { fetchIsapiUptime } from '../cameras/isapi.util';
import { SnmpDriver } from '../drivers/snmp.driver';
import type { DriverTelemetryPoint } from '../drivers/collection-driver.interface';
import { ReachabilityTracker } from './reachability-tracker';

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
  /** 'table' identifica coluna+índice persistidos; a coleta continua sendo GET. */
  collectionType?: 'scalar' | 'table';
  /**
   * OIDs membros de uma métrica agregada (cpu média / memória percentual)
   * persistidos em device_metric_binding.memberOids. Repassados ao driver,
   * que os inclui no GET em lote (NUNCA walk) para re-derivar o valor.
   */
  memberOids?: string[];
}

/** Bloco de config de um device SNMP monitorado dentro do payload de config do gateway. */
interface SnmpDeviceBlock {
  deviceId: string;
  name: string;
  protocol?: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c' | '3';
  community: string;
  /** Credenciais USM (SNMPv3) — texto claro no payload de config (MQTT TLS). */
  v3?: SnmpV3Credentials | null;
  /**
   * Compatibilidade de payload. Na fase 3 o driver sempre coleta apenas
   * bindings persistidos por GET, independentemente deste valor.
   */
  restrictToBindings?: boolean;
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
  /** Delay de partida (jitter) — pendente até o primeiro ciclo. */
  startTimeout: ReturnType<typeof setTimeout> | null;
  polling: boolean;
  driver: SnmpDriver;
  /** Chave estável do bloco de config — config idêntica não reinicia o poll. */
  configKey: string;
  /** Rastreador de alcançabilidade para pontos metric='reachability'. */
  reachabilityTracker: ReachabilityTracker;
}

/**
 * Janela máxima de jitter da PRIMEIRA leitura de um device novo/alterado
 * (config recebida após a config inicial do boot). Mantém a partida
 * determinística (mesmo hash por deviceId) mas encurta a espera para
 * segundos — o card do cadastro não fica minutos em "Sem dados".
 */
const PROMPT_START_WINDOW_MS = 5_000;

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

  /**
   * Primeira config após o boot já foi aplicada? A config inicial (tópico
   * retido) usa o jitter cheio — restart do gateway com muitos devices não
   * pode virar rajada. Configs seguintes só reiniciam devices novos/alterados,
   * e esses partem com jitter encurtado (primeira leitura pronta).
   */
  private initialConfigApplied = false;

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
    const isInitialConfig = !this.initialConfigApplied;
    this.initialConfigApplied = true;

    const newKeys = new Set<string>();
    let started = 0;
    for (const d of devices) {
      newKeys.add(d.deviceId);
      // Config inalterada NÃO reinicia o poll: preserva o cache de
      // identificação do driver, amostras de counter e a fase do jitter —
      // editar um device não pode regredir leituras dos demais.
      const configKey = this.configKeyFor(d);
      const existing = this.activePolls.get(d.deviceId);
      if (existing && existing.configKey === configKey) {
        continue;
      }
      // Device novo/alterado após a config inicial: primeira leitura pronta
      // (jitter encurtado). Na config inicial do boot, jitter cheio.
      this.startPoll(d, configKey, !isInitialConfig);
      started++;
    }
    for (const key of this.dynamicKeys) {
      if (!newKeys.has(key)) {
        this.stopPoll(key);
        this.logger.log(`Polling SNMP encerrado para ${key} (device removido da config)`);
      }
    }
    this.dynamicKeys = newKeys;
    this.logger.log(
      `Config dinâmica SNMP aplicada — ${devices.length} device(s), ${started} (re)iniciado(s)`,
    );
  }

  /**
   * Chave estável do bloco de config: pontos ordenados por tag antes do
   * stringify para evitar reinicialização por diferença de ordem.
   */
  private configKeyFor(device: SnmpDeviceBlock): string {
    return JSON.stringify({
      ...device,
      points: [...(device.points ?? [])].sort((a, b) => a.tag.localeCompare(b.tag)),
    });
  }

  private startPoll(device: SnmpDeviceBlock, configKey?: string, promptStart = false): void {
    this.stopPoll(device.deviceId);

    const intervalMs = device.pollingIntervalMs || 30_000;
    // Jitter determinístico de partida: espalha os ciclos dos devices do
    // gateway dentro do intervalo, evitando rajadas sincronizadas no broker.
    // Device novo/alterado (config pós-boot) parte numa janela curta — a
    // primeira leitura chega em segundos sem perder o determinismo por device.
    const jitterMs = computeStartJitterMs(
      device.deviceId,
      promptStart ? Math.min(intervalMs, PROMPT_START_WINDOW_MS) : intervalMs,
    );
    this.logger.log(
      `SNMP ${device.deviceId} (${device.ip}:${device.port}, v${device.snmpVersion}): ` +
        `polling a cada ${intervalMs}ms — ${device.points.length} ponto(s)` +
        (device.manufacturer ? `, fabricante=${device.manufacturer}` : '') +
        (device.monitoredDeviceType ? `, tipo=${device.monitoredDeviceType}` : '') +
        ` (partida em ${jitterMs}ms)`,
    );

    const state: ActiveSnmpPoll = {
      handle: undefined as never,
      startTimeout: null,
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
        readWalk: (target, root) => walkSnmpSubtree({
          ip: target.ip,
          port: target.port,
          version: target.snmpVersion,
          community: target.community,
          v3: target.v3,
        }, root, { budgetMs: 8_000, requestTimeoutMs: 2_000 }),
      }),
      configKey: configKey ?? this.configKeyFor(device),
      reachabilityTracker: new ReachabilityTracker(),
    };
    state.startTimeout = setTimeout(() => {
      state.startTimeout = null;
      void this.pollDevice(state, device);
      state.handle = setInterval(() => {
        void this.pollDevice(state, device);
      }, intervalMs);
    }, jitterMs);
    this.activePolls.set(device.deviceId, state);
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
    state.reachabilityTracker.dispose();
    this.activePolls.delete(deviceId);
  }

  /**
   * Constrói pontos sintéticos de alcançabilidade para os 3 métricas sintéticas:
   *   - metric='reachability'         → sucesso % na janela de 5 min (0–100)
   *   - metric='reachability_latency' → latência do último ciclo bem-sucedido (ms)
   *                                     null quando o dispositivo está offline
   *   - metric='reachability_failure_rate' → falha % na janela de 5 min (0–100)
   *
   * Cada métrica é publicada apenas se houver um ponto EXPLICITAMENTE configurado
   * com aquela métrica. O valor é atribuído à tag configurada — sem suposição
   * de nomenclatura. Nunca publica tags não configuradas.
   *
   * Compatibilidade retroativa: devices sem esses pontos não são afetados.
   */
  private buildReachabilityPoints(
    tracker: ReachabilityTracker,
    latencyMs: number | null,
    device: SnmpDeviceBlock,
  ): DriverTelemetryPoint[] {
    const REACHABILITY_METRICS = new Set([
      'reachability',
      'reachability_latency',
      'reachability_failure_rate',
    ]);

    const syntheticPoints = device.points.filter((p) => REACHABILITY_METRICS.has(p.metric));
    if (syntheticPoints.length === 0) return [];

    const successPct = tracker.successPercent();
    const failurePct = tracker.failurePercent();
    // Latência: null quando offline (sem resposta bem-sucedida no ciclo atual).
    const latencyValue = latencyMs;

    const result: DriverTelemetryPoint[] = [];

    for (const point of syntheticPoints) {
      switch (point.metric) {
        case 'reachability':
          result.push({
            tag: point.tag,
            value: successPct,
            unit: point.unit ?? '%',
            source: 'reachability',
          });
          break;

        case 'reachability_latency':
          result.push({
            tag: point.tag,
            // null quando offline — não publicar duração de timeout como latência.
            value: latencyValue,
            unit: point.unit ?? 'ms',
            source: 'reachability',
          });
          break;

        case 'reachability_failure_rate':
          result.push({
            tag: point.tag,
            value: failurePct,
            unit: point.unit ?? '%',
            source: 'reachability',
          });
          break;
      }
    }

    return result;
  }

  /** Um ciclo de polling: driver coleta com motor de perfis e o resultado é publicado. */
  private async pollDevice(state: ActiveSnmpPoll, device: SnmpDeviceBlock): Promise<void> {
    if (state.polling) {
      // Ciclo anterior ainda em andamento (device lento) — pula e contabiliza.
      this.pollingMetrics.recordSkipped({
        protocol: 'snmp',
        deviceId: device.deviceId,
        intervalMs: device.pollingIntervalMs || 30_000,
      });
      return;
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
          v3: device.v3 ?? undefined,
        },
        restrictToBindings: device.restrictToBindings === true,
        http: device.http ?? null,
        points: device.points,
      });

      const points: DriverTelemetryPoint[] = result.points;
      const elapsedMs = Date.now() - startedAt;

      // Registra resultado no rastreador de alcançabilidade e resolve pontos
      // sintéticos (reachability, reachability_latency, reachability_failure_rate).
      // Os pontos dessas métricas do driver retornam null (fora do catálogo do driver)
      // — são removidos e substituídos pelos pontos sintéticos abaixo.
      //
      // latencyForSynthetic: null quando offline (timeout não é latência real).
      const latencyForSynthetic: number | null = result.reachable ? elapsedMs : null;
      state.reachabilityTracker.record(result.reachable, elapsedMs);

      const SYNTHETIC_METRICS = new Set([
        'reachability',
        'reachability_latency',
        'reachability_failure_rate',
      ]);
      const reachabilityTags = new Set(
        device.points
          .filter((p) => SYNTHETIC_METRICS.has(p.metric))
          .map((p) => p.tag),
      );
      const reachabilityPoints = this.buildReachabilityPoints(
        state.reachabilityTracker,
        latencyForSynthetic,
        device,
      );
      // Filtra os pontos do driver para remover os que serão substituídos por
      // pontos sintéticos (reachability e reachability_latency).
      const allPoints: DriverTelemetryPoint[] = [
        ...points.filter((pt) => !reachabilityTags.has(pt.tag)),
        ...reachabilityPoints,
      ];

      this.pollingMetrics.record({
        protocol: 'snmp',
        deviceId: device.deviceId,
        latencyMs: elapsedMs,
        pointsRead: result.reachable
          ? points.filter((pt) => pt.value !== null).length
          : 0,
        pointsAttempted: device.points.length,
        intervalMs: device.pollingIntervalMs || 30_000,
      });

      this.logger.debug(
        `[${device.deviceId}] Ciclo SNMP (perfil=${state.driver.profileId ?? 'base'}): ` +
          `${result.reachable ? 'online' : 'OFFLINE'} — ${points.length} ponto(s) em ${elapsedMs}ms`,
      );

      const topic = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/telemetry`;
      this.mqttService.publish(topic, {
        timestamp: new Date().toISOString(),
        deviceId: device.deviceId,
        points: allPoints,
      });
    } catch (err) {
      // Isolamento do ciclo: exceção inesperada não pode escapar como unhandled
      // rejection (disparo é `void pollDevice(...)`) — loga e o próximo ciclo segue.
      this.logger.error(
        `[${device.deviceId}] Ciclo SNMP abortado por erro inesperado: ` +
          `${(err as Error)?.stack ?? (err as Error)?.message ?? String(err)}`,
      );
    } finally {
      state.polling = false;
    }
  }
}
