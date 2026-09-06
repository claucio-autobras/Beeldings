import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ClusterService } from '../../cluster/cluster.service.js';
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { DeviceConfigPublisherService } from './device-config-publisher.service.js';
import { SnmpDiagnoseService } from './snmp-diagnose.service.js';
import { SnmpDiscoveryPersistenceService } from './snmp-discovery-persistence.service.js';
import {
  SnmpMetricService,
  normalizeMetricKey,
  METRICS_WITHOUT_OID,
} from './snmp-metric.service.js';
import { resolveSnmpRuntimeCredentials } from './snmp-credential.util.js';

const DEFAULT_SNMP_PORT = 161;

/**
 * Métricas de saúde de uma controladora de acesso cujo binding é sempre um
 * OID (nunca derivado) — usadas para detectar pontos "presos" sem leitura.
 * Mantido em sincronia manual com AC_HEALTH_METRICS (sca.controller.ts):
 * duplicado aqui em vez de importado para não criar acoplamento entre a
 * camada de apresentação e este job de fundo.
 */
const AC_HEALTH_METRIC_TAGS = new Set([
  'cpu',
  'cpu_usage',
  'memory',
  'memory_available',
  'memory_used_percent',
  'ram_total',
  'memory_total',
  'temperature',
  'packet_loss',
]);

/** Intervalo entre varreduras — o gate de 24h por device (canRunAutoDiscovery) domina a cadência real. */
const TICK_MS = 60 * 60_000;
/** Carência pós-boot: evita disputa com a partida do restante do sistema. */
const BOOT_DELAY_MS = 120_000;

/**
 * ScaAutoRepairSchedulerService
 *
 * Rede de segurança para controladoras de acesso (SCA) cuja descoberta
 * automática de cadastro (runAutoDiscovery 'registration' em sca.controller)
 * não resolveu OID para alguma métrica de saúde (ex.: CPU falhou no walk
 * inicial, mas RAM/uptime resolveram). Sem este job, um ponto que nasceu
 * `oid: null` e nunca foi confirmado por diagnóstico fica "sem dados" para
 * sempre — nada mais tentava de novo, só o operador clicando manualmente em
 * "Ativar e corrigir leituras" no diagnóstico SNMP.
 *
 * Job periódico LEADER-ONLY (mesmo padrão do InsightSchedulerService):
 * a cada tick, procura controladoras com ao menos um ponto de saúde ainda
 * sem OID e sem marcação `unsupported` (que sinalizaria "confirmadamente
 * não suportado, não tentar de novo"), e reexecuta a mesma descoberta usada
 * no cadastro (trigger='scheduled'), respeitando o limite de 1x/dia por
 * device já embutido em canRunAutoDiscovery.
 */
@Injectable()
export class ScaAutoRepairSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScaAutoRepairSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimeout: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cluster: ClusterService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly snmpDiagnose: SnmpDiagnoseService,
    private readonly snmpDiscovery: SnmpDiscoveryPersistenceService,
    private readonly snmpMetric: SnmpMetricService,
    private readonly configPublisher: DeviceConfigPublisherService,
  ) {}

  onModuleInit(): void {
    this.startTimeout = setTimeout(() => {
      this.startTimeout = null;
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_MS);
    }, BOOT_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.startTimeout) clearTimeout(this.startTimeout);
    if (this.timer) clearInterval(this.timer);
    this.startTimeout = null;
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (!this.cluster.isLeader() || this.running) return;
    this.running = true;
    try {
      const deviceIds = await this.findControllersNeedingRepair();
      if (deviceIds.length === 0) return;
      this.logger.log(
        `Reparo automático SCA: ${deviceIds.length} controladora(s) com métrica de saúde pendente`,
      );
      for (const deviceId of deviceIds) {
        try {
          await this.runAutoDiscovery(deviceId);
        } catch (err) {
          this.logger.warn(
            `Reparo automático SCA falhou para ${deviceId} (não bloqueante): ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Controladoras ACCESS_CONTROLLER com pelo menos um ponto de saúde ainda
   * `oid: null` e não marcado `unsupported` — candidatas a nova tentativa.
   */
  private async findControllersNeedingRepair(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ device_id: string }>>`
      SELECT DISTINCT p.device_id
      FROM device_points p
      JOIN devices d ON d.id = p.device_id
      WHERE d.monitored_device_type = 'ACCESS_CONTROLLER'
        AND d.gateway_id IS NOT NULL
        AND (p.binding ->> 'oid') IS NULL
        AND COALESCE((p.binding ->> 'unsupported')::boolean, false) = false
        AND (p.binding ->> 'metric') = ANY (${Array.from(AC_HEALTH_METRIC_TAGS)}::text[])
    `;
    return rows.map((r) => r.device_id);
  }

  /**
   * Mesma lógica de `ScaController.runAutoDiscovery` (trigger='scheduled').
   * Duplicada aqui de propósito — o controller mantém a versão 'registration'
   * síncrona ao fluxo HTTP; este job roda em segundo plano sem depender dele.
   */
  private async runAutoDiscovery(deviceId: string): Promise<void> {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device?.gatewayId) return;
    if (this.deviceStatus.getStatus(device.gatewayId) === 'offline') return;
    if (!(await this.snmpDiscovery.canRunAutoDiscovery(deviceId))) return;

    const cfg = (device.config ?? {}) as {
      snmpVersion?: string;
      community?: string;
      manufacturer?: string | null;
    };
    const credential = await this.prisma.snmpCredential.findUnique({ where: { deviceId } });
    const creds = resolveSnmpRuntimeCredentials(credential, cfg);

    const result = await this.snmpDiagnose.diagnose({
      tenantId: device.tenantId,
      gatewayId: device.gatewayId,
      ip: device.ip as string,
      port: device.port ?? DEFAULT_SNMP_PORT,
      snmpVersion: creds.snmpVersion,
      community: creds.community,
      v3: creds.v3,
      current: [],
      candidates: [],
      deviceType: device.monitoredDeviceType ?? undefined,
      manufacturer: cfg.manufacturer?.trim() || undefined,
    });
    if (!result.success) return;

    if (result.reachable && result.canonicalMetrics) {
      const resolved = Object.values(result.canonicalMetrics)
        .filter((metric) =>
          metric.value !== null &&
          !METRICS_WITHOUT_OID.has(normalizeMetricKey(metric.canonicalKey)),
        )
        .map((metric) => ({
          metricKey: normalizeMetricKey(metric.canonicalKey),
          oid: metric.selectedOid ?? metric.memberOids?.[0] ?? metric.dependencyOids?.[0] ?? '',
          scale: 1,
          unit: metric.unit,
          memberOids: [...new Set([
            ...(metric.memberOids ?? []),
            ...(metric.dependencyOids ?? []),
          ])],
          memberLabels: {},
          confidence: metric.confidence === 'exact' ? 'exact' as const : 'inferred' as const,
        }))
        .filter((metric) => metric.oid);
      await this.snmpMetric.persistAutoResolvedBindings({
        tenantId: device.tenantId,
        deviceId,
        sysObjectId: result.sysObjectId,
        resolved,
        onlyIfMissing: true,
      });
      await this.configPublisher.publishForDevice(deviceId);
    }

    await this.snmpDiscovery.recordRun({
      tenantId: device.tenantId,
      deviceId,
      trigger: 'scheduled',
      result,
    });
    this.logger.log(
      `Descoberta scheduled persistida para o device ${deviceId} ` +
        `(${(result.walk ?? []).reduce((n, s) => n + s.entries.length, 0)} OIDs)`,
    );
  }
}
