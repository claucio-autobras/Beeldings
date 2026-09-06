import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  ONLY_ACCESS_CONTROLLER_DEVICES,
  SNMP_PROTOCOL,
} from '../../prisma/device-filters.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DeviceConfigPublisherService } from '../application/device-config-publisher.service.js';
import {
  SnmpHealthTestService,
} from '../application/snmp-health-test.service.js';
import {
  SnmpDiagnoseService,
  type DiagnoseOidProbe,
  type SnmpDiagnoseJobStatus,
} from '../application/snmp-diagnose.service.js';
import {
  buildSnmpCredentialData,
  resolveSnmpRuntimeCredentials,
  sanitizeSnmpV3Body,
  snmpCredentialPublicView,
  type SnmpCredentialBody,
  type SnmpVersion,
} from '../application/snmp-credential.util.js';
import { SnmpDiscoveryPersistenceService } from '../application/snmp-discovery-persistence.service.js';
import {
  SnmpMetricService,
  normalizeMetricKey,
  CANONICAL_METRIC_KEYS,
  METRICS_WITHOUT_OID,
  extractFirmwareFamily,
  normalizeSnmpOidSelection,
  type SnmpOidSelection,
} from '../application/snmp-metric.service.js';
import {
  CapabilityProbeService,
  resolveAcProfileLabel,
} from '../application/capability-probe.service.js';
import {
  ACCESS_CONTROLLER_OID_PROFILES,
  GENERIC_AC_PROFILE,
  AC_HEALTH_METRIC_META,
  resolveAcOidProfile,
  type AcHealthMetric,
} from '../application/access-controller-oid-profiles.js';
import {
  buildDynamicPacketLossCandidates,
} from './cftv.controller.js';
import { buildDiscoveredObjects } from '../application/snmp-oid-semantics.js';
import {
  buildSnmpCardDisplay,
  extractSnmpInfoEntries,
  type SnmpInfoEntry,
} from '../application/snmp-card-metrics.util.js';
import { runLiveOidTest } from '../application/snmp-live-oid-test.util.js';
import { SnmpMibService } from '../application/snmp-mib.service.js';
import {
  applyCustomDiscoveredPoints,
  sanitizeCustomPoints,
} from '../application/snmp-custom-points.util.js';
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { resolveBodyTenantScope, resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_SNMP_PORT = 161;
const DEFAULT_POLLING_S = 30;

const REACHABILITY_DETAIL_POINTS = [
  {
    tag: 'REACHABILITY_LATENCY',
    objectName: 'Latência SNMP',
    metric: 'reachability_latency',
    oid: null as string | null,
    scale: 1,
    unit: 'ms',
  },
  {
    tag: 'REACHABILITY_FAILURE_RATE',
    objectName: 'Taxa de falha SNMP (5 min)',
    metric: 'reachability_failure_rate',
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
] as const;

/**
 * Pontos padrão de saúde de uma controladora de acesso (SNMP).
 * Mesmo padrão das câmeras SNMP: STATUS sem OID (derivado da alcançabilidade);
 * UPTIME via sysUpTime. As métricas de saúde (cpu/memory/temperature/
 * packet_loss) nascem SEM OID fixo: o gateway resolve o OID pela cadeia de
 * perfis base→fabricante (base MIB-II/UCD sempre cobre o genérico). OID fixo
 * no binding só entra via diagnóstico/edição manual do operador — um OID
 * genérico engessado aqui impediria o fallback do perfil do fabricante
 * (ex.: Control iD não expõe HOST-RESOURCES/UCD e ficava sem leitura).
 */
const DEFAULT_ACCESS_CONTROLLER_POINTS = [
  {
    tag: 'STATUS',
    objectName: 'Status (online/offline)',
    metric: 'status',
    oid: null as string | null,
    scale: 1,
    unit: '',
  },
  {
    tag: 'REACHABILITY',
    objectName: 'Alcançabilidade SNMP',
    metric: 'reachability',
    // Sem OID: derivado pela alcançabilidade (respondeu = 1, sem resposta = 0).
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
  ...REACHABILITY_DETAIL_POINTS,
  {
    tag: 'UPTIME',
    objectName: 'Tempo ligada',
    metric: 'uptime',
    oid: '1.3.6.1.2.1.1.3.0',
    scale: 0.01,
    unit: 's',
  },
  {
    tag: 'CPU',
    objectName: 'Uso de CPU',
    metric: 'cpu',
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
  {
    tag: 'MEMORIA',
    objectName: 'Memória disponível',
    // Canônico usado em todo o resto do fluxo (diagnóstico/apply-snmp-oids
    // trabalham só com 'memory_available' — ver AC_HEALTH_METRICS/DIAG_METRICS
    // abaixo). O alias legado 'memory' segue reconhecido na leitura (matching
    // por tag) para não deixar órfãs controladoras cadastradas antes desta
    // mudança, mas NUNCA deve voltar a ser gravado num binding novo — o
    // mismatch de chave entre o ponto padrão e o catálogo de diagnóstico era
    // exatamente o que fazia `applySnmpOids` recriar um segundo ponto MEMORIA.
    metric: 'memory_available',
    oid: null as string | null,
    scale: 1,
    unit: 'kB',
  },
  {
    tag: 'MEMORIA_TOTAL',
    objectName: 'Memória RAM total',
    metric: 'ram_total',
    oid: null as string | null,
    scale: 1,
    unit: 'bytes',
  },
  {
    tag: 'TEMPERATURA',
    objectName: 'Temperatura',
    metric: 'temperature',
    oid: null as string | null,
    scale: 1,
    unit: '°C',
  },
  {
    tag: 'PACOTES_PERDIDOS',
    objectName: 'Pacotes perdidos (descartes if1)',
    metric: 'packet_loss',
    oid: null as string | null,
    scale: 1,
    unit: 'pkts',
  },
  {
    tag: 'PERDA_PING',
    objectName: 'Perda de pacotes (ping)',
    metric: 'ping_loss',
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
];

/** Métricas de saúde monitoradas. */
const AC_HEALTH_METRICS: AcHealthMetric[] = [
  'cpu',
  'memory_available',
  'ram_total',
  'temperature',
  'packet_loss',
];

/** Métricas cobertas pelo diagnóstico SNMP (saúde + uptime). */
type DiagMetric = AcHealthMetric | 'uptime';
const DIAG_METRICS: DiagMetric[] = [
  'cpu',
  'memory_available',
  'ram_total',
  'temperature',
  'packet_loss',
  'uptime',
];

const DIAG_METRIC_LABELS: Record<DiagMetric, string> = {
  cpu: 'Uso de CPU',
  memory: 'Memória disponível',
  memory_available: 'Memória disponível',
  ram_total: 'Memória RAM total',
  temperature: 'Temperatura',
  packet_loss: 'Pacotes perdidos',
  uptime: 'Tempo ligada',
};

interface DiagnoseCandidate {
  metric: DiagMetric;
  oid: string;
  profileLabel: string;
  scale: number;
  unit: string;
}

/**
 * Catálogo de OIDs candidatos do diagnóstico: união dos OIDs de TODOS os
 * perfis de fabricante + genérico, deduplicado por metric+oid.
 */
function buildAcDiagnoseCatalog(): DiagnoseCandidate[] {
  const byKey = new Map<string, DiagnoseCandidate>();
  for (const profile of ACCESS_CONTROLLER_OID_PROFILES) {
    for (const metric of AC_HEALTH_METRICS) {
      const entry = profile.oids[metric];
      if (!entry?.oid) continue;
      const key = `${metric}|${entry.oid}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.profileLabel.split(', ').includes(profile.label)) {
          existing.profileLabel += `, ${profile.label}`;
        }
      } else {
        byKey.set(key, {
          metric,
          oid: entry.oid,
          profileLabel: profile.label,
          scale: entry.scale,
          unit: entry.unit,
        });
      }
    }
  }
  // sysUpTime padrão MIB-II.
  byKey.set('uptime|1.3.6.1.2.1.1.3.0', {
    metric: 'uptime',
    oid: '1.3.6.1.2.1.1.3.0',
    profileLabel: 'MIB-II padrão',
    scale: 0.01,
    unit: 's',
  });
  return [...byKey.values()];
}

// ─── Controller ───────────────────────────────────────────────────────────────

interface ControllerBody {
  name?: string;
  siteId?: string;
  tenantId?: string;
  gatewayId?: string;
  ip?: string;
  port?: number;
  snmpVersion?: '1' | '2c' | '3';
  community?: string;
  /** Campos SNMPv3 (USM) — obrigatórios conforme o nível quando snmpVersion='3'. */
  securityName?: string;
  authProtocol?: string;
  authKey?: string;
  privProtocol?: string;
  privKey?: string;
  contextName?: string;
  pollingInterval?: number;
  manufacturer?: string | null;
  /** ID da MIB importada usada somente para enriquecer o diagnóstico. */
  snmpMibId?: string | null;
  /** Overrides manuais de OID por ponto (saúde + uptime). */
  healthOids?: Partial<Record<DiagMetric, string>>;
  /**
   * ID do perfil de monitoramento selecionado manualmente.
   * null = limpar override e usar detecção automática.
   */
  profileId?: string | null;
  /**
   * Overrides de OID por métrica definidos pelo operador.
   * null = limpar todos os overrides.
   */
  profileOverrides?: Record<string, string> | null;
}

type ControllerWithRelations = Prisma.DeviceGetPayload<{
  include: { points: true; site: true; snmpCredential?: true; snmpMib?: true };
}> & {
  snmpCredential?: Prisma.SnmpCredentialGetPayload<object> | null;
};

/**
 * ScaController — área de SCA (controladoras de acesso monitoradas via SNMP).
 *
 * Controladoras são Devices com protocol='snmp' e monitoredDeviceType='ACCESS_CONTROLLER':
 * o gateway faz o polling dos OIDs e publica no tópico canônico de telemetria.
 * Elas são EXCLUÍDAS das listagens BMS e vivem nesta área própria.
 */
@Controller('sca')
export class ScaController {
  private readonly logger = new Logger(ScaController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configPublisher: DeviceConfigPublisherService,
    private readonly snmpHealthTest: SnmpHealthTestService,
    private readonly snmpDiagnose: SnmpDiagnoseService,
    private readonly capabilityProbe: CapabilityProbeService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly snmpMib: SnmpMibService,
    private readonly snmpDiscovery: SnmpDiscoveryPersistenceService,
    private readonly snmpMetric: SnmpMetricService,
  ) {}

  /** GET /sca/oid-profiles — catálogo de perfis de OIDs por fabricante. */
  @Get('oid-profiles')
  @UseGuards(JwtAuthGuard)
  getOidProfiles() {
    return ACCESS_CONTROLLER_OID_PROFILES.map((p) => ({
      id: p.id,
      label: p.label,
      oids: p.oids,
    }));
  }

  /**
   * GET /sca/profiles?deviceType=ACCESS_CONTROLLER — perfis de monitoramento
   * selecionáveis manualmente pelo operador.
   */
  @Get('profiles')
  @UseGuards(JwtAuthGuard)
  getMonitoringProfiles(@Query('deviceType') deviceType = 'ACCESS_CONTROLLER') {
    if (deviceType !== 'ACCESS_CONTROLLER') return [];
    return ACCESS_CONTROLLER_OID_PROFILES.map((p) => ({
      id: p.id,
      label: p.label,
      metrics: Object.entries(p.oids).map(([metricKey, entry]) => ({
        metricKey,
        oid: entry?.oid ?? null,
        scale: entry?.scale ?? 1,
        unit: entry?.unit ?? '',
      })),
    }));
  }

  /** GET /sca/controllers — lista as controladoras (com status vivo). */
  @Get('controllers')
  @UseGuards(JwtAuthGuard)
  async listControllers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tenantId') tenantId?: string,
  ) {
    const effectiveTenantId = resolveTenantScope(user, tenantId);

    const devices = await this.prisma.device.findMany({
      where: {
        ...(effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
        ...ONLY_ACCESS_CONTROLLER_DEVICES,
      },
      orderBy: { name: 'asc' },
      include: { points: true, site: true, snmpCredential: true, snmpMib: true },
    });

    const lastSeenMap = await this.deviceStatus.resolveLastSeenMany(
      devices.map((d) => d.id),
    );
    // Controladoras criadas antes do ponto RAM total recebem o backfill uma
    // única vez; controladoras com pontos de saúde duplicados (alias legado
    // 'memory' x 'memory_available' — ver DEFAULT_ACCESS_CONTROLLER_POINTS)
    // são higienizadas na mesma passada. O objeto points é atualizado em
    // memória para a mesma resposta.
    for (const device of devices) {
      const consolidated = await this.consolidateDuplicateHealthPoints(device);
      const added = await this.ensureRamTotalPoint(device);
      if (consolidated || added) await this.configPublisher.publishForDevice(device.id);
    }
    return devices.map((d) => this.mapController(d, lastSeenMap.get(d.id) ?? null));
  }

  /**
   * Higieniza pontos SNMP duplicados (mesma `tag`) de controladoras já
   * cadastradas — a origem histórica é o alias legado `metric: 'memory'`
   * (registro) divergindo do canônico `metric: 'memory_available'` (usado por
   * diagnóstico/apply-snmp-oids), que fazia `applySnmpOids` criar um SEGUNDO
   * DevicePoint com a tag MEMORIA em vez de atualizar o existente. Idempotente
   * — roda a cada `GET /sca/controllers` e não faz nada quando não há dupes.
   *
   * Mantém o ponto mais "completo" como canônico (tem OID funcional > leitura
   * mais recente > mais antigo) e migra trends/alarmes dos duplicados antes de
   * apagá-los, para nunca perder histórico/alarmes configurados no ponto que
   * for descartado.
   */
  private async consolidateDuplicateHealthPoints(
    device: ControllerWithRelations,
  ): Promise<boolean> {
    const byTag = new Map<string, ControllerWithRelations['points']>();
    for (const point of device.points) {
      const list = byTag.get(point.tag);
      if (list) list.push(point);
      else byTag.set(point.tag, [point]);
    }

    let changed = false;
    for (const [tag, group] of byTag) {
      if (group.length < 2) continue;

      const sorted = [...group].sort((a, b) => {
        const aOid = Boolean(((a.binding ?? {}) as { oid?: string | null }).oid);
        const bOid = Boolean(((b.binding ?? {}) as { oid?: string | null }).oid);
        if (aOid !== bOid) return aOid ? -1 : 1;
        const aAt = a.lastValueAt ? a.lastValueAt.getTime() : 0;
        const bAt = b.lastValueAt ? b.lastValueAt.getTime() : 0;
        if (aAt !== bAt) return bAt - aAt;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      const [canonical, ...losers] = sorted;

      // O canônico "vence" por completude, mas se ele não tem OID funcional e
      // algum duplicado tem, herda o binding/leitura do duplicado — nunca
      // perde uma leitura que já estava funcionando.
      const canonicalBinding = (canonical.binding ?? {}) as Record<string, unknown>;
      const donor = !canonicalBinding.oid
        ? losers.find((p) => Boolean(((p.binding ?? {}) as { oid?: string | null }).oid))
        : undefined;

      const updateData: Prisma.DevicePointUpdateInput = donor
        ? {
            binding: donor.binding as Prisma.InputJsonValue,
            lastValue: donor.lastValue,
            lastValueAt: donor.lastValueAt,
            lastValueState: donor.lastValueState,
          }
        : {};

      const loserIds = losers.map((p) => p.id);
      await this.prisma.$transaction([
        ...(donor ? [this.prisma.devicePoint.update({ where: { id: canonical.id }, data: updateData })] : []),
        this.prisma.trend.updateMany({ where: { pointId: { in: loserIds } }, data: { pointId: canonical.id } }),
        this.prisma.alarmRule.updateMany({ where: { pointId: { in: loserIds } }, data: { pointId: canonical.id } }),
        this.prisma.devicePoint.deleteMany({ where: { id: { in: loserIds } } }),
      ]);

      // Mantém o objeto em memória coerente para o resto do request (resposta
      // desta mesma chamada e o backfill de RAM total logo em seguida).
      device.points = device.points.filter((p) => !loserIds.includes(p.id));
      if (donor) {
        const idx = device.points.findIndex((p) => p.id === canonical.id);
        if (idx !== -1) {
          device.points[idx] = {
            ...device.points[idx],
            binding: donor.binding,
            lastValue: donor.lastValue,
            lastValueAt: donor.lastValueAt,
            lastValueState: donor.lastValueState,
          };
        }
      }
      changed = true;
      this.logger.log(
        `Pontos SNMP duplicados consolidados: device=${device.id} tag=${tag} removidos=${losers.length}`,
      );
    }
    return changed;
  }

  private async ensureRamTotalPoint(
    device: ControllerWithRelations,
  ): Promise<boolean> {
    const exists = device.points.some((point) => {
      const binding = (point.binding ?? {}) as { metric?: string };
      return point.tag === 'MEMORIA_TOTAL' ||
        binding.metric === 'ram_total' ||
        binding.metric === 'memory_total';
    });
    if (exists) return false;

    const instance = device.points.reduce((max, point) => Math.max(max, point.instance), -1) + 1;
    const created = await this.prisma.devicePoint.create({
      data: {
        deviceId: device.id,
        tag: 'MEMORIA_TOTAL',
        objectName: 'Memória RAM total',
        objectType: 'snmp',
        instance,
        unit: 'bytes',
        binding: {
          metric: 'ram_total',
          oid: null,
          scale: 1,
          unsupported: false,
          healthState: 'pending',
          healthReason: 'awaiting_read',
        },
        lastValueState: 'waiting_event',
      },
    });
    device.points.push(created);
    return true;
  }

  /** POST /sca/controllers — cadastra uma controladora com os pontos padrão. */
  @Post('controllers')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async createController(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ControllerBody,
  ) {
    const name = body.name?.trim();
    const ip = body.ip?.trim();
    if (!name) throw new BadRequestException('name é obrigatório');
    if (!ip) throw new BadRequestException('ip é obrigatório');
    if (!body.gatewayId) {
      throw new BadRequestException('gatewayId é obrigatório (faz o monitoramento)');
    }

    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');

    if (!this.isValidIp(ip)) {
      throw new BadRequestException('ip inválido (IPv4 esperado)');
    }

    const snmpVersion: SnmpVersion = body.snmpVersion === '1' || body.snmpVersion === '3'
      ? body.snmpVersion
      : '2c';
    // Valida ANTES de criar o device: credenciais v3 incompletas = 400.
    const credentialData = buildSnmpCredentialData(snmpVersion, body);

    if (
      body.profileId &&
      !ACCESS_CONTROLLER_OID_PROFILES.some((profile) => profile.id === body.profileId)
    ) {
      throw new BadRequestException(`ID de perfil desconhecido: "${body.profileId}".`);
    }
    if (body.snmpMibId) {
      const mib = await this.prisma.snmpMib.findUnique({ where: { id: body.snmpMibId } });
      if (!mib) throw new BadRequestException('MIB SNMP não encontrada');
    }
    const device = await this.prisma.device.create({
      data: {
        name,
        protocol: SNMP_PROTOCOL,
        monitoredDeviceType: 'ACCESS_CONTROLLER',
        ip,
        port: body.port || DEFAULT_SNMP_PORT,
        status: 'offline',
        tenantId,
        siteId: body.siteId || null,
        gatewayId: body.gatewayId,
        config: {
          // Retrocompat: versão/community continuam em Device.config enquanto
          // as duas fontes coexistirem; a tabela snmp_credential é a fonte da
          // verdade (chaves v3 SÓ lá, cifradas).
          snmpVersion,
          ...(snmpVersion !== '3'
            ? { community: body.community?.trim() || 'public' }
            : {}),
          pollingIntervalMs: (body.pollingInterval ?? DEFAULT_POLLING_S) * 1000,
          manufacturer: body.manufacturer?.trim() || null,
          ...(body.profileId
            ? { profileId: body.profileId, profileSource: 'manual' }
            : {}),
        },
        snmpCredential: { create: { tenantId, ...credentialData } },
        points: {
          create: DEFAULT_ACCESS_CONTROLLER_POINTS.map((p, i) => ({
            tag: p.tag,
            objectName: p.objectName,
            objectType: 'snmp',
            instance: i,
            unit: p.unit,
            binding: { metric: p.metric, oid: p.oid, scale: p.scale },
          })),
        },
      },
      include: { points: true, site: true, snmpCredential: true, snmpMib: true },
    });
    if (body.snmpMibId) {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { snmpMibId: body.snmpMibId },
      });
      device.snmpMib = await this.prisma.snmpMib.findUnique({
        where: { id: body.snmpMibId },
      });
    }

    await this.configPublisher.publishForDevice(device.id);
    this.logger.log(`Controladora SCA cadastrada: ${device.id} (${ip}) por ${user.email}`);

    // Descoberta/aplicação e seed são sequenciais: o primeiro valor do card
    // deve usar a mesma configuração canônica que acabou de ser publicada.
    void this.finishRegistrationSetup(device.id).catch((err: Error) => {
      this.logger.warn(
        `Configuração pós-cadastro da controladora ${device.id} falhou (não bloqueante): ${err.message}`,
      );
    });

    return this.mapController(device, null);
  }

  private async finishRegistrationSetup(deviceId: string): Promise<void> {
    const discoveryResult = await this.runAutoDiscovery(deviceId, 'registration');
    const refreshed = await this.prisma.device.findUnique({
      where: { id: deviceId },
      include: { points: true, snmpCredential: true },
    });
    if (refreshed) await this.seedFromRegistrationTest(refreshed, discoveryResult);
  }

  /**
   * Semeia lastValue/lastValueAt dos pontos recém-criados com uma leitura
   * SNMP imediata via gateway (mesmos OIDs do perfil do fabricante usados no
   * botão "Testar SNMP"). Padrão live-vence-seed do CFTV: só escreve onde
   * lastValueAt ainda é null — telemetria que chegar antes nunca é sobrescrita.
   * Falha/timeout/gateway offline = silêncio (o polling normal cobre depois).
   */
  private async seedFromRegistrationTest(
    device: ControllerWithRelations | (Prisma.DeviceGetPayload<{ include: { points: true } }>),
    discoveryResult?: Awaited<ReturnType<SnmpDiagnoseService['diagnose']>> | null,
  ): Promise<void> {
    if (!device.gatewayId) return;
    if (this.deviceStatus.getStatus(device.gatewayId) === 'offline') return;

    const cfg = (device.config ?? {}) as {
      snmpVersion?: '1' | '2c';
      community?: string;
      manufacturer?: string | null;
    };
    const credential = await this.prisma.snmpCredential.findUnique({
      where: { deviceId: device.id },
    });
    const creds = resolveSnmpRuntimeCredentials(credential, cfg);

    // Use the persisted effective bindings produced by discovery/apply. A
    // profile fallback would silently miss a canonical OID discovered by walk
    // (and could seed a different source than the one just published).
    const oids: Record<string, string> = {};
    const scaleByPoint: Record<string, number> = {};
    const unsupportedPoints = new Set<string>();
    const hasStatusPoint = device.points.some((point) => {
      const binding = (point.binding ?? {}) as { metric?: string };
      return point.tag.trim().toUpperCase() === 'STATUS' || binding.metric === 'status';
    });
    const canonicalValues =
      discoveryResult?.success && discoveryResult.reachable
        ? discoveryResult.canonicalMetrics ?? {}
        : {};
    const oidResults =
      discoveryResult?.success && discoveryResult.reachable
        ? discoveryResult.oidResults
        : {};
    const canonicalKeyForPoint = (metric: string): string => {
      if (metric.trim().toLowerCase() === 'packet_loss') return 'packet_loss';
      const normalized = normalizeMetricKey(metric);
      return normalized === 'cpu' ? 'cpu_usage'
        : normalized === 'temperature' ? 'cpu_temperature'
        : normalized;
    };
    const seededValues = new Map<string, number>();
    for (const point of device.points) {
      const binding = (point.binding ?? {}) as {
        metric?: string;
        oid?: string | null;
        scale?: number;
        unsupported?: boolean;
      };
      if (binding.unsupported) {
        unsupportedPoints.add(point.id);
        continue;
      }
      const rawMetric = binding.metric?.trim().toLowerCase();
      const metric = rawMetric === 'packet_loss'
        ? 'packet_loss'
        : binding.metric ? normalizeMetricKey(binding.metric)
        : point.tag.trim().toUpperCase() === 'STATUS' ? 'status' : '';
      if (!metric || metric === 'status') continue;
      const canonical = canonicalValues[canonicalKeyForPoint(metric)];
      if (canonical?.value !== null && canonical?.value !== undefined &&
          Number.isFinite(canonical.value)) {
        // Canonical results are already in the binding unit. Applying the
        // point scale again here would turn bytes or temperature into garbage.
        seededValues.set(point.id, canonical.value);
        continue;
      }
      if (!binding.oid) continue;
      const oidRead = binding.oid ? oidResults[binding.oid] : null;
      if (oidRead?.responded && oidRead.value !== null && Number.isFinite(oidRead.value)) {
        seededValues.set(point.id, oidRead.value * (binding.scale ?? 1));
        continue;
      }
      // Key by point id, not by metric: two effective bindings must never
      // exchange their samples during registration.
      oids[point.id] = binding.oid;
      scaleByPoint[point.id] = binding.scale ?? 1;
    }
    const hasReachableDiscovery =
      discoveryResult?.success === true && discoveryResult.reachable === true;
    if (hasStatusPoint && !hasReachableDiscovery) {
      // Reachability is itself a canonical, synthetic source. It lets the
      // STATUS card receive the first sample without inventing a binding OID.
      oids.__status_probe = '1.3.6.1.2.1.1.3.0';
      scaleByPoint.__status_probe = 0.01;
    }
    if (Object.keys(oids).length === 0 && seededValues.size === 0 && !hasStatusPoint) return;

    const result = Object.keys(oids).length > 0
      ? await this.snmpHealthTest.test({
          tenantId: device.tenantId,
          gatewayId: device.gatewayId,
          ip: device.ip as string,
          port: device.port ?? DEFAULT_SNMP_PORT,
          snmpVersion: creds.snmpVersion,
          community: creds.community,
          v3: creds.v3,
          oids,
        })
      : { success: true as const, reachable: true, values: {} };
    if (!result.success || !result.reachable) return;

    const at = new Date();
    let seeded = 0;
    for (const point of device.points) {
      const b = (point.binding ?? {}) as { metric?: string; unsupported?: boolean };
      const metric = b.metric ??
        (point.tag.trim().toUpperCase() === 'STATUS' ? 'status' : undefined);
      if (!metric || unsupportedPoints.has(point.id)) continue;

      let value: number | null = null;
      if (metric === 'status') {
        value = 1; // respondeu ao teste = online
      } else {
        value = seededValues.get(point.id) ?? null;
        if (value === null) {
          const raw = result.values[point.id];
          if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
          value = raw * (scaleByPoint[point.id] ?? 1);
        }
      }

      // Live vence seed: só escreve se nenhuma telemetria chegou ainda.
      const updated = await this.prisma.devicePoint.updateMany({
        where: { id: point.id, lastValueAt: null },
        data: { lastValue: value, lastValueAt: at, lastValueState: null },
      });
      seeded += updated.count;
    }
    if (seeded > 0) {
      this.logger.log(
        `Seed pós-cadastro da controladora ${device.id}: ${seeded} ponto(s) semeado(s) do teste SNMP`,
      );
    }
  }

  /** PATCH /sca/controllers/:id — edita nome/site/rede/config SNMP e republica. */
  @Patch('controllers/:id')
  @UseGuards(JwtAuthGuard)
  async updateController(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ControllerBody,
  ) {
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);

    if (body.siteId) {
      const site = await this.prisma.site.findFirst({
        where: { id: body.siteId, tenantId: device.tenantId },
      });
      if (!site) throw new BadRequestException('Site inválido para esta controladora');
    }

    const cfg = (device.config ?? {}) as Record<string, unknown>;
    if (body.snmpMibId !== undefined && body.snmpMibId !== null) {
      const mib = await this.prisma.snmpMib.findUnique({ where: { id: body.snmpMibId } });
      if (!mib) throw new BadRequestException('MIB SNMP não encontrada');
    }

    // Credencial SNMP: upsert na tabela snmp_credential (fonte da verdade).
    // Na edição, chave v3 vazia = manter a atual (cifrada).
    if (
      body.snmpVersion !== undefined ||
      body.community !== undefined ||
      body.securityName !== undefined ||
      body.authProtocol !== undefined ||
      body.authKey !== undefined ||
      body.privProtocol !== undefined ||
      body.privKey !== undefined ||
      body.contextName !== undefined
    ) {
      const existing = await this.prisma.snmpCredential.findUnique({
        where: { deviceId: id },
      });
      const currentVersion: SnmpVersion =
        existing?.version === '1' || existing?.version === '3'
          ? (existing.version as SnmpVersion)
          : cfg.snmpVersion === '1'
            ? '1'
            : '2c';
      const nextVersion: SnmpVersion =
        body.snmpVersion === '1' || body.snmpVersion === '2c' || body.snmpVersion === '3'
          ? body.snmpVersion
          : currentVersion;
      const mergedBody: SnmpCredentialBody = {
        ...body,
        community:
          body.community?.trim() ||
          existing?.community ||
          (cfg.community as string | undefined) ||
          'public',
        securityName: body.securityName?.trim() || existing?.securityName || undefined,
        authProtocol: body.authProtocol ?? existing?.authProtocol ?? undefined,
        privProtocol: body.privProtocol ?? existing?.privProtocol ?? undefined,
        contextName: body.contextName ?? existing?.contextName ?? undefined,
      };
      const credentialData = buildSnmpCredentialData(nextVersion, mergedBody, existing);
      await this.prisma.snmpCredential.upsert({
        where: { deviceId: id },
        create: { tenantId: device.tenantId, deviceId: id, ...credentialData },
        update: credentialData,
      });
    }

    let newConfig: Record<string, unknown> = {
      ...cfg,
      ...(body.snmpVersion ? { snmpVersion: body.snmpVersion } : {}),
      ...(body.community?.trim() ? { community: body.community.trim() } : {}),
      ...(body.pollingInterval
        ? { pollingIntervalMs: Number(body.pollingInterval) * 1000 }
        : {}),
      ...(body.manufacturer !== undefined
        ? { manufacturer: body.manufacturer?.trim() || null }
        : {}),
    };

    // Overrides manuais de OID por ponto (métricas de saúde + uptime).
    if (body.healthOids) {
      const points = await this.prisma.devicePoint.findMany({
        where: { deviceId: id },
      });
      for (const metric of DIAG_METRICS) {
        const manual = body.healthOids[metric]?.trim();
        if (!manual) continue;
        const meta = (AC_HEALTH_METRIC_META as Record<string, { tag: string; objectName: string }>)[metric];
        const point = points.find((p) => {
          const b = (p.binding ?? {}) as { metric?: string };
          // Fallback por tag canônica: mesmo alias legado do apply-snmp-oids
          // (ex.: 'memory' vs 'memory_available') — evita que o override
          // manual não encontre o ponto já cadastrado sob o alias antigo.
          return b.metric === metric || (Boolean(meta) && p.tag === meta.tag);
        });
        if (!point) continue;
        const b = (point.binding ?? {}) as Record<string, unknown>;
        if (b.oid !== manual) {
          await this.prisma.devicePoint.update({
            where: { id: point.id },
            data: {
              binding: { ...b, metric, oid: manual, scale: 1, unsupported: false },
            },
          });
        }
      }
    }

    // Perfil de monitoramento manual.
    if (body.profileId !== undefined) {
      const rawProfileId = body.profileId;
      const newProfileId =
        rawProfileId === null || rawProfileId === GENERIC_AC_PROFILE.id
          ? null
          : rawProfileId;
      if (newProfileId !== null) {
        const known = ACCESS_CONTROLLER_OID_PROFILES.find((p) => p.id === newProfileId);
        if (!known) {
          throw new BadRequestException(
            `ID de perfil desconhecido: "${newProfileId}". ` +
              `Perfis válidos: ${ACCESS_CONTROLLER_OID_PROFILES.map((p) => p.id).join(', ')}.`,
          );
        }
      }
      newConfig = {
        ...newConfig,
        profileId: newProfileId,
        profileSource: newProfileId ? 'manual' : 'generic',
      };
    }
    if (body.profileOverrides !== undefined) {
      const overrides = body.profileOverrides;
      if (!overrides || Object.keys(overrides).length === 0) {
        const { profileOverrides: _po, ...rest } = newConfig;
        newConfig = rest;
      } else {
        newConfig = { ...newConfig, profileOverrides: overrides };
      }
    }

    await this.prisma.device.update({
      where: { id },
      data: {
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        ...(body.ip?.trim() ? { ip: body.ip.trim() } : {}),
        ...(body.port != null ? { port: Number(body.port) } : {}),
        ...(body.siteId !== undefined ? { siteId: body.siteId || null } : {}),
        config: newConfig as Prisma.InputJsonValue,
        ...(body.snmpMibId !== undefined
          ? { snmpMibId: body.snmpMibId || null }
          : {}),
      },
    });

    await this.configPublisher.publishForDevice(id);
    this.logger.log(`Controladora SCA atualizada: ${id} por ${user.email}`);

    const updated = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true, snmpCredential: true, snmpMib: true },
    });
    return this.mapController(updated, await this.deviceStatus.resolveLastSeen(updated.id));
  }

  /** DELETE /sca/controllers/:id — exclusão sensível (confirmação de senha). */
  @Delete('controllers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, SensitiveActionGuard)
  async deleteController(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Apenas ADMIN ou CCO podem excluir controladoras');
    }
    const device = await this.findControllerOrThrow(id);

    await this.prisma.$transaction([
      this.prisma.devicePoint.deleteMany({ where: { deviceId: id } }),
      this.prisma.device.delete({ where: { id } }),
    ]);
    this.logger.log(`Controladora SCA excluída: ${id} por ${user.email}`);

    if (device.gatewayId) {
      await this.configPublisher.publishForGateway(device.tenantId, device.gatewayId);
    }
  }

  /**
   * DELETE /sca/controllers/:id/points/:pointId — remove um ponto SNMP
   * individual da controladora (para de coletar o OID e apaga alarmes/trends).
   *
   * Pontos essenciais (STATUS) são protegidos e não podem ser removidos.
   * Não requer confirmação de senha (análogo à remoção de porta de switch).
   */
  @Delete('controllers/:id/points/:pointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async deleteControllerPoint(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('pointId') pointId: string,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Apenas ADMIN ou CCO podem remover pontos de controladoras');
    }
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);

    const point = await this.prisma.devicePoint.findFirst({
      where: { id: pointId, deviceId: id },
    });
    if (!point) throw new NotFoundException('Ponto não encontrado nesta controladora');

    const b = (point.binding ?? {}) as { metric?: string };
    if (point.tag === 'STATUS' || b.metric === 'status') {
      throw new BadRequestException(
        'O ponto STATUS é essencial e não pode ser removido individualmente.',
      );
    }

    await this.prisma.devicePoint.delete({ where: { id: pointId } });
    this.logger.log(
      `Ponto SNMP "${point.tag}" (${pointId}) da controladora ${id} removido por ${user.email}`,
    );

    await this.configPublisher.publishForDevice(id);
  }

  /** POST /sca/test-snmp — testa o SNMP da controladora via gateway. */
  @Post('test-snmp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async testSnmp(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: {
      tenantId?: string;
      gatewayId?: string;
      ip?: string;
      port?: number;
      snmpVersion?: '1' | '2c' | '3';
      community?: string;
      /** Campos SNMPv3 (teste pré-cadastro — nada é persistido aqui). */
      securityName?: string;
      authProtocol?: string;
      authKey?: string;
      privProtocol?: string;
      privKey?: string;
      contextName?: string;
      manufacturer?: string | null;
      oids?: Partial<Record<AcHealthMetric, string>>;
    },
  ) {
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');
    if (!body.gatewayId?.trim()) throw new BadRequestException('gatewayId é obrigatório');
    await this.assertGatewayInTenant(body.gatewayId, tenantId);
    if (!this.isValidIp(body.ip)) {
      throw new BadRequestException('ip inválido (IPv4 esperado)');
    }

    // Resolve OIDs efetivos do perfil + overrides manuais. O mapa continua
    // sendo enviado por compatibilidade, mas o gateway novo também recebe os
    // metadados canônicos para não tratar ausência de leitura como sucesso.
    const profile = resolveAcOidProfile(body.manufacturer);
    const oids: Record<string, string> = {};
    const metricMeta: Record<string, {
      unit: string;
      scale: number;
      unsupported?: boolean;
    }> = {};
    for (const metric of AC_HEALTH_METRICS) {
      const manual = body.oids?.[metric]?.trim();
      // Older vendor profiles called the recoverable-memory metric `memory`.
      // Resolve that alias here, before building the gateway request, so a
      // valid vendor source cannot be hidden by the canonical key.
      const profileMetric =
        metric === 'memory_available' &&
        !Object.prototype.hasOwnProperty.call(profile.oids, metric) &&
        Object.prototype.hasOwnProperty.call(profile.oids, 'memory')
          ? 'memory'
          : metric;
      const hasProfileEntry = Object.prototype.hasOwnProperty.call(profile.oids, profileMetric);
      const base = hasProfileEntry
        ? profile.oids[profileMetric]
        : GENERIC_AC_PROFILE.oids[metric];
      const oid = manual || base?.oid;
      if (oid) oids[metric] = oid;
      metricMeta[metric] = {
        unit: base?.unit ?? GENERIC_AC_PROFILE.oids[metric]?.unit ?? '',
        scale: base?.scale ?? GENERIC_AC_PROFILE.oids[metric]?.scale ?? 1,
        ...(hasProfileEntry && !base?.oid ? { unsupported: true } : {}),
      };
    }

    // v3 no teste pré-cadastro: chaves em texto puro só trafegam backend →
    // gateway (nunca persistidas nem devolvidas).
    const isV3 = body.snmpVersion === '3';
    const v3 = isV3 ? sanitizeSnmpV3Body(body) : null;

    const result = await this.snmpHealthTest.test({
      tenantId,
      gatewayId: body.gatewayId,
      ip: (body.ip as string).trim(),
      port: body.port || DEFAULT_SNMP_PORT,
      snmpVersion: isV3 ? '3' : body.snmpVersion === '1' ? '1' : '2c',
      community: body.community?.trim() || 'public',
      ...(v3
        ? {
            v3: {
              securityName: v3.securityName,
              securityLevel: v3.securityLevel,
              authProtocol: v3.authProtocol ?? undefined,
              authKey: body.authKey || undefined,
              privProtocol: v3.privProtocol ?? undefined,
              privKey: body.privKey || undefined,
              contextName: v3.contextName ?? undefined,
            },
          }
        : {}),
      oids,
      canonical: true,
      manufacturer: body.manufacturer?.trim() || null,
      deviceType: 'ACCESS_CONTROLLER',
      metricMeta,
    });

    return result.success ? { ...result, oids } : result;
  }

  /**
   * GET /sca/controllers/:id/capabilities — mapa de capacidades da controladora.
   */
  @Get('controllers/:id/capabilities')
  @UseGuards(JwtAuthGuard)
  async getCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);
    return this.capabilityProbe.getCapabilities(id);
  }

  /**
   * POST /sca/controllers/:id/probe-capabilities — probe de capacidades
   * via gateway (identifica fabricante, testa métricas, persiste resultado).
   */
  @Post('controllers/:id/probe-capabilities')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async probeCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);

    if (!device.gatewayId) {
      throw new BadRequestException('Controladora sem gateway associado');
    }
    if (this.deviceStatus.getStatus(device.gatewayId) === 'offline') {
      throw new BadRequestException(
        'Gateway offline — o probe precisa do gateway para falar com a controladora.',
      );
    }

    const result = await this.capabilityProbe.probeDevice(id);
    if (!result.success) {
      return { success: false as const, error: result.error };
    }

    this.logger.log(
      `Probe de capacidades da controladora ${id} por ${user.email}: ` +
        `perfil=${result.detectedProfileId}, reachable=${result.reachable}`,
    );

    return {
      success: true as const,
      reachable: result.reachable,
      cause: result.cause,
      sysDescr: result.sysDescr,
      detectedProfileId: result.detectedProfileId,
      detectedProfileLabel: result.detectedProfileLabel,
      capabilities: result.capabilities,
    };
  }

  /**
   * POST /sca/controllers/:id/diagnose-snmp — dispara o diagnóstico do canal
   * SNMP da controladora via gateway (testa cada OID cadastrado e os
   * candidatos de TODOS os perfis de fabricante, e faz um walk resumido) e
   * responde de imediato confirmando o início — o proxy de produção corta
   * requests >30s e o gateway pode levar até ~2min. A execução completa roda
   * em segundo plano; o resultado final é consultado via
   * GET /sca/diagnose/:diagnoseId/progress (polling).
   */
  @Post('controllers/:id/diagnose-snmp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async diagnoseSnmp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { diagnoseId?: string },
  ) {
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);

    if (!device.gatewayId) {
      throw new BadRequestException('Controladora sem gateway associado');
    }
    if (this.deviceStatus.getStatus(device.gatewayId) === 'offline') {
      throw new BadRequestException(
        'Gateway offline — o diagnóstico precisa do gateway para falar com a controladora. ' +
          'Verifique se o gateway está ligado e conectado.',
      );
    }

    const cfg = (device.config ?? {}) as {
      snmpVersion?: '1' | '2c';
      community?: string;
      manufacturer?: string;
    };

    const port = device.port ?? DEFAULT_SNMP_PORT;
    // Credenciais efetivas: tabela snmp_credential > Device.config (retrocompat).
    const credential = await this.prisma.snmpCredential.findUnique({
      where: { deviceId: id },
    });
    const creds = resolveSnmpRuntimeCredentials(credential, cfg);

    const points = await this.prisma.devicePoint.findMany({
      where: { deviceId: id },
    });
    const current: DiagnoseOidProbe[] = [];
    const currentByMetric: Record<string, { oid: string; pointId: string; scale: number }> = {};
    for (const p of points) {
      const b = (p.binding ?? {}) as { metric?: string; oid?: string | null; scale?: number };
      const metricKey = b.metric ? normalizeMetricKey(b.metric) : '';
      if (
        metricKey &&
        b.oid &&
        DIAG_METRICS.some((metric) => normalizeMetricKey(metric) === metricKey)
      ) {
        current.push({ metric: metricKey as DiagMetric, oid: b.oid });
        currentByMetric[metricKey] = {
          oid: b.oid,
          pointId: p.id,
          scale: typeof b.scale === 'number' ? b.scale : 1,
        };
      }
    }

    const isControlId = /control[\s-]*id|controlid|idflex/i.test(cfg.manufacturer ?? '');
    // The validated iDFlex firmware has no temperature sensor. Keep the
    // generic temperature candidates for other manufacturers/models.
    const catalog = buildAcDiagnoseCatalog().filter(
      (candidate) => !(isControlId && candidate.metric === 'temperature'),
    );
    const candidates: DiagnoseOidProbe[] = catalog.map((c) => ({
      metric: c.metric,
      oid: c.oid,
    }));

    const diagnoseId = body?.diagnoseId?.trim() || randomUUID();
    await this.snmpDiagnose.createJob({
      diagnoseId,
      tenantId: device.tenantId,
      deviceId: id,
    });

    // Dispara em segundo plano — nunca aguardado pelo POST. Qualquer erro
    // não capturado dentro do runner é tratado aqui para o job NUNCA ficar
    // "pending" para sempre.
    void this.runControllerSnmpDiagnoseJob({
      diagnoseId,
      device,
      port,
      snmpVersion: creds.snmpVersion,
      community: creds.community,
      v3: creds.v3,
      current,
      currentByMetric,
      candidates,
      catalog,
      points,
      cfg,
    }).catch((err) => {
      this.logger.error(
        `Diagnóstico SNMP ${diagnoseId} (controladora ${id}) falhou de forma inesperada: ${(err as Error).message}`,
      );
      void this.snmpDiagnose.completeJobError(
        diagnoseId,
        'Falha inesperada ao processar o diagnóstico. Tente novamente.',
      );
    });

    return { success: true as const, started: true as const, diagnoseId };
  }

  /**
   * Executa o diagnóstico SNMP da controladora (chamada ao gateway + todo o
   * enriquecimento — proposals, discovery, bindings) em segundo plano e
   * persiste o resultado final no job (Postgres) para o polling do frontend.
   */
  private async runControllerSnmpDiagnoseJob(params: {
    diagnoseId: string;
    device: Awaited<ReturnType<ScaController['findControllerOrThrow']>>;
    port: number;
    snmpVersion: '1' | '2c' | '3';
    community: string;
    v3: ReturnType<typeof resolveSnmpRuntimeCredentials>['v3'];
    current: DiagnoseOidProbe[];
    currentByMetric: Record<string, { oid: string; pointId: string; scale: number }>;
    candidates: DiagnoseOidProbe[];
    catalog: ReturnType<typeof buildAcDiagnoseCatalog>;
    points: Array<{ id: string; binding: Prisma.JsonValue }>;
    cfg: { manufacturer?: string };
  }): Promise<void> {
    const {
      diagnoseId,
      device,
      port,
      snmpVersion,
      community,
      v3,
      current,
      currentByMetric,
      candidates,
      catalog,
      points,
      cfg,
    } = params;
    const id = device.id;

    const result = await this.snmpDiagnose.diagnose({
      tenantId: device.tenantId,
      gatewayId: device.gatewayId as string,
      ip: device.ip as string,
      port,
      snmpVersion,
      community,
      v3,
      current,
      candidates,
      diagnoseId,
      // Dicas de identificação: perfis do gateway aportam raízes de walk
      // proprietárias (ex.: Control iD → 1.3.6.1.4.1.49617.1).
      deviceType: 'ACCESS_CONTROLLER',
      manufacturer: cfg.manufacturer?.trim() || undefined,
    });

    if (!result.success) {
      await this.snmpDiagnose.completeJobError(diagnoseId, result.error);
      return;
    }

    const knownOids = new Set(catalog.map((c) => c.oid));
    const fullCatalog = [
      ...catalog,
      ...buildDynamicPacketLossCandidates(result.walk, knownOids, result.oidResults),
    ];

    // Descoberta separada da interpretação: TODOS os objetos do walk viram
    // candidatos — classificados quando a semântica é conhecida, "OID
    // desconhecido" (selecionável) quando não. Nada é descartado.
    const discovered = buildDiscoveredObjects(result.walk);

    // Enriquece OIDs "desconhecidos" com nomes das MIBs importadas pelo admin.
    await this.snmpMib.enrichDiscovered(
      discovered,
      device.snmpMibId,
      cfg.manufacturer,
    );

    // Informações estáticas (firmware, serial, data/hora, NTP…) capturadas do
    // walk — telemetria numérica não transporta strings; ficam no config e
    // alimentam a seção de informações do card.
    if (result.reachable) {
      const infoEntries = extractSnmpInfoEntries(discovered, new Date());
      // Veredito de plausibilidade por OID persiste junto: o apply consulta
      // esta lista para NUNCA aplicar semântica/canônico a um OID reprovado
      // (proteção contra deslocamento de árvore entre firmwares).
      const unconfirmedOids = discovered
        .filter((d) => d.known?.confirmed === false)
        .map((d) => d.oid);
      const currentCfg = (device.config ?? {}) as Record<string, unknown>;
      await this.prisma.device.update({
        where: { id },
        data: {
          config: {
            ...currentCfg,
            snmpInfo: infoEntries,
            snmpUnconfirmedOids: unconfirmedOids,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    const metrics = DIAG_METRICS.map((metric) => {
      const cur = currentByMetric[normalizeMetricKey(metric)] ?? null;
      const curRead = cur ? (result.oidResults[cur.oid] ?? null) : null;
      const metricCandidates = fullCatalog
        .filter((c) => c.metric === metric)
        .map((c) => {
          const read = result.oidResults[c.oid] ?? null;
          return {
            oid: c.oid,
            profileLabel: c.profileLabel,
            scale: c.scale,
            unit: c.unit,
            responded: Boolean(read?.responded),
            // Valor já na unidade declarada (scale aplicada UMA vez aqui —
            // Bug 1: sysUpTime em ticks era exibido como segundos).
            value: read?.value != null ? read.value * c.scale : null,
            raw: read?.raw ?? null,
            isCurrent: cur?.oid === c.oid,
          };
        });
      const supported =
        Boolean(curRead?.responded) || metricCandidates.some((c) => c.responded);
      return {
        metric,
        label: DIAG_METRIC_LABELS[metric],
        pointId: cur?.pointId ?? null,
        currentOid: cur?.oid ?? null,
        currentResponded: Boolean(curRead?.responded),
        // Idem: scale do binding do ponto atual aplicada uma única vez.
        currentValue: curRead?.value != null ? curRead.value * (cur?.scale ?? 1) : null,
        currentRaw: curRead?.raw ?? null,
        supported,
        candidates: metricCandidates,
      };
    });

    // Persiste nos pontos atuais a marca "não suportado pela controladora".
    if (result.reachable) {
      for (const metric of DIAG_METRICS) {
        const cur = currentByMetric[normalizeMetricKey(metric)];
        if (!cur) continue;
        const read = result.oidResults[cur.oid] ?? null;
        const unsupported = !read?.responded;
        const point = points.find((p) => p.id === cur.pointId);
        if (!point) continue;
        const b = (point.binding ?? {}) as Record<string, unknown>;
        const healthState = unsupported ? 'broken' : 'active';
        if (Boolean(b.unsupported) !== unsupported || b.healthState !== healthState) {
          await this.prisma.devicePoint.update({
            where: { id: point.id },
            data: {
              binding: {
                ...b,
                unsupported,
                healthState,
                healthReason: unsupported ? 'missing' : null,
              },
            },
          });
        }
      }
    }

    // Persiste o run de descoberta (snapshot + diff vs anterior + detecção de
    // bindings quebrados). Falha aqui nunca derruba o diagnóstico em si.
    let discovery: Awaited<ReturnType<SnmpDiscoveryPersistenceService['recordRun']>> | null = null;
    try {
      discovery = await this.snmpDiscovery.recordRun({
        tenantId: device.tenantId,
        deviceId: id,
        trigger: 'manual',
        result,
      });
    } catch (err) {
      this.logger.warn(
        `Persistência da descoberta da controladora ${id} falhou: ${(err as Error).message}`,
      );
    }

    // Persiste bindings auto-resolvidos e gera propostas metric-first.
    let proposals: import('../application/snmp-metric.service.js').MetricProposal[] = [];
    if (result.reachable) {
      try {
        const firmwareFamily = extractFirmwareFamily({
          walk: result.walk,
          sysDescr: result.sysDescr,
        });

        const resolvedFromCanonical = Object.values(result.canonicalMetrics ?? {})
          .filter((cm) => cm.value !== null)
          .map((cm) => {
            const oid = cm.selectedOid ?? cm.memberOids?.[0] ?? cm.dependencyOids?.[0] ?? '';
            const memberLabels = Object.fromEntries(
              (cm.detail ?? [])
                .map((detail) => {
                  const detailIndex = typeof detail.index === 'number' ? String(detail.index) : null;
                  const detailOid =
                    typeof detail.oid === 'string'
                      ? detail.oid
                      : detailIndex
                        ? (cm.dependencyOids ?? []).find(
                            (candidate) =>
                              candidate.startsWith('1.3.6.1.2.1.25.2.3.1.6.') &&
                              candidate.endsWith(`.${detailIndex}`),
                          ) ?? null
                        : null;
                  const label =
                    typeof detail.descr === 'string'
                      ? detail.descr
                      : typeof detail.index === 'number'
                        ? `Índice ${detail.index}`
                        : null;
                  return detailOid && label ? [detailOid, label] : null;
                })
                .filter((entry): entry is [string, string] => entry !== null),
            );
            return {
              metricKey: cm.canonicalKey,
              oid,
              scale: 1,
              unit: cm.unit,
              memberOids: [...new Set([...(cm.memberOids ?? []), ...(cm.dependencyOids ?? [])])],
              memberLabels,
              confidence: cm.confidence,
            };
          })
          .filter((cm) => cm.oid);
        const resolvedFromLegacy = metrics
          .filter((m) => m.currentOid && m.currentResponded)
          .map((m) => ({
            metricKey: m.metric as string,
            oid: m.currentOid as string,
            scale: currentByMetric[normalizeMetricKey(m.metric)]?.scale ?? 1,
            unit: fullCatalog.find((c) => c.oid === m.currentOid)?.unit ?? '',
            memberOids: [] as string[],
            memberLabels: {} as Record<string, string>,
            confidence: 'exact' as const,
          }));

        const allResolved = [...resolvedFromCanonical];
        const canonicalKeys = new Set(resolvedFromCanonical.map((r) => normalizeMetricKey(r.metricKey)));
        for (const r of resolvedFromLegacy) {
          if (!canonicalKeys.has(normalizeMetricKey(r.metricKey))) {
            allResolved.push(r);
          }
        }

        await this.snmpMetric.persistAutoResolvedBindings({
          tenantId: device.tenantId,
          deviceId: id,
          sysObjectId: result.sysObjectId,
          firmwareFamily,
          resolved: allResolved,
        });

        if (result.sysObjectId) {
          await this.snmpMetric.inheritBindingsFromSameModel({
            tenantId: device.tenantId,
            deviceId: id,
            sysObjectId: result.sysObjectId,
            firmwareFamily,
          });
        }

        const existingBindings = await this.snmpMetric.getBindingsForProposals(id);
        const currentOidsByMetric: Record<string, string> = {};
        for (const m of metrics) {
          if (m.currentOid) currentOidsByMetric[normalizeMetricKey(m.metric)] = m.currentOid;
        }

        proposals = this.snmpMetric.buildProposals({
          tenantId: device.tenantId,
          deviceId: id,
          sysObjectId: result.sysObjectId,
          diagnoseResult: { ...result, canonicalMetrics: result.canonicalMetrics },
          catalogCandidates: fullCatalog,
          discovered,
          existingBindings,
          currentOidsByMetric,
        });
      } catch (err) {
        this.logger.warn(
          `Persistência de bindings/propostas da controladora ${id} falhou (não bloqueante): ${(err as Error).message}`,
        );
      }
    }

    await this.snmpDiagnose.completeJobSuccess(diagnoseId, {
      success: true as const,
      reachable: result.reachable,
      cause: result.reachable ? null : (result.cause ?? 'no_response'),
      sysDescr: result.sysDescr,
      sysObjectId: result.sysObjectId,
      durationMs: result.durationMs,
      metrics,
      /** Campo para frontend — shape: MetricProposal[] */
      proposals,
      /** @deprecated use proposals */
      metricProposals: proposals,
      walk: result.walk,
      walkStats: result.walkStats,
      discovered,
      discovery,
    });
  }

  /**
   * GET /sca/controllers/:id/discovery-runs — histórico de runs de descoberta
   * (snapshot walk + diff + bindings quebrados). Últimos 10 runs.
   */
  @Get('controllers/:id/discovery-runs')
  @UseGuards(JwtAuthGuard)
  async listDiscoveryRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);
    return this.snmpDiscovery.listRuns(device.tenantId, id);
  }

  /**
   * Descoberta automática (pós-cadastro): walk completo persistido como run.
   * Gated por canRunAutoDiscovery (máx. 1×/dia por device) e gateway online.
   * Nunca bloqueia o fluxo de cadastro — chamada fire-and-forget.
   */
  private async runAutoDiscovery(
    deviceId: string,
    trigger: 'registration' | 'scheduled',
  ): Promise<Awaited<ReturnType<SnmpDiagnoseService['diagnose']>> | null> {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device?.gatewayId) return null;
    if (this.deviceStatus.getStatus(device.gatewayId) === 'offline') return null;
    if (!(await this.snmpDiscovery.canRunAutoDiscovery(deviceId))) return null;

    const cfg = (device.config ?? {}) as {
      snmpVersion?: string;
      community?: string;
      manufacturer?: string | null;
    };
    const credential = await this.prisma.snmpCredential.findUnique({
      where: { deviceId },
    });
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
    if (!result.success) return null;

    // O cadastro não espera o operador abrir o diagnóstico: valores canônicos
    // confirmados pelo teste passam a governar a coleta, mas somente quando
    // ainda não existe uma fonte ativa/manual para a métrica.
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
      trigger,
      result,
    });
    this.logger.log(
      `Descoberta ${trigger} persistida para o device ${deviceId} ` +
        `(${(result.walk ?? []).reduce((n, s) => n + s.entries.length, 0)} OIDs)`,
    );
    return result;
  }

  /**
   * POST /sca/controllers/:id/test-oid — lê o valor ATUAL de um OID via
   * gateway (teste ao vivo na descoberta, antes de aplicar). Retorna tipo
   * ASN.1, valor bruto e normalizado (com a escala da semântica, quando há).
   */
  @Post('controllers/:id/test-oid')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async testOid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { oid?: string },
  ) {
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);
    return runLiveOidTest(this.snmpHealthTest, this.deviceStatus, device, body?.oid);
  }

  /**
   * GET /sca/diagnose/:diagnoseId/progress — status do job de diagnóstico
   * (polling): progresso parcial enquanto roda, ou o resultado final
   * (sucesso/erro) assim que termina. Job é durável (Postgres) — funciona
   * mesmo que o POST e o GET caiam em instâncias diferentes do backend.
   */
  @Get('diagnose/:diagnoseId/progress')
  @UseGuards(JwtAuthGuard)
  getDiagnoseProgress(
    @Param('diagnoseId') diagnoseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SnmpDiagnoseJobStatus> {
    const scope = resolveTenantScope(user);
    return this.snmpDiagnose.getJobStatus(diagnoseId, scope);
  }

  /**
   * POST /sca/controllers/:id/apply-snmp-oids — aplica as sugestões do
   * diagnóstico: atualiza o binding dos pontos (IDs preservados — trends e
   * alarmes sobrevivem) e republica a config no gateway.
   */
  @Post('controllers/:id/apply-snmp-oids')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async applySnmpOids(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body()
    body: {
      oids?: Partial<Record<string, string | (SnmpOidSelection & { seedValue?: number | null })>>;
      /** Objetos descobertos no walk selecionados como pontos (OIDs livres). */
      customPoints?: Array<{ oid?: string; name?: string; unit?: string }>;
      /**
       * Confiança marcada pelo cliente.
       * 'manual' = operador escolheu explicitamente.
       * 'exact' = confirmação automática de proposta sugerida.
       */
      metricConfidence?: Partial<Record<string, 'exact' | 'inferred' | 'manual'>>;
    },
  ) {
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);

    // Aceita métricas legacy e canônicas.
    const entries = Object.entries(body?.oids ?? {}).flatMap(([metric, raw]) => {
        const isLegacy = DIAG_METRICS.includes(metric as DiagMetric);
        const isCanonical = CANONICAL_METRIC_KEYS.has(metric) && !METRICS_WITHOUT_OID.has(metric);
        const selection = normalizeSnmpOidSelection(raw);
        return isLegacy || isCanonical ? (selection ? [[metric, selection] as const] : []) : [];
      });
    const customPoints = sanitizeCustomPoints(body?.customPoints);
    if (entries.length === 0 && customPoints.length === 0) {
      throw new BadRequestException('Nenhum OID para aplicar');
    }

    const catalog = buildAcDiagnoseCatalog();
    const points = await this.prisma.devicePoint.findMany({
      where: { deviceId: id },
    });
    const storageVolumes =
      (await this.snmpMetric?.getStorageVolumeBindings(id)) ?? [];

    // OIDs reprovados na validação de plausibilidade do último diagnóstico
    // NUNCA podem virar métrica canônica — nem via payload direto/forjado.
    const unconfirmedOids = new Set(
      Array.isArray((device.config as Record<string, unknown> | null)?.snmpUnconfirmedOids)
        ? ((device.config as Record<string, unknown>).snmpUnconfirmedOids as string[]).filter(
            (o): o is string => typeof o === 'string',
          )
        : [],
    );

    const deviceConfig = (device.config ?? {}) as { manufacturer?: string | null };
    const isControlId = /control[\s-]*id|controlid|idflex/i.test(deviceConfig.manufacturer ?? '');
    let cpuBindingTouched = false;
    for (const [metric, selection] of entries) {
      const oid = selection.oid;
      if (unconfirmedOids.has(oid)) {
        this.logger.warn(
          `OID ${oid} reprovado na plausibilidade — recusado como métrica '${metric}' na controladora ${id}`,
        );
        continue;
      }
      const normalizedMetric = normalizeMetricKey(metric);
      if (isControlId && normalizedMetric === 'temperature') {
        // Do not let an old client or a stale catalog reintroduce the
        // unsupported iDFlex temperature point.
        continue;
      }
      if (normalizedMetric === 'storage_used_percent' && storageVolumes.length > 0) {
        for (const volume of storageVolumes) {
          const tag = `STORAGE_${volume.index.replace(/[^A-Za-z0-9]/g, '_')}`;
          const existingVolume = points.find((candidate) => candidate.tag === tag);
          const volumeBinding = {
            metric: normalizedMetric,
            oid: volume.oid,
            scale: 1,
            memberOids: volume.memberOids,
            unsupported: false,
          };
          if (existingVolume) {
            await this.prisma.devicePoint.update({
              where: { id: existingVolume.id },
              data: {
                objectName: volume.label,
                unit: '%',
                binding: volumeBinding,
              },
            });
            (existingVolume as { binding: unknown }).binding = volumeBinding;
          } else {
            const nextInstance = points.reduce((max, candidate) => Math.max(max, candidate.instance), -1) + 1;
            const created = await this.prisma.devicePoint.create({
              data: {
                deviceId: id,
                tag,
                objectName: volume.label,
                objectType: 'snmp',
                instance: nextInstance,
                unit: '%',
                binding: volumeBinding,
              },
            });
            points.push(created);
          }
        }
        continue;
      }
      // Metadados canônicos da métrica (tag/nome padrão) — resolvidos ANTES do
      // matching para servirem também de fallback de identidade (ver abaixo).
      const meta = (AC_HEALTH_METRIC_META as Record<string, { tag: string; objectName: string }>)[metric]
        ?? (AC_HEALTH_METRIC_META as Record<string, { tag: string; objectName: string }>)[normalizedMetric];
      const point = points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string };
        if (
          b.metric === metric ||
          b.metric === normalizedMetric ||
          (typeof b.metric === 'string' && normalizeMetricKey(b.metric) === normalizedMetric)
        ) {
          return true;
        }
        // Fallback por tag canônica: mesma métrica pode ter sido persistida
        // sob um alias legado (ex.: 'memory' vs 'memory_available' — ambos
        // mapeiam para a tag MEMORIA em AC_HEALTH_METRIC_META). Sem este
        // fallback, um binding com alias divergente do já cadastrado criava
        // um SEGUNDO DevicePoint com a mesma tag em vez de atualizar o
        // existente — a origem dos pontos de memória duplicados na controladora.
        return Boolean(meta) && p.tag === meta.tag;
      });
      const known = catalog.find((c) => (c.metric === metric || c.metric === normalizedMetric) && c.oid === oid);
      // Catalog metadata is authoritative for known OIDs. Never reuse a
      // stale scale supplied by an old client/binding (notably milli-°C).
      const scale = known?.scale ?? selection.scale ?? 1;
      const unit = known?.unit ?? selection.unit ?? '';
      const seedValue =
        typeof selection.seedValue === 'number' && Number.isFinite(selection.seedValue)
          ? selection.seedValue
          : null;
      if (!point) {
        if (metric === 'uptime') continue;
        const createMeta = meta ?? { tag: metric.toUpperCase().replace(/_/g, ''), objectName: metric };
        const nextInstance = points.reduce((m, p) => Math.max(m, p.instance), -1) + 1;
        const created = await this.prisma.devicePoint.create({
          data: {
            deviceId: id,
            tag: createMeta.tag,
            objectName: createMeta.objectName,
            objectType: 'snmp',
            instance: nextInstance,
            unit,
            binding: {
              metric: normalizedMetric,
              oid,
              scale,
              unsupported: false,
              healthState: 'pending',
              healthReason: 'awaiting_read',
            },
            ...(seedValue !== null
              ? { lastValue: seedValue, lastValueAt: new Date(), lastValueState: null }
              : { lastValue: null, lastValueAt: null, lastValueState: 'waiting_event' }),
          },
        });
        points.push(created);
        continue;
      }
      const b = (point.binding ?? {}) as Record<string, unknown>;
      const nextBinding = {
        ...b,
        metric: normalizedMetric,
        oid,
          scale,
        unsupported: false,
        healthState: 'pending',
        healthReason: 'awaiting_read',
      };
      await this.prisma.devicePoint.update({
        where: { id: point.id },
        data: {
          binding: nextBinding,
          unit,
          ...(seedValue !== null
            ? { lastValue: seedValue, lastValueAt: new Date(), lastValueState: null }
            : { lastValue: null, lastValueAt: null, lastValueState: 'waiting_event' }),
        },
      });
      (point as { binding: unknown }).binding = nextBinding;
    }

    // Objetos descobertos no walk selecionados como pontos de monitoramento.
    await applyCustomDiscoveredPoints(this.prisma, id, points, customPoints, unconfirmedOids);

    // Persiste bindings com confidência correta.
    for (const [metric, selection] of entries) {
      const oid = selection.oid;
      if (unconfirmedOids.has(oid)) continue;
      const normalizedMetric = normalizeMetricKey(metric);
      const known = catalog.find((c) => (c.metric === metric || c.metric === normalizedMetric) && c.oid === oid);
      const scale = selection.scale ?? known?.scale ?? 1;
      const unit = selection.unit ?? known?.unit ?? '';
      try {
        await this.snmpMetric.persistBinding({
          tenantId: device.tenantId,
          deviceId: id,
          metricKey: normalizedMetric,
          oid,
          scale,
          unit,
          confidence: body?.metricConfidence?.[metric] ?? body?.metricConfidence?.[normalizedMetric],
        });
        if (normalizedMetric === 'cpu_usage') cpuBindingTouched = true;
      } catch (err) {
        this.logger.warn(
          `Falha ao persistir binding metric=${metric} oid=${oid} na controladora ${id}: ${(err as Error).message}`,
        );
      }
    }

    if (cpuBindingTouched) {
      await this.snmpMetric.syncCpuPeakPoint(id);
    }

    await this.configPublisher.publishForDevice(id);
    this.logger.log(
      `OIDs SNMP aplicados via diagnóstico na controladora ${id} por ${user.email}: ` +
        [
          ...entries.map(([m, o]) => `${m}=${o.oid}`),
          ...customPoints.map((c) => `custom=${c.oid}`),
        ].join(', '),
    );

    const updated = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true, snmpCredential: true, snmpMib: true },
    });
    return this.mapController(updated, await this.deviceStatus.resolveLastSeen(updated.id));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async findControllerOrThrow(id: string) {
    const device = await this.prisma.device.findFirst({
      where: { id, ...ONLY_ACCESS_CONTROLLER_DEVICES },
      include: { points: true, site: true, snmpCredential: true, snmpMib: true },
    });
    if (!device) throw new NotFoundException('Controladora não encontrada');
    return device;
  }

  private assertCanEdit(user: AuthenticatedUser, tenantId: string): void {
    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO';
    if (!isGlobal && tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para editar esta controladora');
    }
  }

  private async assertGatewayInTenant(gatewayId: string, tenantId: string): Promise<void> {
    const gw = await this.prisma.gateway.findFirst({
      where: { id: gatewayId, tenantId },
      select: { id: true },
    });
    if (!gw) {
      throw new BadRequestException('Gateway não pertence ao cliente informado');
    }
  }

  private isValidIp(ip?: string): boolean {
    if (!ip) return false;
    const parts = ip.trim().split('.');
    return (
      parts.length === 4 &&
      parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
    );
  }

  /** Mapeia a controladora para o shape esperado pelo frontend. */
  private mapController(device: ControllerWithRelations, lastCommunication: string | null) {
    const cfg = (device.config ?? {}) as {
      snmpVersion?: string;
      community?: string;
      pollingIntervalMs?: number;
      manufacturer?: string | null;
      profileId?: string | null;
      profileSource?: 'detected' | 'manual' | 'generic';
      profileOverrides?: Record<string, string> | null;
      snmpInfo?: SnmpInfoEntry[];
    };

    const gatewayOnline: boolean | null = device.gatewayId
      ? this.deviceStatus.getStatus(device.gatewayId) === 'online'
      : null;

    return {
      id: device.id,
      name: device.name,
      protocol: device.protocol,
      site: device.site?.name ?? '',
      siteId: device.siteId,
      tenantId: device.tenantId,
      gatewayId: device.gatewayId,
      gatewayOnline,
      ip: device.ip,
      port: device.port,
      snmpVersion: device.snmpCredential?.version ?? cfg.snmpVersion ?? '2c',
      community: device.snmpCredential?.community ?? cfg.community ?? 'public',
      // Vista pública da credencial: NUNCA expõe chaves (só flags has*Key).
      snmpCredential: snmpCredentialPublicView(device.snmpCredential ?? null),
      pollingInterval: cfg.pollingIntervalMs
        ? cfg.pollingIntervalMs / 1000
        : DEFAULT_POLLING_S,
      manufacturer: cfg.manufacturer ?? null,
      status: this.deviceStatus.getStatus(device.id),
      critical: device.critical,
      lastCommunication,
      profileId: cfg.profileId ?? null,
      profileLabel: resolveAcProfileLabel(cfg.profileId),
      profileSource: cfg.profileSource ?? 'generic',
      profileOverrides: cfg.profileOverrides ?? null,
      snmpMibId: device.snmpMibId ?? null,
      snmpMib: device.snmpMib
        ? {
            id: device.snmpMib.id,
            label: device.snmpMib.label,
            manufacturer: device.snmpMib.manufacturer,
            isOffline: device.snmpMib.isOffline,
          }
        : null,
      // Informações estáticas do equipamento capturadas no diagnóstico.
      snmpInfo: Array.isArray(cfg.snmpInfo) ? cfg.snmpInfo : [],
      points: device.points.map((p) => {
        const b = (p.binding ?? {}) as {
          metric?: string;
          oid?: string | null;
          unsupported?: boolean;
          healthState?: 'active' | 'broken' | 'suggested' | 'pending';
          healthReason?: 'missing' | 'type_changed' | 'awaiting_read' | null;
        };
        const metric = b.metric ?? 'custom';
        const oid = b.oid ?? null;
        return {
          id: p.id,
          tag: p.tag,
          objectName: p.objectName,
          metric,
          oid,
          unsupported: Boolean(b.unsupported),
          healthState:
            b.healthState === 'pending' && p.lastValueAt && p.lastValueState === null
              ? 'active'
              : b.healthState,
          healthReason: b.healthReason ?? null,
          unit: p.unit ?? '',
          critical: p.critical,
          lastValue: p.lastValue ?? null,
          lastValueAt: p.lastValueAt ? p.lastValueAt.toISOString() : null,
          lastValueState: p.lastValueState ?? null,
          // Metadados de exibição do card dinâmico (derivados só de dados).
          display: buildSnmpCardDisplay({
            tag: p.tag,
            objectName: p.objectName,
            metric,
            oid,
            unit: p.unit ?? null,
          }),
          // Indica se o ponto pode ser removido individualmente pelo operador.
          // STATUS nunca é removível (derivado de alcançabilidade, sem OID).
          removable: p.tag !== 'STATUS' && metric !== 'status',
        };
      }),
    };
  }
}
