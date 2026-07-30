import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { DeviceStatusService, type DeviceLiveStatus } from './device-status.service.js';
import { VIRTUAL_PROTOCOL } from '../prisma/device-filters.js';

/** Protocolos de câmera CFTV — disponibilidade vem do ponto STATUS, não de recência. */
const CFTV_PROTOCOLS = new Set(['snmp', 'onvif']);

/** Intervalo do sweeper (varredura periódica de status). */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * Carência após o boot antes de gravar transições derivadas de memória: dá
 * tempo do retido do broker (status de gateway) e da telemetria repovoarem os
 * mapas em memória — sem isso, todo restart geraria falsas quedas.
 */
const BOOT_GRACE_MS = 90_000;

/**
 * Câmera sem NENHUMA telemetria há mais que isso = offline (gateway caiu ou a
 * câmera sumiu da rede). Janela maior que a dos devices BMS porque câmeras
 * ONVIF podem publicar com menos frequência.
 */
const CAMERA_SILENCE_MS = 5 * 60_000;

/** Retenção do histórico de transições (12 meses). */
const RETENTION_DAYS = 365;
const RETENTION_SWEEP_MS = 24 * 60 * 60 * 1000;

export type StatusEntityType = 'gateway' | 'device' | 'camera';

/**
 * AvailabilityRecorderService
 *
 * Grava de forma durável (tabela `status_events`) as TRANSIÇÕES de status
 * online/offline de gateways, dispositivos e câmeras — base do Relatório de
 * Disponibilidade. Três fontes alimentam o registro:
 *
 *  1. Gateways — sinal explícito LWT/heartbeat (via GatewayStatusService), com
 *     timestamp exato da transição. O retido do broker re-semeia a memória no
 *     restart; a deduplicação contra o último evento gravado evita falsas
 *     transições nessa reentrega.
 *  2. Câmeras — valor do ponto STATUS (via CameraLastValueService): 1 = online,
 *     0 = offline. Recência sozinha não basta (câmera pode "responder" com
 *     vídeo caído).
 *  3. Dispositivos BMS — recência de telemetria (DeviceStatusService), varrida
 *     pelo sweeper periódico (transições passivas por staleness não geram
 *     evento — precisam ser observadas).
 *
 * Regras:
 *  - Só grava MUDANÇA de estado (dedup em memória, seed do último evento no banco).
 *  - Primeiro registro de uma entidade marca o INÍCIO da cobertura de dados.
 *  - Sweeper roda apenas na instância líder e respeita carência pós-boot.
 *  - Dispositivos virtuais (Bancada) nunca entram.
 */
@Injectable()
export class AvailabilityRecorderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvailabilityRecorderService.name);

  private timer?: NodeJS.Timeout;
  private sweeping = false;
  private readonly bootAt = Date.now();
  private lastRetentionAt = 0;

  /** entityId → último status GRAVADO (cache de dedup; seed lazy do banco). */
  private readonly lastRecorded = new Map<string, DeviceLiveStatus>();
  /** Serialização por entidade (evita corrida entre evento e sweeper). */
  private readonly chains = new Map<string, Promise<void>>();
  /** entityId → tenantId (cache de resolução; null = entidade desconhecida). */
  private readonly tenantCache = new Map<string, string | null>();
  /** deviceId (câmera) → último valor do ponto STATUS visto nesta sessão. */
  private readonly cameraStatusValue = new Map<string, number>();
  /** Câmeras cujo valor de STATUS já foi semeado do banco (lastValue). */
  private cameraSeedDone = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cluster: ClusterService,
    private readonly deviceStatus: DeviceStatusService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── Fontes de evento (chamadas pelos serviços de ingestão) ─────────────────

  /** Transição explícita de gateway (LWT/heartbeat) — timestamp exato. */
  noteGatewayStatus(gatewayId: string, status: DeviceLiveStatus): void {
    if (!this.cluster.isLeader()) return; // toda instância recebe o MQTT; só a líder grava
    this.enqueue(gatewayId, async () => {
      const tenantId = await this.resolveGatewayTenant(gatewayId);
      if (!tenantId) return;
      await this.record('gateway', gatewayId, tenantId, status, new Date());
    });
  }

  /** Valor do ponto STATUS de uma câmera CFTV (1 = online, 0 = offline). */
  noteCameraStatus(deviceId: string, value: number, at: Date): void {
    this.cameraStatusValue.set(deviceId, value);
    if (!this.cluster.isLeader()) return;
    this.enqueue(deviceId, async () => {
      const tenantId = await this.resolveDeviceTenant(deviceId);
      if (!tenantId) return;
      await this.record('camera', deviceId, tenantId, value === 1 ? 'online' : 'offline', at);
    });
  }

  // ─── Sweeper (líder) ─────────────────────────────────────────────────────────

  private async sweep(): Promise<void> {
    if (!this.cluster.isLeader() || this.sweeping) return;
    if (Date.now() - this.bootAt < BOOT_GRACE_MS) return;
    this.sweeping = true;
    try {
      await this.seedCameraValues();

      const [gateways, devices] = await Promise.all([
        this.prisma.gateway.findMany({ select: { id: true, tenantId: true } }),
        this.prisma.device.findMany({
          where: { protocol: { not: VIRTUAL_PROTOCOL } },
          select: { id: true, tenantId: true, protocol: true },
        }),
      ]);

      const now = new Date();
      for (const g of gateways) {
        const status = this.deviceStatus.getStatus(g.id);
        this.enqueue(g.id, () => this.record('gateway', g.id, g.tenantId, status, now));
      }
      for (const d of devices) {
        if (CFTV_PROTOCOLS.has(d.protocol)) {
          const status = this.cameraLiveStatus(d.id);
          this.enqueue(d.id, () => this.record('camera', d.id, d.tenantId, status, now));
        } else {
          const status = this.deviceStatus.getStatus(d.id);
          this.enqueue(d.id, () => this.record('device', d.id, d.tenantId, status, now));
        }
      }

      await this.purgeOldEvents();
    } catch (err) {
      this.logger.error(`Falha na varredura de disponibilidade: ${(err as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Status vivo de uma câmera: precisa ter comunicado há pouco E o último
   * STATUS conhecido ser 1. Silêncio prolongado (gateway caiu) = offline.
   */
  private cameraLiveStatus(deviceId: string): DeviceLiveStatus {
    const lastSeenIso = this.deviceStatus.getLastSeen(deviceId);
    const silent =
      !lastSeenIso || Date.now() - new Date(lastSeenIso).getTime() > CAMERA_SILENCE_MS;
    if (silent) return 'offline';
    const value = this.cameraStatusValue.get(deviceId);
    return value === 1 ? 'online' : 'offline';
  }

  /** Seed único: repovoa o último STATUS das câmeras a partir do lastValue persistido. */
  private async seedCameraValues(): Promise<void> {
    if (this.cameraSeedDone) return;
    this.cameraSeedDone = true;
    const points = await this.prisma.devicePoint.findMany({
      where: {
        tag: 'STATUS',
        lastValue: { not: null },
        device: { protocol: { in: [...CFTV_PROTOCOLS] } },
      },
      select: { deviceId: true, lastValue: true },
    });
    for (const p of points) {
      if (!this.cameraStatusValue.has(p.deviceId) && p.lastValue !== null) {
        this.cameraStatusValue.set(p.deviceId, p.lastValue);
      }
    }
  }

  // ─── Gravação com deduplicação ───────────────────────────────────────────────

  private async record(
    entityType: StatusEntityType,
    entityId: string,
    tenantId: string,
    status: DeviceLiveStatus,
    at: Date,
  ): Promise<void> {
    let last: DeviceLiveStatus | undefined = this.lastRecorded.get(entityId);
    if (last === undefined) {
      const prev = await this.prisma.statusEvent.findFirst({
        where: { entityId },
        orderBy: { at: 'desc' },
        select: { status: true },
      });
      last = prev?.status as DeviceLiveStatus | undefined;
    }
    if (last === status) {
      this.lastRecorded.set(entityId, status);
      return;
    }
    await this.prisma.statusEvent.create({
      data: { entityType, entityId, tenantId, status, at },
    });
    this.lastRecorded.set(entityId, status);
    this.logger.debug(`Transição registrada: ${entityType} ${entityId} → ${status}`);
  }

  /** Encadeia trabalho por entidade (uma gravação por vez por entityId). */
  private enqueue(entityId: string, work: () => Promise<void>): void {
    const prev = this.chains.get(entityId) ?? Promise.resolve();
    const next = prev
      .then(work)
      .catch((err: Error) =>
        this.logger.warn(`Falha ao registrar transição de ${entityId}: ${err.message}`),
      );
    this.chains.set(entityId, next);
    void next.finally(() => {
      if (this.chains.get(entityId) === next) this.chains.delete(entityId);
    });
  }

  // ─── Resolução de tenant (cacheada) ─────────────────────────────────────────

  private async resolveGatewayTenant(gatewayId: string): Promise<string | null> {
    const cached = this.tenantCache.get(gatewayId);
    if (cached !== undefined) return cached;
    const gw = await this.prisma.gateway.findUnique({
      where: { id: gatewayId },
      select: { tenantId: true },
    });
    const tenantId = gw?.tenantId ?? null;
    // Gateway desconhecido pode ser cadastrado depois: não cacheia o null.
    if (tenantId) this.tenantCache.set(gatewayId, tenantId);
    return tenantId;
  }

  private async resolveDeviceTenant(deviceId: string): Promise<string | null> {
    const cached = this.tenantCache.get(deviceId);
    if (cached !== undefined) return cached;
    const dev = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { tenantId: true },
    });
    const tenantId = dev?.tenantId ?? null;
    if (tenantId) this.tenantCache.set(deviceId, tenantId);
    return tenantId;
  }

  // ─── Retenção ────────────────────────────────────────────────────────────────

  private async purgeOldEvents(): Promise<void> {
    if (Date.now() - this.lastRetentionAt < RETENTION_SWEEP_MS) return;
    this.lastRetentionAt = Date.now();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.statusEvent.deleteMany({ where: { at: { lt: cutoff } } });
    if (count > 0) this.logger.log(`Retenção de disponibilidade: ${count} evento(s) antigos removidos`);
  }
}
