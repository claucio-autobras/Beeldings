import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DeviceConfigPublisherService } from './device-config-publisher.service.js';

/**
 * OfficialMibOidMigrationService
 *
 * Migração única no bootstrap (idempotente e best-effort) da tarefa
 * "Perfis SNMP oficiais Hikvision e Dahua/Intelbras": pontos criados com OIDs
 * de dumps comunitários são corrigidos para os OIDs das FONTES OFICIAIS,
 * preservando os IDs dos pontos (trends e alarmes sobrevivem).
 *
 * Correções (fonte: doc oficial Dahua "Product Management Information Library"
 * root 1.3.6.1.4.1.1004849.2 e HIKVISION-MIB oficial, hikEntity 50001.1):
 *
 * 1. Escalares Dahua/Intelbras (câmeras e NVRs):
 *      cpu    …1004849.2.1.3.1.1.1 → …1004849.2.1.3.0    (cpuUsage escalar)
 *      memory …1004849.2.1.3.2.1.1 → …1004849.2.1.9.2.0  (memoryUsage)
 *      temp   …1004849.2.1.3.3.1.1 → UCD …2021.13.16.2.1.3.1 (÷1000)
 *      (a doc oficial NÃO define objeto de temperatura — fallback genérico)
 *
 * 2. Bindings de tabela Dahua/Intelbras NVR (árvore antiga …1004849.1.* era
 *    do ipSAN, não de NVR/DVR):
 *      disk_status    …1.1.1.2 → …2.4.1.1.5 (DisplayString; sem scale)
 *      disk_capacity  …1.1.1.3 → …2.4.1.1.7 (GB nativo; REMOVE scale 0.001)
 *      disk_used      …1.1.1.4 → …2.4.1.1.6 (USO em % — unit '%', sem scale)
 *      channel_status …1.2.1.2 → …2.10.1.1.1.1.2
 *
 * 3. Bindings de tabela Hikvision NVR (hikHddTable 39165.1.4.1 não-oficial →
 *    hikDiskTable oficial 50001.1.241.1; valores em MB → scale 0.001):
 *      disk_status    …39165.1.4.1.1 → …50001.1.241.1.3
 *      disk_capacity  …39165.1.4.1.2 → …50001.1.241.1.5 (scale 0.001)
 *      (disk_used Hikvision é derivado no driver — prefixo null, sem mudança)
 *
 * Depois republica a config nos gateways afetados. Execuções seguintes são
 * no-op (nenhum ponto com OID/prefixo antigo). Roda em toda instância do
 * cluster sem risco: updates são idempotentes.
 */

/** metric → { oid novo, scale, unit } para escalares Dahua/Intelbras antigos. */
const DAHUA_SCALAR_MIGRATIONS: Record<
  string,
  { newOid: string; scale: number; unit: string }
> = {
  '1.3.6.1.4.1.1004849.2.1.3.1.1.1': {
    newOid: '1.3.6.1.4.1.1004849.2.1.3.0',
    scale: 1,
    unit: '%',
  },
  '1.3.6.1.4.1.1004849.2.1.3.2.1.1': {
    newOid: '1.3.6.1.4.1.1004849.2.1.9.2.0',
    scale: 1,
    unit: '%',
  },
  // Temperatura: sem objeto oficial Dahua → fallback UCD (mili-°C ÷1000).
  '1.3.6.1.4.1.1004849.2.1.3.3.1.1': {
    newOid: '1.3.6.1.4.1.2021.13.16.2.1.3.1',
    scale: 0.001,
    unit: '°C',
  },
};

/** Prefixos de tabela antigos → novos (Dahua/Intelbras + Hikvision NVR). */
const TABLE_PREFIX_MIGRATIONS: Record<
  string,
  { newPrefix: string; scale?: number; removeScale?: boolean; unit?: string; objectNameSuffix?: string }
> = {
  // Dahua/Intelbras — árvore ipSAN antiga → physicalVolumeInfoTable oficial.
  '1.3.6.1.4.1.1004849.1.1.1.2': {
    newPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.5',
    removeScale: true,
  },
  '1.3.6.1.4.1.1004849.1.1.1.3': {
    newPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.7',
    // physicalVolumeTotal é GB NATIVO — remove o scale MB→GB antigo.
    removeScale: true,
  },
  '1.3.6.1.4.1.1004849.1.1.1.4': {
    newPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.6',
    // physicalVolumeUsage é USO EM % — sem scale, unidade '%'.
    removeScale: true,
    unit: '%',
    objectNameSuffix: 'Uso (%)',
  },
  '1.3.6.1.4.1.1004849.1.2.1.2': {
    newPrefix: '1.3.6.1.4.1.1004849.2.10.1.1.1.1.2',
  },
  // Hikvision NVR — hikHddTable não-oficial → hikDiskTable oficial (MB → GB).
  '1.3.6.1.4.1.39165.1.4.1.1': {
    newPrefix: '1.3.6.1.4.1.50001.1.241.1.3',
  },
  '1.3.6.1.4.1.39165.1.4.1.2': {
    newPrefix: '1.3.6.1.4.1.50001.1.241.1.5',
    scale: 0.001,
  },
};

@Injectable()
export class OfficialMibOidMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OfficialMibOidMigrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configPublisher: DeviceConfigPublisherService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.migrate();
    } catch (err) {
      // Best-effort: nunca derruba o boot do backend.
      this.logger.error(
        `Migração de OIDs oficiais Hikvision/Dahua falhou: ${(err as Error).message}`,
      );
    }
  }

  async migrate(): Promise<void> {
    // Busca só devices SNMP com pontos que ainda apontam para OIDs antigos.
    const devices = await this.prisma.device.findMany({
      where: { protocol: 'snmp' },
      include: { points: true },
    });

    for (const device of devices) {
      let changed = 0;

      for (const point of device.points) {
        const b = (point.binding ?? {}) as Record<string, unknown>;

        // ── Escalares Dahua/Intelbras antigos ────────────────────────────────
        const oid = typeof b.oid === 'string' ? b.oid : null;
        if (oid && DAHUA_SCALAR_MIGRATIONS[oid]) {
          const m = DAHUA_SCALAR_MIGRATIONS[oid];
          await this.prisma.devicePoint.update({
            where: { id: point.id },
            data: {
              unit: m.unit,
              binding: { ...b, oid: m.newOid, scale: m.scale, unsupported: false },
            },
          });
          changed++;
          continue;
        }

        // ── Prefixos de tabela antigos (NVR) ─────────────────────────────────
        const prefix = typeof b.tableOidPrefix === 'string' ? b.tableOidPrefix : null;
        if (prefix && TABLE_PREFIX_MIGRATIONS[prefix]) {
          const m = TABLE_PREFIX_MIGRATIONS[prefix];
          const newBinding: Record<string, unknown> = {
            ...b,
            tableOidPrefix: m.newPrefix,
          };
          if (m.removeScale) delete newBinding.scale;
          if (m.scale !== undefined) newBinding.scale = m.scale;

          await this.prisma.devicePoint.update({
            where: { id: point.id },
            data: {
              binding: newBinding as never,
              ...(m.unit !== undefined ? { unit: m.unit } : {}),
              ...(m.objectNameSuffix && point.instance !== null
                ? { objectName: `Disco ${point.instance} — ${m.objectNameSuffix}` }
                : {}),
            },
          });
          changed++;
        }
      }

      if (changed > 0) {
        await this.configPublisher.publishForDevice(device.id);
        this.logger.log(
          `Device ${device.id}: ${changed} ponto(s) migrados para OIDs oficiais ` +
            `Hikvision/Dahua (IDs preservados) — config republicada`,
        );
      }
    }
  }
}
