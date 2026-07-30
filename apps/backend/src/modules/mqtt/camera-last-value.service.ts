import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BacnetTelemetryPayload } from './telemetry.gateway.js';
import { AvailabilityRecorderService } from './availability-recorder.service.js';

/** Protocolos de câmera CFTV — únicos com persistência de último valor. */
const CFTV_PROTOCOLS = new Set(['snmp', 'onvif']);

/** TTL do cache deviceId → é câmera CFTV? (evita query por ciclo de telemetria). */
const PROTOCOL_CACHE_TTL_MS = 5 * 60_000;

/**
 * CameraLastValueService
 *
 * Persiste o último valor lido de cada ponto de câmera CFTV (snmp/onvif) em
 * DevicePoint.lastValue/lastValueAt. Assim o GET /cftv/cameras devolve o
 * status conhecido imediatamente (sem esperar o próximo ciclo de polling),
 * e o frontend usa esses valores como "seed" até a telemetria ao vivo chegar.
 *
 * Escopo intencional: SÓ câmeras CFTV — equipamentos BMS continuam usando o
 * cache em memória / trends opt-in (nada muda para eles).
 * Gravação fire-and-forget: falha de banco nunca afeta o fluxo de telemetria.
 */
@Injectable()
export class CameraLastValueService {
  private readonly logger = new Logger(CameraLastValueService.name);

  /** deviceId → { isCamera, expiresAt } */
  private readonly protocolCache = new Map<string, { isCamera: boolean; expiresAt: number }>();

  /**
   * deviceId → último STATUS visto (0/1) — detecta transições offline→online
   * para persistir `availability.onlineSince` em Device.config (base do
   * "tempo online estimado" quando a câmera não expõe uptime real).
   */
  private readonly lastStatus = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityRecorderService,
  ) {}

  /** Consome um payload de telemetria (chamado pelo BacnetMqttSubscriber). */
  consume(data: BacnetTelemetryPayload): void {
    if (!data.deviceId || !Array.isArray(data.points) || data.points.length === 0) {
      return;
    }
    void this.persist(data).catch((err: Error) => {
      this.logger.warn(
        `Falha ao persistir últimos valores da câmera ${data.deviceId}: ${err.message}`,
      );
    });
  }

  private async persist(data: BacnetTelemetryPayload): Promise<void> {
    const deviceId = data.deviceId as string;
    if (!(await this.isCamera(deviceId))) {
      return;
    }

    const at = data.timestamp ? new Date(data.timestamp) : new Date();
    const validAt = Number.isNaN(at.getTime()) ? new Date() : at;

    for (const p of data.points) {
      if (!p?.tag) continue;
      const value =
        p.value === null || p.value === undefined || !Number.isFinite(Number(p.value))
          ? null
          : Number(p.value);
      await this.prisma.devicePoint.updateMany({
        where: { deviceId, tag: p.tag },
        data: {
          lastValue: value,
          lastValueAt: validAt,
          // Estado da leitura (waiting_event/unsupported/error/estimated);
          // null = leitura real — sobrescreve estado antigo quando o dado chega.
          lastValueState: p.state ?? null,
        },
      });

      // Disponibilidade estimada: transição offline→online do ponto STATUS
      // reinicia o marco `availability.onlineSince` em Device.config.
      if (p.tag === 'STATUS' && value !== null) {
        await this.trackAvailability(deviceId, value, validAt);
        // Histórico durável de transições (relatório de disponibilidade).
        this.availability.noteCameraStatus(deviceId, value, validAt);
      }
    }
  }

  /**
   * Persiste o marco de "online desde" no config do device. Só grava quando
   * há transição (ou primeiro online sem marco) — sem escrita por ciclo.
   */
  private async trackAvailability(deviceId: string, status: number, at: Date): Promise<void> {
    const prev = this.lastStatus.get(deviceId);
    this.lastStatus.set(deviceId, status);

    if (status === 1) {
      if (prev === 1) return; // já online — marco preservado
      const device = await this.prisma.device.findUnique({
        where: { id: deviceId },
        select: { config: true },
      });
      if (!device) return;
      const cfg = (device.config ?? {}) as Record<string, unknown>;
      const availability = (cfg.availability ?? {}) as { onlineSince?: string };
      // Reinício do backend (prev undefined): mantém o marco existente —
      // a câmera pode ter ficado online o tempo todo.
      if (prev === undefined && availability.onlineSince) return;
      await this.prisma.device.update({
        where: { id: deviceId },
        data: {
          config: { ...cfg, availability: { onlineSince: at.toISOString() } } as never,
        },
      });
    } else if (prev === 1 || prev === undefined) {
      // Ficou offline: limpa o marco (o próximo online reinicia a contagem).
      const device = await this.prisma.device.findUnique({
        where: { id: deviceId },
        select: { config: true },
      });
      if (!device) return;
      const cfg = (device.config ?? {}) as Record<string, unknown>;
      const availability = (cfg.availability ?? {}) as { onlineSince?: string };
      if (!availability.onlineSince) return;
      await this.prisma.device.update({
        where: { id: deviceId },
        data: { config: { ...cfg, availability: {} } as never },
      });
    }
  }

  private async isCamera(deviceId: string): Promise<boolean> {
    const cached = this.protocolCache.get(deviceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.isCamera;
    }
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { protocol: true },
    });
    const isCamera = Boolean(device && CFTV_PROTOCOLS.has(device.protocol));
    this.protocolCache.set(deviceId, {
      isCamera,
      expiresAt: Date.now() + PROTOCOL_CACHE_TTL_MS,
    });
    return isCamera;
  }
}
