/**
 * OnvifDriver — coleta ONVIF para câmeras IP.
 *
 * Encapsula todo o estado por câmera que antes vivia em ActiveOnvifPoll
 * dentro do OnvifPollingService:
 *   - Conexão Cam (reconexão automática em caso de falha).
 *   - Map de valores de eventos (motion/tamper/video_loss) entre ciclos.
 *   - Suporte a eventos (unknown → supported/unsupported/error).
 *   - lastMotionAt, lastLatencyMs.
 *
 * O serviço cria um driver por câmera e chama:
 *   • runCycle(device)  → ciclo de polling (idêntico ao loop anterior).
 *   • dispose()         → para o polling e limpa recursos.
 *
 * Usa resolveProfile() para checar se o fabricante suporta ISAPI —
 * substituindo o resolveProvider() do serviço anterior.
 */

import {
  connectOnvif,
  getDeviceInformation,
  type OnvifCam,
} from '../onvif/onvif-connection';
import { readSnmpOids } from '../snmp/snmp-read.util';
import { pingPacketLoss } from '../cameras/ping.util';
import { fetchIsapiUptime } from '../cameras/isapi.util';
import { resolveProfile } from '../profiles/profile-registry';
import type { CollectionDriver, CollectOutput, DriverTelemetryPoint } from './collection-driver.interface';

// ─── Config types (espelham OnvifPollingService) ──────────────────────────────

export interface OnvifPointConfig {
  tag: string;
  metric: string;
  unit?: string | null;
  oid?: string | null;
  scale?: number;
  unsupported?: boolean;
}

export interface SnmpHealthChannel {
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
}

export interface OnvifDeviceConfig {
  deviceId: string;
  ip: string;
  port: number;
  username: string;
  password: string;
  pollingIntervalMs: number;
  manufacturer?: string | null;
  monitoredDeviceType?: string | null;
  snmpHealth?: SnmpHealthChannel | null;
  points: OnvifPointConfig[];
}

// ─── Event topic → metric map ────────────────────────────────────────────────

const EVENT_TOPIC_METRIC: Array<{ pattern: RegExp; metric: string }> = [
  { pattern: /motion/i, metric: 'motion' },
  { pattern: /tamper/i, metric: 'tamper' },
  { pattern: /video.?loss|signal.?loss/i, metric: 'video_loss' },
];

// ─── Driver ──────────────────────────────────────────────────────────────────

export class OnvifDriver implements CollectionDriver {
  readonly protocol = 'onvif';

  private cam: OnvifCam | null = null;
  private readonly eventValues = new Map<string, number>();
  private lastMotionAt: number | null = null;
  private lastLatencyMs: number | null = null;
  private eventsSupport: 'unknown' | 'supported' | 'unsupported' | 'error' = 'unknown';
  private _disposed = false;

  /**
   * Callback chamado quando um evento de câmera muda de valor (publicação
   * imediata fora do ciclo de polling). Injetado pelo serviço.
   */
  private onImmediatePublish?: (points: DriverTelemetryPoint[]) => void;

  constructor(
    private readonly device: OnvifDeviceConfig,
    onImmediatePublish?: (points: DriverTelemetryPoint[]) => void,
  ) {
    this.onImmediatePublish = onImmediatePublish;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  /** Expõe o deviceId para uso externo (log no serviço). */
  get deviceId(): string {
    return this.device.deviceId;
  }

  dispose(): void {
    this._disposed = true;
    this.detachCam();
  }

  // ─── CollectionDriver.collect() stub ─────────────────────────────────────
  // Fase 1: o serviço chama runCycle(device) diretamente.
  collect(): Promise<CollectOutput> {
    return this.runCycle(this.device);
  }

  // ─── Ciclo de coleta ─────────────────────────────────────────────────────

  async runCycle(device: OnvifDeviceConfig): Promise<CollectOutput> {
    if (this._disposed) {
      return {
        reachable: false,
        points: device.points.map((p) => ({ tag: p.tag, value: null, unit: p.unit ?? null })),
      };
    }

    let reachable = false;
    let streamOk: number | null = null;

    // Camada 3 (ping) em paralelo.
    const pingPromise: Promise<number | null> = device.points.some((p) => p.metric === 'ping_loss')
      ? pingPacketLoss(device.ip).catch(() => null)
      : Promise.resolve(null);

    // Camada 2 HTTP: uptime REAL via ISAPI — usa o sistema de perfis.
    // resolveProvider foi substituído por resolveProfile.
    const profile = resolveProfile({
      deviceType: (device.monitoredDeviceType as 'CAMERA') ?? 'CAMERA',
      manufacturer: device.manufacturer ?? null,
    });
    const uptimeMapping = profile.mappings.get('uptime');
    const wantsIsapi =
      device.points.some((p) => p.metric === 'uptime') &&
      uptimeMapping?.httpKind === 'isapi';
    const isapiPromise: Promise<number | null> = wantsIsapi
      ? fetchIsapiUptime({
          ip: device.ip,
          username: device.username,
          password: device.password,
        }).catch(() => null)
      : Promise.resolve(null);

    // Canal SNMP de saúde (híbrido).
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

    // Conexão / "ping" ONVIF.
    try {
      if (!this.cam) {
        this.cam = await connectOnvif({
          ip: device.ip,
          port: device.port,
          username: device.username,
          password: device.password,
        });
        if (this._disposed) {
          this.detachCam();
          return { reachable: false, points: device.points.map((p) => ({ tag: p.tag, value: null, unit: p.unit ?? null })) };
        }
        this.attachEventListener(device);
      }

      const pingStart = Date.now();
      await getDeviceInformation(this.cam);
      this.lastLatencyMs = Date.now() - pingStart;
      reachable = true;

      if (device.points.some((p) => p.metric === 'stream')) {
        streamOk = await this.checkStream(this.cam);
      }
    } catch {
      this.detachCam();
      reachable = false;
    }

    // Saúde SNMP.
    const healthValues = new Map<string, number | null>();
    if (healthPoints.length > 0) {
      const raw = await healthPromise;
      healthPoints.forEach((p, i) => {
        const v = raw ? (raw[i] ?? null) : null;
        healthValues.set(p.tag, v === null ? null : v * (p.scale ?? 1));
      });
    }

    const [pingLoss, isapiUptime] = await Promise.all([pingPromise, isapiPromise]);

    const points: DriverTelemetryPoint[] = device.points.map((p) => {
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
        return { tag: p.tag, value: reachable ? this.lastLatencyMs : null, unit: p.unit ?? null };
      }
      if (p.metric === 'ping_loss') {
        return {
          tag: p.tag,
          value: pingLoss,
          unit: p.unit ?? null,
          ...(pingLoss !== null ? { state: 'estimated' as const, source: 'ping' } : {}),
        };
      }
      if (p.metric === 'uptime') {
        if (isapiUptime !== null) {
          return { tag: p.tag, value: isapiUptime, unit: p.unit ?? null, source: 'http' };
        }
        return { tag: p.tag, value: null, unit: p.unit ?? null, state: 'estimated' as const };
      }
      if (p.metric === 'last_motion') {
        const value =
          reachable && this.lastMotionAt !== null
            ? Math.max(0, Math.round((Date.now() - this.lastMotionAt) / 1000))
            : null;
        return { tag: p.tag, value, unit: p.unit ?? null };
      }
      if (this.isEventMetric(p.metric)) {
        const last = this.eventValues.get(p.metric);
        if (!reachable) {
          return { tag: p.tag, value: null, unit: p.unit ?? null, state: 'error' as const };
        }
        if (last !== undefined) {
          return { tag: p.tag, value: last, unit: p.unit ?? null };
        }
        if (this.eventsSupport === 'unsupported') {
          return { tag: p.tag, value: null, unit: p.unit ?? null, state: 'unsupported' as const };
        }
        if (this.eventsSupport === 'error') {
          return { tag: p.tag, value: null, unit: p.unit ?? null, state: 'error' as const };
        }
        return { tag: p.tag, value: 0, unit: p.unit ?? null, state: 'waiting_event' as const };
      }
      return { tag: p.tag, value: null, unit: p.unit ?? null };
    });

    return { reachable, points };
  }

  // ─── Helpers internos ─────────────────────────────────────────────────────

  private isEventMetric(metric: string): boolean {
    return metric === 'motion' || metric === 'tamper' || metric === 'video_loss';
  }

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

  private detachCam(): void {
    if (this.cam) {
      try {
        this.cam.removeAllListeners('event');
      } catch {
        // best-effort
      }
      this.cam = null;
    }
  }

  private attachEventListener(device: OnvifDeviceConfig): void {
    const cam = this.cam;
    if (!cam) return;

    const eventMetrics = device.points.filter((p) => this.isEventMetric(p.metric));
    if (eventMetrics.length === 0) return;

    if (cam.capabilities && !cam.capabilities.events) {
      this.eventsSupport = 'unsupported';
      return;
    }

    try {
      cam.on('event', (message: unknown) => {
        try {
          this.handleCameraEvent(device, message);
        } catch {
          // best-effort
        }
      });
      this.eventsSupport = 'supported';
    } catch {
      this.eventsSupport = 'error';
    }
  }

  private handleCameraEvent(device: OnvifDeviceConfig, message: unknown): void {
    const topicStr = this.extractEventTopic(message);
    if (!topicStr) return;

    const match = EVENT_TOPIC_METRIC.find((m) => m.pattern.test(topicStr));
    if (!match) return;

    const point = device.points.find((p) => p.metric === match.metric);
    if (!point) return;

    const value = this.extractEventValue(message);
    if (value === null) return;

    const previous = this.eventValues.get(match.metric);
    this.eventValues.set(match.metric, value);
    this.eventsSupport = 'supported';

    if (match.metric === 'motion' && value === 1) {
      this.lastMotionAt = Date.now();
    }
    if (previous === value) return;

    // Publicação imediata (mudança de estado do evento).
    this.onImmediatePublish?.([
      { tag: point.tag, value, unit: point.unit ?? null },
    ]);
  }

  private extractEventTopic(message: unknown): string | null {
    const msg = message as { topic?: { _?: string } | string };
    if (!msg?.topic) return null;
    if (typeof msg.topic === 'string') return msg.topic;
    return typeof msg.topic._ === 'string' ? msg.topic._ : null;
  }

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
}
