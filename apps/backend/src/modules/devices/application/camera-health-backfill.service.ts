import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ONVIF_PROTOCOL, SNMP_PROTOCOL } from '../../prisma/device-filters.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DeviceConfigPublisherService } from './device-config-publisher.service.js';
import {
  CAMERA_OID_PROFILES,
  GENERIC_PROFILE,
  HEALTH_METRIC_META,
  type HealthMetric,
} from './camera-oid-profiles.js';

/** Métricas novas a garantir nas câmeras SNMP já cadastradas. */
const BACKFILL_METRICS: HealthMetric[] = ['cpu', 'temperature'];

/** Perfil Hikvision (OIDs corrigidos de RAM/armazenamento). */
const HIKVISION_PROFILE = CAMERA_OID_PROFILES.find((p) => p.id === 'hikvision');

/** OID antigo de "memória" da Hikvision — na verdade é uso de armazenamento. */
const HIKVISION_LEGACY_MEMORY_OID = '1.3.6.1.4.1.39165.1.9.0';

/** Pontos ONVIF novos a garantir nas câmeras ONVIF já cadastradas. */
const ONVIF_BACKFILL_POINTS = [
  { tag: 'LATENCIA', objectName: 'Latência de resposta', metric: 'latency', unit: 'ms' },
  {
    tag: 'ULTIMO_MOVIMENTO',
    objectName: 'Tempo desde o último movimento',
    metric: 'last_motion',
    unit: 's',
  },
];

/**
 * CameraHealthBackfillService
 *
 * Backfill único no bootstrap: câmeras CFTV monitoradas só via SNMP
 * cadastradas antes das métricas de CPU/temperatura ganham os novos pontos
 * (OIDs do perfil genérico — editáveis depois no cadastro) e a config do
 * gateway é republicada. Câmeras que não expõem os OIDs apenas publicam
 * null nesses pontos ("sem dados" na UI) — sem alarmes falsos.
 */
@Injectable()
export class CameraHealthBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CameraHealthBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configPublisher: DeviceConfigPublisherService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Primeiro: classifica câmeras que ficaram sem monitoredDeviceType.
    // Deve rodar ANTES dos demais backfills que filtram por monitoredDeviceType.
    try {
      await this.backfillCameraType();
    } catch (err) {
      this.logger.error(`Backfill de tipo de câmera falhou: ${(err as Error).message}`);
    }
    try {
      await this.backfill();
    } catch (err) {
      // Backfill é best-effort: nunca derruba o boot do backend.
      this.logger.error(`Backfill de métricas de câmera falhou: ${(err as Error).message}`);
    }
    try {
      await this.backfillOnvif();
    } catch (err) {
      this.logger.error(`Backfill de pontos ONVIF falhou: ${(err as Error).message}`);
    }
    try {
      await this.backfillHikvision();
    } catch (err) {
      this.logger.error(`Backfill Hikvision falhou: ${(err as Error).message}`);
    }
    try {
      await this.backfillPingLoss();
    } catch (err) {
      this.logger.error(`Backfill de PERDA_PING falhou: ${(err as Error).message}`);
    }
  }

  /**
   * Dispositivos com protocolo onvif ou snmp gravados sem classificação
   * (monitoredDeviceType = null) são marcados como CAMERA idempotentemente.
   * Nunca toca em dispositivos já classificados (NVR, SWITCH, ACCESS_CONTROLLER).
   */
  private async backfillCameraType(): Promise<void> {
    const result = await this.prisma.device.updateMany({
      where: {
        protocol: { in: [ONVIF_PROTOCOL, SNMP_PROTOCOL] },
        monitoredDeviceType: null,
      },
      data: { monitoredDeviceType: 'CAMERA' },
    });

    if (result.count > 0) {
      this.logger.log(
        `Backfill monitoredDeviceType: ${result.count} dispositivo(s) onvif/snmp sem classificação marcado(s) como CAMERA.`,
      );
    }
  }

  /**
   * Todas as câmeras CFTV (SNMP e ONVIF) ganham o ponto PERDA_PING —
   * perda de pacotes medida por ping ICMP no gateway (camada 3, funciona
   * em qualquer fabricante, sem OID).
   */
  private async backfillPingLoss(): Promise<void> {
    const cameras = await this.prisma.device.findMany({
      where: { monitoredDeviceType: { not: null } },
      include: { points: true },
    });

    const touchedGateways = new Set<string>();

    for (const camera of cameras) {
      if (camera.points.some((p) => p.tag === 'PERDA_PING')) continue;

      const nextInstance =
        camera.points.reduce((m, p) => Math.max(m, p.instance), -1) + 1;
      await this.prisma.devicePoint.create({
        data: {
          deviceId: camera.id,
          tag: 'PERDA_PING',
          objectName: 'Perda de pacotes (ping)',
          objectType: camera.protocol === ONVIF_PROTOCOL ? 'onvif' : 'snmp',
          instance: nextInstance,
          unit: '%',
          binding: { metric: 'ping_loss' },
        },
      });

      this.logger.log(`Câmera ${camera.id}: ponto PERDA_PING adicionado`);
      if (camera.gatewayId) {
        touchedGateways.add(`${camera.tenantId}::${camera.gatewayId}`);
      }
    }

    for (const key of touchedGateways) {
      const [tenantId, gatewayId] = key.split('::');
      await this.configPublisher.publishForGateway(tenantId, gatewayId);
    }
  }

  /**
   * Câmeras (SNMP puro ou ONVIF híbrido) cujo ponto de "Memória" aponta para
   * o OID antigo da Hikvision (`.1.9.0` — que na verdade é uso de
   * armazenamento SD) são remapeadas: MEMORIA passa a usar o uso REAL de RAM
   * (`.1.11.0`) e ganham os pontos novos RAM_TOTAL (`.1.10.0`, MB) e
   * ARMAZENAMENTO (`.1.9.0`, %). IDs dos pontos existentes são preservados
   * (trends/alarmes sobrevivem) e a config do gateway é republicada.
   */
  private async backfillHikvision(): Promise<void> {
    const profile = HIKVISION_PROFILE;
    if (!profile) return;

    const cameras = await this.prisma.device.findMany({
      where: { protocol: { in: [SNMP_PROTOCOL, ONVIF_PROTOCOL] } },
      include: { points: true },
    });

    const touchedGateways = new Set<string>();

    for (const camera of cameras) {
      const memoryPoint = camera.points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string; oid?: string };
        return b.metric === 'memory' && b.oid === HIKVISION_LEGACY_MEMORY_OID;
      });
      if (!memoryPoint) continue;

      // 1) MEMORIA → uso real de RAM (.1.11.0)
      const memEntry = profile.oids.memory;
      if (memEntry) {
        const b = (memoryPoint.binding ?? {}) as Record<string, unknown>;
        await this.prisma.devicePoint.update({
          where: { id: memoryPoint.id },
          data: {
            binding: {
              ...b,
              metric: 'memory',
              oid: memEntry.oid,
              scale: memEntry.scale,
              // OID novo ainda não testado — limpa marca de "não suportado".
              unsupported: false,
            },
            unit: memEntry.unit,
          },
        });
      }

      // 2) Pontos novos: RAM_TOTAL e ARMAZENAMENTO (se ainda não existem)
      let nextInstance =
        camera.points.reduce((m, p) => Math.max(m, p.instance), -1) + 1;
      const newMetrics: HealthMetric[] = ['ram_total', 'storage'];
      for (const metric of newMetrics) {
        const meta = HEALTH_METRIC_META[metric];
        const entry = profile.oids[metric];
        if (!entry) continue;
        if (camera.points.some((p) => p.tag === meta.tag)) continue;
        await this.prisma.devicePoint.create({
          data: {
            deviceId: camera.id,
            tag: meta.tag,
            objectName: meta.objectName,
            objectType: 'snmp',
            instance: nextInstance++,
            unit: entry.unit,
            binding: { metric, oid: entry.oid, scale: entry.scale },
          },
        });
      }

      this.logger.log(
        `Câmera Hikvision ${camera.id}: memória remapeada para uso real de RAM ` +
          `e pontos RAM_TOTAL/ARMAZENAMENTO garantidos`,
      );
      if (camera.gatewayId) {
        touchedGateways.add(`${camera.tenantId}::${camera.gatewayId}`);
      }
    }

    for (const key of touchedGateways) {
      const [tenantId, gatewayId] = key.split('::');
      await this.configPublisher.publishForGateway(tenantId, gatewayId);
    }
  }

  /**
   * Câmeras ONVIF cadastradas antes dos pontos LATENCIA/ULTIMO_MOVIMENTO
   * ganham os novos pontos e a config do gateway é republicada — os pontos
   * aparecem na UI e no modal de criação de alarme como qualquer outro.
   */
  private async backfillOnvif(): Promise<void> {
    const cameras = await this.prisma.device.findMany({
      where: { protocol: ONVIF_PROTOCOL },
      include: { points: true },
    });

    const touchedGateways = new Set<string>();

    for (const camera of cameras) {
      const missing = ONVIF_BACKFILL_POINTS.filter(
        (candidate) => !camera.points.some((p) => p.tag === candidate.tag),
      );
      if (missing.length === 0) continue;

      let nextInstance =
        camera.points.reduce((m, p) => Math.max(m, p.instance), -1) + 1;

      for (const point of missing) {
        await this.prisma.devicePoint.create({
          data: {
            deviceId: camera.id,
            tag: point.tag,
            objectName: point.objectName,
            objectType: 'onvif',
            instance: nextInstance++,
            unit: point.unit,
            binding: { metric: point.metric },
          },
        });
      }

      this.logger.log(
        `Câmera ONVIF ${camera.id}: pontos adicionados (${missing.map((p) => p.tag).join(', ')})`,
      );
      if (camera.gatewayId) {
        touchedGateways.add(`${camera.tenantId}::${camera.gatewayId}`);
      }
    }

    for (const key of touchedGateways) {
      const [tenantId, gatewayId] = key.split('::');
      await this.configPublisher.publishForGateway(tenantId, gatewayId);
    }
  }

  private async backfill(): Promise<void> {
    const cameras = await this.prisma.device.findMany({
      where: { protocol: SNMP_PROTOCOL },
      include: { points: true },
    });

    const touchedGateways = new Set<string>();

    for (const camera of cameras) {
      const missing = BACKFILL_METRICS.filter(
        (metric) => !camera.points.some((p) => p.tag === HEALTH_METRIC_META[metric].tag),
      );
      if (missing.length === 0) continue;

      let nextInstance =
        camera.points.reduce((m, p) => Math.max(m, p.instance), -1) + 1;

      for (const metric of missing) {
        const meta = HEALTH_METRIC_META[metric];
        const entry = GENERIC_PROFILE.oids[metric];
        if (!entry) continue;
        await this.prisma.devicePoint.create({
          data: {
            deviceId: camera.id,
            tag: meta.tag,
            objectName: meta.objectName,
            objectType: 'snmp',
            instance: nextInstance++,
            unit: entry.unit,
            binding: { metric, oid: entry.oid, scale: entry.scale },
          },
        });
      }

      this.logger.log(
        `Câmera ${camera.id}: pontos de saúde adicionados (${missing.join(', ')})`,
      );
      if (camera.gatewayId) {
        touchedGateways.add(`${camera.tenantId}::${camera.gatewayId}`);
      }
    }

    for (const key of touchedGateways) {
      const [tenantId, gatewayId] = key.split('::');
      await this.configPublisher.publishForGateway(tenantId, gatewayId);
    }
  }
}
