import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { PollingMetricsService } from '../observability/polling-metrics.service';
import {
  connectOnvif,
  getDeviceInformation,
  type OnvifCam,
} from './onvif-connection';
import { readSnmpOids } from '../snmp/snmp-read.util';
import { pingPacketLoss } from '../cameras/ping.util';
import { fetchIsapiUptime } from '../cameras/isapi.util';
import { resolveProvider } from '../cameras/provider-registry';

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

interface TelemetryPoint {
  tag: string;
  value: number | null;
  unit: string | null;
  /**
   * Estado do ponto quando o valor não é uma leitura direta:
   * 'waiting_event' (assinado, nenhum evento ainda), 'unsupported' (câmera
   * sem serviço de eventos), 'error' (falha de conexão/assinatura),
   * 'estimated' (valor sintético da Camada 3).
   */
  state?: 'waiting_event' | 'unsupported' | 'error' | 'estimated';
  /** Camada/fonte vencedora (diagnóstico). */
  source?: string;
}

interface ActiveOnvifPoll {
  handle: ReturnType<typeof setInterval> | null;
  polling: boolean;
  cam: OnvifCam | null;
  /** Últimos valores dos pontos de evento (mantidos entre ciclos de polling). */
  eventValues: Map<string, number>;
  device: OnvifDeviceBlock;
  stopped: boolean;
  /** Snapshot JSON do bloco de config — detecta mudanças sem reiniciar tudo. */
  configKey: string;
  /** Momento (epoch ms) do último evento de movimento (motion=1) recebido. */
  lastMotionAt: number | null;
  /** Latência (ms) do último GetDeviceInformation bem-sucedido. */
  lastLatencyMs: number | null;
  /**
   * Suporte a eventos ONVIF: 'unknown' até a 1ª conexão; 'supported' quando a
   * assinatura sobe (ou um evento chega); 'unsupported' quando a câmera não
   * expõe o serviço de eventos; 'error' quando a assinatura falhou.
   */
  eventsSupport: 'unknown' | 'supported' | 'unsupported' | 'error';
}

/** Mapeia palavras-chave do tópico do evento ONVIF → métrica canônica. */
const EVENT_TOPIC_METRIC: Array<{ pattern: RegExp; metric: string }> = [
  { pattern: /motion/i, metric: 'motion' },
  { pattern: /tamper/i, metric: 'tamper' },
  { pattern: /video.?loss|signal.?loss/i, metric: 'video_loss' },
];

/**
 * OnvifPollingService
 *
 * Consome a config publicada pelo backend (tópico .../config) e processa os
 * blocos `protocol: 'onvif'` (câmeras ONVIF). Para cada câmera:
 *
 *  - Polling periódico: GetDeviceInformation como "ping" ONVIF autenticado —
 *    respondeu → STATUS=1; falhou/timeout → STATUS=0 e demais pontos null
 *    (mesma regra do SNMP: offline é um dado, não um silêncio).
 *  - Ponto STREAM (quando cadastrado): GetStreamUri com sucesso → 1, falha → 0.
 *  - Eventos (motion/tamper/video_loss): assinatura pull-point da lib onvif;
 *    cada notificação vira o valor (0/1) do ponto correspondente, publicado
 *    imediatamente e mantido nos ciclos seguintes.
 *
 * Publica no MESMO tópico canônico de telemetria dos demais protocolos:
 *   bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 *
 * Tolerância a fabricantes: câmera sem serviço de eventos → só polling;
 * sem uptime (ONVIF não padroniza) → UPTIME=null. Nunca loga a senha.
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
      // Compara o bloco de config com o que já está rodando: câmera inalterada
      // NÃO é reiniciada (mantém assinatura de eventos e cadência). Câmera nova
      // ou editada (re)inicia o polling — startPoll faz a 1ª leitura imediata,
      // então cadastro/edição refletem na UI em segundos.
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
   * Chave estável do bloco de config: os pontos são ordenados por tag antes do
   * stringify — o backend não garante a ordem, e ordem diferente com o mesmo
   * conteúdo NÃO pode reiniciar a câmera (derruba a assinatura de eventos).
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
    this.logger.log(
      `Câmera ONVIF ${device.deviceId} (${device.ip}:${device.port}, user=${device.username}): ` +
        `polling a cada ${intervalMs}ms — ${device.points.length} ponto(s)`,
    );

    const state: ActiveOnvifPoll = {
      handle: null,
      polling: false,
      cam: null,
      eventValues: new Map(),
      device,
      stopped: false,
      configKey: configKey ?? this.configKeyFor(device),
      lastMotionAt: null,
      lastLatencyMs: null,
      eventsSupport: 'unknown',
    };
    this.activePolls.set(device.deviceId, state);

    void this.pollDevice(state);
    state.handle = setInterval(() => {
      void this.pollDevice(state);
    }, intervalMs);
  }

  private stopPoll(deviceId: string): void {
    const state = this.activePolls.get(deviceId);
    if (!state) {
      return;
    }
    state.stopped = true;
    if (state.handle) {
      clearInterval(state.handle);
    }
    this.detachCam(state);
    this.activePolls.delete(deviceId);
  }

  private detachCam(state: ActiveOnvifPoll): void {
    if (state.cam) {
      try {
        // Remove os listeners de evento — a lib para o pull-point sozinha.
        state.cam.removeAllListeners('event');
      } catch {
        // best-effort
      }
      state.cam = null;
    }
  }

  /** Um ciclo de polling: (re)conecta se preciso, lê status/stream e publica. */
  private async pollDevice(state: ActiveOnvifPoll): Promise<void> {
    if (state.polling || state.stopped) {
      return;
    }
    state.polling = true;
    const device = state.device;
    const startedAt = Date.now();

    let reachable = false;
    let streamOk: number | null = null;

    // Camada 3 (ping) em paralelo — só quando há ponto que a consome.
    const pingPromise: Promise<number | null> = device.points.some(
      (p) => p.metric === 'ping_loss',
    )
      ? pingPacketLoss(device.ip).catch(() => null)
      : Promise.resolve(null);

    // Camada 2 HTTP: uptime REAL via ISAPI quando o fabricante suporta
    // (registro de providers) — reusa as credenciais ONVIF do cadastro.
    const provider = resolveProvider({ manufacturer: device.manufacturer ?? null });
    const isapiPromise: Promise<number | null> =
      provider?.httpUptime === 'isapi' && device.points.some((p) => p.metric === 'uptime')
        ? fetchIsapiUptime({
            ip: device.ip,
            username: device.username,
            password: device.password,
          }).catch(() => null)
        : Promise.resolve(null);

    // Canal SNMP de saúde (híbrido): lido em paralelo ao "ping" ONVIF.
    // Falha SNMP NUNCA afeta o STATUS — os pontos de saúde apenas ficam null.
    // OIDs marcados como não suportados ficam fora do GET (em SNMP v1, um
    // único OID inválido derruba a requisição inteira) — publicados null.
    const healthPoints = device.snmpHealth
      ? device.points.filter((p) => p.oid && !p.unsupported)
      : [];
    const healthPromise: Promise<Array<number | null> | null> =
      healthPoints.length > 0 && device.snmpHealth
        ? readSnmpOids(
            {
              ip: device.ip,
              port: device.snmpHealth.port || 161,
              snmpVersion: device.snmpHealth.snmpVersion === '1' ? '1' : '2c',
              community: device.snmpHealth.community || 'public',
            },
            healthPoints.map((p) => p.oid as string),
          ).catch(() => null)
        : Promise.resolve(null);

    try {
      if (!state.cam) {
        state.cam = await connectOnvif({
          ip: device.ip,
          port: device.port,
          username: device.username,
          password: device.password,
        });
        if (state.stopped) {
          this.detachCam(state);
          return;
        }
        this.attachEventListener(state);
      }

      // "Ping" ONVIF autenticado — confirma que a câmera responde de verdade.
      // O tempo de ida-e-volta vira o ponto LATENCIA (ms).
      const pingStart = Date.now();
      await getDeviceInformation(state.cam);
      state.lastLatencyMs = Date.now() - pingStart;
      reachable = true;

      // Estado do stream (quando o ponto existe): GetStreamUri responde → 1.
      if (device.points.some((p) => p.metric === 'stream')) {
        streamOk = await this.checkStream(state.cam);
      }
    } catch (err) {
      // Conexão morreu (ou nunca subiu): derruba a Cam p/ reconectar no próximo ciclo.
      this.logger.debug(
        `[${device.deviceId}] ONVIF sem resposta (${device.ip}:${device.port}): ${(err as Error).message}`,
      );
      this.detachCam(state);
      reachable = false;
    }

    // Valores de saúde SNMP por tag (null = sem resposta/OID não suportado).
    const healthValues = new Map<string, number | null>();
    if (healthPoints.length > 0) {
      const raw = await healthPromise;
      healthPoints.forEach((p, i) => {
        const v = raw ? (raw[i] ?? null) : null;
        healthValues.set(p.tag, v === null ? null : v * (p.scale ?? 1));
      });
      if (raw === null) {
        this.logger.debug(
          `[${device.deviceId}] Canal SNMP de saúde sem resposta (${device.ip}) — pontos de saúde null`,
        );
      }
    }

    const [pingLoss, isapiUptime] = await Promise.all([pingPromise, isapiPromise]);

    try {
      const points: TelemetryPoint[] = device.points.map((p) => {
        if (p.oid) {
          return { tag: p.tag, value: healthValues.get(p.tag) ?? null, unit: p.unit ?? null };
        }
        if (p.metric === 'status') {
          return { tag: p.tag, value: reachable ? 1 : 0, unit: p.unit ?? null };
        }
        if (p.metric === 'stream') {
          return { tag: p.tag, value: reachable ? streamOk : null, unit: p.unit ?? null };
        }
        if (p.metric === 'latency') {
          // Latência do GetDeviceInformation deste ciclo (offline → null).
          return { tag: p.tag, value: reachable ? state.lastLatencyMs : null, unit: p.unit ?? null };
        }
        if (p.metric === 'ping_loss') {
          // Camada 3: perda de pacotes por ping ativo (sintético, qualquer marca).
          return {
            tag: p.tag,
            value: pingLoss,
            unit: p.unit ?? null,
            ...(pingLoss !== null
              ? { state: 'estimated' as const, source: 'ping' }
              : {}),
          };
        }
        if (p.metric === 'uptime') {
          // Uptime real via ISAPI (Camada 2) > estimativa do backend (Camada 3).
          if (isapiUptime !== null) {
            return { tag: p.tag, value: isapiUptime, unit: p.unit ?? null, source: 'http' };
          }
          return { tag: p.tag, value: null, unit: p.unit ?? null, state: 'estimated' as const };
        }
        if (p.metric === 'last_motion') {
          // Segundos desde o último evento de movimento (null até o 1º evento).
          const value =
            reachable && state.lastMotionAt !== null
              ? Math.max(0, Math.round((Date.now() - state.lastMotionAt) / 1000))
              : null;
          return { tag: p.tag, value, unit: p.unit ?? null };
        }
        if (this.isEventMetric(p.metric)) {
          // Eventos: além do valor 0/1, o ponto carrega o ESTADO da assinatura —
          // "aguardando evento" ≠ "não suportado" ≠ "erro" (nunca ambíguo na UI).
          const last = state.eventValues.get(p.metric);
          if (!reachable) {
            return { tag: p.tag, value: null, unit: p.unit ?? null, state: 'error' as const };
          }
          if (last !== undefined) {
            return { tag: p.tag, value: last, unit: p.unit ?? null };
          }
          if (state.eventsSupport === 'unsupported') {
            return { tag: p.tag, value: null, unit: p.unit ?? null, state: 'unsupported' as const };
          }
          if (state.eventsSupport === 'error') {
            return { tag: p.tag, value: null, unit: p.unit ?? null, state: 'error' as const };
          }
          // Assinatura ativa (ou ainda subindo), nenhum evento recebido ainda.
          return { tag: p.tag, value: 0, unit: p.unit ?? null, state: 'waiting_event' as const };
        }
        // demais métricas sem fonte ONVIF padronizada → null
        return { tag: p.tag, value: null, unit: p.unit ?? null };
      });

      const elapsedMs = Date.now() - startedAt;
      this.pollingMetrics.record({
        protocol: 'onvif',
        deviceId: device.deviceId,
        latencyMs: elapsedMs,
        pointsRead: reachable ? points.filter((pt) => pt.value !== null).length : 0,
        pointsAttempted: device.points.length,
      });

      this.logger.debug(
        `[${device.deviceId}] Ciclo ONVIF: ${reachable ? 'online' : 'OFFLINE'} — ` +
          `${points.length} ponto(s) em ${elapsedMs}ms`,
      );

      this.publishTelemetry(device.deviceId, points);
    } finally {
      state.polling = false;
    }
  }

  private isEventMetric(metric: string): boolean {
    return metric === 'motion' || metric === 'tamper' || metric === 'video_loss';
  }

  /** GetStreamUri → 1 quando a câmera devolve uma URI de stream válida. */
  private checkStream(cam: OnvifCam): Promise<number> {
    return new Promise((resolve) => {
      try {
        cam.getStreamUri({ protocol: 'RTSP' }, (err, stream) => {
          resolve(!err && stream?.uri ? 1 : 0);
        });
      } catch {
        resolve(0);
      }
    });
  }

  /**
   * Assina os eventos da câmera (a lib onvif cria a pull-point subscription
   * automaticamente ao registrar o listener 'event'). Câmeras sem serviço de
   * eventos simplesmente não emitem nada — degradação tolerante.
   */
  private attachEventListener(state: ActiveOnvifPoll): void {
    const device = state.device;
    const cam = state.cam;
    if (!cam) return;

    const eventMetrics = device.points.filter((p) => this.isEventMetric(p.metric));
    if (eventMetrics.length === 0) {
      return;
    }

    // Câmera declarou não ter serviço de eventos → pontos ficam "não suportado".
    if (cam.capabilities && !cam.capabilities.events) {
      state.eventsSupport = 'unsupported';
      this.logger.warn(
        `[${device.deviceId}] Câmera sem serviço de eventos ONVIF (capabilities) — ` +
          `pontos de evento marcados como não suportados`,
      );
      return;
    }

    try {
      cam.on('event', (message: unknown) => {
        try {
          this.handleCameraEvent(state, message);
        } catch (err) {
          this.logger.debug(
            `[${device.deviceId}] Evento ONVIF ignorado: ${(err as Error).message}`,
          );
        }
      });
      state.eventsSupport = 'supported';
      this.logger.log(
        `[${device.deviceId}] Assinatura de eventos ONVIF ativa ` +
          `(${eventMetrics.map((p) => p.metric).join(', ')})`,
      );
    } catch (err) {
      state.eventsSupport = 'error';
      this.logger.warn(
        `[${device.deviceId}] Falha ao assinar eventos ONVIF — seguindo só com polling ` +
          `(${(err as Error).message})`,
      );
    }
  }

  /** Converte a notificação ONVIF em valor 0/1 do ponto correspondente. */
  private handleCameraEvent(state: ActiveOnvifPoll, message: unknown): void {
    const topicStr = this.extractEventTopic(message);
    if (!topicStr) return;

    const match = EVENT_TOPIC_METRIC.find((m) => m.pattern.test(topicStr));
    if (!match) return;

    const point = state.device.points.find((p) => p.metric === match.metric);
    if (!point) return;

    const value = this.extractEventValue(message);
    if (value === null) return;

    const previous = state.eventValues.get(match.metric);
    state.eventValues.set(match.metric, value);
    state.eventsSupport = 'supported'; // evento real chegou — suporte confirmado
    // Movimento detectado → âncora do ponto ULTIMO_MOVIMENTO (s desde o evento).
    if (match.metric === 'motion' && value === 1) {
      state.lastMotionAt = Date.now();
    }
    if (previous === value) {
      return; // sem mudança de estado — não republica
    }

    this.logger.log(
      `[${state.device.deviceId}] Evento ONVIF: ${match.metric} → ${value} (${topicStr})`,
    );
    this.publishTelemetry(state.device.deviceId, [
      { tag: point.tag, value, unit: point.unit ?? null },
    ]);
  }

  /** Extrai a string do tópico da notificação (formatos variam por fabricante). */
  private extractEventTopic(message: unknown): string | null {
    const msg = message as { topic?: { _?: string } | string };
    if (!msg || !msg.topic) return null;
    if (typeof msg.topic === 'string') return msg.topic;
    return typeof msg.topic._ === 'string' ? msg.topic._ : null;
  }

  /** Extrai o valor booleano do primeiro simpleItem da notificação → 0/1. */
  private extractEventValue(message: unknown): number | null {
    const msg = message as {
      message?: { message?: { data?: { simpleItem?: unknown } } };
    };
    const rawItems = msg?.message?.message?.data?.simpleItem;
    if (rawItems === undefined) return null;
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    for (const item of items) {
      const value = (item as { $?: { Value?: unknown } })?.$?.Value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (value === 'true' || value === '1' || value === 1) return 1;
      if (value === 'false' || value === '0' || value === 0) return 0;
    }
    return null;
  }

  private publishTelemetry(deviceId: string, points: TelemetryPoint[]): void {
    const topic = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/telemetry`;
    this.mqttService.publish(topic, {
      timestamp: new Date().toISOString(),
      deviceId,
      points,
    });
  }
}
