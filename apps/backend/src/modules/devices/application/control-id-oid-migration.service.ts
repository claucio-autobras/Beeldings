import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ONLY_ACCESS_CONTROLLER_DEVICES } from '../../prisma/device-filters.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DeviceConfigPublisherService } from './device-config-publisher.service.js';

/** Fonte canônica: hrProcessorLoad.1; membros adicionais vêm do diagnóstico. */
const HR_PROCESSOR_LOAD_OID = '1.3.6.1.2.1.25.3.3.1.2.1';
const CONTROL_ID_CPU_OID = '1.3.6.1.4.1.49617.1.1.4.0';
const UCD_MEM_AVAILABLE_OID = '1.3.6.1.4.1.2021.4.6.0';
const UCD_MEM_BUFFER_OID = '1.3.6.1.4.1.2021.4.14.0';
const UCD_MEM_CACHED_OID = '1.3.6.1.4.1.2021.4.15.0';
const UCD_MEM_TOTAL_OID = '1.3.6.1.4.1.2021.4.5.0';
const HR_MEMORY_SIZE_OID = '1.3.6.1.2.1.25.2.2.0';
const LEGACY_MEMORY_METRICS = new Set(['memory', 'memory_used_percent', 'memory_used']);
const RECOVERABLE_MEMORY_MEMBERS = [
  UCD_MEM_AVAILABLE_OID,
  UCD_MEM_BUFFER_OID,
  UCD_MEM_CACHED_OID,
  UCD_MEM_TOTAL_OID,
];

/**
 * Corrige cadastros Control iD legados sem recriar pontos: CPU passa a usar
 * hrProcessorLoad e temperatura fica explicitamente não suportada no firmware
 * validado. A publicação retida atualiza o gateway após a reconciliação.
 */
@Injectable()
export class ControlIdOidMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ControlIdOidMigrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configPublisher: DeviceConfigPublisherService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.migrate();
    } catch (err) {
      this.logger.error(`Migração de OIDs Control iD falhou: ${(err as Error).message}`);
    }
  }

  async migrate(): Promise<void> {
    const devices = await this.prisma.device.findMany({
      where: { ...ONLY_ACCESS_CONTROLLER_DEVICES },
      include: { points: true, metricBindings: true },
    });

    for (const device of devices) {
      const config = (device.config ?? {}) as {
        manufacturer?: string | null;
        profileId?: string | null;
      };
      const isControlId = /control[\s-]*id|controlid|idflex/i.test(config.manufacturer ?? '') ||
        config.profileId === 'control-id';
      if (!isControlId) continue;
      let changed = false;
      const tempPoint = device.points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string; oid?: string | null };
        return b.metric === 'temperature' &&
          (isControlId || b.oid?.startsWith('1.3.6.1.4.1.49617.'));
      });

      if (tempPoint) {
        const tb = (tempPoint.binding ?? {}) as Record<string, unknown>;
        if (tb.oid !== null || tb.unsupported !== true || tb.healthState !== 'unsupported') {
          await this.prisma.devicePoint.update({
            where: { id: tempPoint.id },
            data: {
              unit: '°C',
              binding: {
                ...tb,
                oid: null,
                scale: 1,
                unsupported: true,
                healthState: 'unsupported',
                healthReason: 'not_exposed_by_firmware',
              },
            },
          });
          changed = true;
        }
      }

      const memoryPoint = device.points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string; oid?: string | null };
        return LEGACY_MEMORY_METRICS.has(b.metric ?? '') ||
          (b.metric === 'memory_available' && b.oid !== UCD_MEM_AVAILABLE_OID);
      });
      if (memoryPoint) {
        const mb = (memoryPoint.binding ?? {}) as Record<string, unknown>;
        await this.prisma.devicePoint.update({
          where: { id: memoryPoint.id },
          data: {
            unit: 'bytes',
            binding: {
              ...mb,
              metric: 'memory_available',
              oid: UCD_MEM_AVAILABLE_OID,
              scale: 1024,
              unsupported: false,
            },
            ...(memoryPoint.lastValue !== null && memoryPoint.lastValue !== undefined
              ? { lastValue: null, lastValueAt: null, lastValueState: 'waiting_event' }
              : {}),
          },
        });
        changed = true;
      }
      const legacyTotalPoint = device.points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string };
        return b.metric === 'memory_total';
      });
      if (legacyTotalPoint) {
        const tb = (legacyTotalPoint.binding ?? {}) as Record<string, unknown>;
        await this.prisma.devicePoint.update({
          where: { id: legacyTotalPoint.id },
          data: {
            unit: 'bytes',
            binding: { ...tb, metric: 'ram_total', oid: HR_MEMORY_SIZE_OID, scale: 1024, unsupported: false },
            ...(legacyTotalPoint.lastValue !== null && legacyTotalPoint.lastValue !== undefined
              ? { lastValue: null, lastValueAt: null, lastValueState: 'waiting_event' }
              : {}),
          },
        });
        changed = true;
      }

      const cpuPoint = device.points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string };
        return b.metric === 'cpu' || b.metric === 'cpu_usage';
      });
      const cpuBinding = cpuPoint
        ? (cpuPoint.binding ?? {}) as Record<string, unknown>
        : null;
      if (cpuPoint && (
        cpuBinding?.oid === CONTROL_ID_CPU_OID ||
        cpuBinding?.oid !== HR_PROCESSOR_LOAD_OID ||
        cpuBinding?.metric !== 'cpu_usage'
      )) {
        await this.prisma.devicePoint.update({
          where: { id: cpuPoint.id },
          data: {
            unit: '%',
            binding: {
              ...cpuBinding,
              metric: 'cpu_usage',
              oid: HR_PROCESSOR_LOAD_OID,
              scale: 1,
              unsupported: false,
            },
          },
        });
        changed = true;
      }

      const cpuBindingRow = (device.metricBindings ?? []).find(
        (b) => b.metricKey === 'cpu_usage' || b.metricKey === 'cpu',
      );
      if (cpuBindingRow && cpuBindingRow.oid !== HR_PROCESSOR_LOAD_OID) {
        await this.prisma.deviceMetricBinding.update({
          where: { id: cpuBindingRow.id },
          data: {
            oid: HR_PROCESSOR_LOAD_OID,
            source: 'profile',
            broken: false,
            brokenReason: null,
            resolvedAt: new Date(),
          },
        });
        changed = true;
      }

      const memoryRows = (device.metricBindings ?? []).filter((b) =>
        LEGACY_MEMORY_METRICS.has(b.metricKey),
      );
      const canonicalMemoryRow = (device.metricBindings ?? []).find(
        (b) => b.metricKey === 'memory_available',
      );
      for (const row of memoryRows) {
        if (canonicalMemoryRow && canonicalMemoryRow.id !== row.id) {
          await this.prisma.deviceMetricBinding.delete({ where: { id: row.id } });
        } else if (!canonicalMemoryRow) {
          await this.prisma.deviceMetricBinding.update({
            where: { id: row.id },
            data: {
              metricKey: 'memory_available',
              oid: UCD_MEM_AVAILABLE_OID,
              source: 'profile',
              broken: false,
              brokenReason: null,
              resolvedAt: new Date(),
              memberOids: RECOVERABLE_MEMORY_MEMBERS,
            },
          });
        }
        changed = true;
      }
      if (canonicalMemoryRow && memoryPoint &&
          (canonicalMemoryRow.oid !== UCD_MEM_AVAILABLE_OID ||
           JSON.stringify(canonicalMemoryRow.memberOids ?? []) !== JSON.stringify(RECOVERABLE_MEMORY_MEMBERS))) {
        await this.prisma.deviceMetricBinding.update({
          where: { id: canonicalMemoryRow.id },
          data: {
            oid: UCD_MEM_AVAILABLE_OID,
            source: 'profile',
            broken: false,
            brokenReason: null,
            resolvedAt: new Date(),
            memberOids: RECOVERABLE_MEMORY_MEMBERS,
          },
        });
        changed = true;
      }

      if (!changed) continue;
      await this.configPublisher.publishForDevice(device.id);
      this.logger.log(
        `Control iD ${device.id}: temperatura não suportada, CPU → ${HR_PROCESSOR_LOAD_OID}`,
      );
    }
  }
}