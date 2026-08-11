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
  type SnmpDiagnoseProgress,
} from '../application/snmp-diagnose.service.js';
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
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { resolveBodyTenantScope, resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_SNMP_PORT = 161;
const DEFAULT_POLLING_S = 30;

/**
 * Pontos padrão de saúde de uma controladora de acesso (SNMP MIB-II / UCD).
 * Mesmo padrão das câmeras SNMP: STATUS sem OID (derivado da alcançabilidade);
 * UPTIME via sysUpTime; demais via MIB-II genérica ou OID proprietário do perfil.
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
    oid: '1.3.6.1.2.1.25.3.3.1.2.1',
    scale: 1,
    unit: '%',
  },
  {
    tag: 'MEMORIA',
    objectName: 'Memória disponível',
    metric: 'memory',
    oid: '1.3.6.1.4.1.2021.4.6.0',
    scale: 1,
    unit: 'kB',
  },
  {
    tag: 'TEMPERATURA',
    objectName: 'Temperatura',
    metric: 'temperature',
    oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1',
    scale: 0.001,
    unit: '°C',
  },
  {
    tag: 'PACOTES_PERDIDOS',
    objectName: 'Pacotes perdidos (descartes if1)',
    metric: 'packet_loss',
    oid: '1.3.6.1.2.1.2.2.1.13.1',
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
  'memory',
  'ram_total',
  'temperature',
  'packet_loss',
];

/** Métricas cobertas pelo diagnóstico SNMP (saúde + uptime). */
type DiagMetric = AcHealthMetric | 'uptime';
const DIAG_METRICS: DiagMetric[] = [
  'cpu',
  'memory',
  'ram_total',
  'temperature',
  'packet_loss',
  'uptime',
];

const DIAG_METRIC_LABELS: Record<DiagMetric, string> = {
  cpu: 'Uso de CPU',
  memory: 'Memória disponível',
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
  snmpVersion?: '1' | '2c';
  community?: string;
  pollingInterval?: number;
  manufacturer?: string | null;
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
  include: { points: true; site: true };
}>;

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
      include: { points: true, site: true },
    });

    const lastSeenMap = await this.deviceStatus.resolveLastSeenMany(
      devices.map((d) => d.id),
    );
    return devices.map((d) => this.mapController(d, lastSeenMap.get(d.id) ?? null));
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
          snmpVersion: body.snmpVersion ?? '2c',
          community: body.community?.trim() || 'public',
          pollingIntervalMs: (body.pollingInterval ?? DEFAULT_POLLING_S) * 1000,
          manufacturer: body.manufacturer?.trim() || null,
        },
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
      include: { points: true, site: true },
    });

    await this.configPublisher.publishForDevice(device.id);
    this.logger.log(`Controladora SCA cadastrada: ${device.id} (${ip}) por ${user.email}`);
    return this.mapController(device, null);
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
        const point = points.find((p) => {
          const b = (p.binding ?? {}) as { metric?: string };
          return b.metric === metric;
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
      },
    });

    await this.configPublisher.publishForDevice(id);
    this.logger.log(`Controladora SCA atualizada: ${id} por ${user.email}`);

    const updated = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true },
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
      snmpVersion?: '1' | '2c';
      community?: string;
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

    // Resolve OIDs efetivos do perfil + overrides manuais.
    const profile = resolveAcOidProfile(body.manufacturer);
    const oids: Record<string, string> = {};
    for (const metric of AC_HEALTH_METRICS) {
      const manual = body.oids?.[metric]?.trim();
      const base = profile.oids[metric] ?? GENERIC_AC_PROFILE.oids[metric];
      const oid = manual || base?.oid;
      if (oid) oids[metric] = oid;
    }

    const result = await this.snmpHealthTest.test({
      tenantId,
      gatewayId: body.gatewayId,
      ip: (body.ip as string).trim(),
      port: body.port || DEFAULT_SNMP_PORT,
      snmpVersion: body.snmpVersion === '1' ? '1' : '2c',
      community: body.community?.trim() || 'public',
      oids,
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
   * POST /sca/controllers/:id/diagnose-snmp — diagnóstico do canal SNMP da
   * controladora via gateway: testa cada OID cadastrado e os candidatos de
   * TODOS os perfis de fabricante, e faz um walk resumido.
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
    };

    const port = device.port ?? DEFAULT_SNMP_PORT;
    const snmpVersion: '1' | '2c' = cfg.snmpVersion === '1' ? '1' : '2c';
    const community = cfg.community?.trim() || 'public';

    const points = await this.prisma.devicePoint.findMany({
      where: { deviceId: id },
    });
    const current: DiagnoseOidProbe[] = [];
    const currentByMetric: Record<string, { oid: string; pointId: string }> = {};
    for (const p of points) {
      const b = (p.binding ?? {}) as { metric?: string; oid?: string | null };
      if (b.metric && b.oid && DIAG_METRICS.includes(b.metric as DiagMetric)) {
        current.push({ metric: b.metric, oid: b.oid });
        currentByMetric[b.metric] = { oid: b.oid, pointId: p.id };
      }
    }

    const catalog = buildAcDiagnoseCatalog();
    const candidates: DiagnoseOidProbe[] = catalog.map((c) => ({
      metric: c.metric,
      oid: c.oid,
    }));

    const result = await this.snmpDiagnose.diagnose({
      tenantId: device.tenantId,
      gatewayId: device.gatewayId,
      ip: device.ip as string,
      port,
      snmpVersion,
      community,
      current,
      candidates,
      diagnoseId: body?.diagnoseId,
    });

    if (!result.success) {
      return { success: false as const, error: result.error };
    }

    const knownOids = new Set(catalog.map((c) => c.oid));
    const fullCatalog = [
      ...catalog,
      ...buildDynamicPacketLossCandidates(result.walk, knownOids, result.oidResults),
    ];

    const metrics = DIAG_METRICS.map((metric) => {
      const cur = currentByMetric[metric] ?? null;
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
            value: read?.value ?? null,
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
        currentValue: curRead?.value ?? null,
        currentRaw: curRead?.raw ?? null,
        supported,
        candidates: metricCandidates,
      };
    });

    // Persiste nos pontos atuais a marca "não suportado pela controladora".
    if (result.reachable) {
      for (const metric of DIAG_METRICS) {
        const cur = currentByMetric[metric];
        if (!cur) continue;
        const read = result.oidResults[cur.oid] ?? null;
        const unsupported = !read?.responded;
        const point = points.find((p) => p.id === cur.pointId);
        if (!point) continue;
        const b = (point.binding ?? {}) as Record<string, unknown>;
        if (Boolean(b.unsupported) !== unsupported) {
          await this.prisma.devicePoint.update({
            where: { id: point.id },
            data: { binding: { ...b, unsupported } },
          });
        }
      }
    }

    return {
      success: true as const,
      reachable: result.reachable,
      cause: result.reachable ? null : (result.cause ?? 'no_response'),
      sysDescr: result.sysDescr,
      sysObjectId: result.sysObjectId,
      durationMs: result.durationMs,
      metrics,
      walk: result.walk,
    };
  }

  /** GET /sca/diagnose/:diagnoseId/progress — progresso parcial (polling). */
  @Get('diagnose/:diagnoseId/progress')
  @UseGuards(JwtAuthGuard)
  getDiagnoseProgress(
    @Param('diagnoseId') diagnoseId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): SnmpDiagnoseProgress | { unknown: true } {
    const progress = this.snmpDiagnose.getProgress(diagnoseId);
    if (!progress) return { unknown: true };
    const scope = resolveTenantScope(user);
    if (scope && progress.tenantId !== scope) {
      return { unknown: true };
    }
    return progress;
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
    @Body() body: { oids?: Partial<Record<string, string>> },
  ) {
    const device = await this.findControllerOrThrow(id);
    this.assertCanEdit(user, device.tenantId);

    const entries = Object.entries(body?.oids ?? {}).filter(
      ([metric, oid]) =>
        DIAG_METRICS.includes(metric as DiagMetric) &&
        typeof oid === 'string' &&
        oid.trim(),
    ) as Array<[DiagMetric, string]>;
    if (entries.length === 0) {
      throw new BadRequestException('Nenhum OID para aplicar');
    }

    const catalog = buildAcDiagnoseCatalog();
    const points = await this.prisma.devicePoint.findMany({
      where: { deviceId: id },
    });

    for (const [metric, rawOid] of entries) {
      const oid = rawOid.trim();
      const point = points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string };
        return b.metric === metric;
      });
      const known = catalog.find((c) => c.metric === metric && c.oid === oid);
      if (!point) {
        if (metric === 'uptime') continue;
        const meta = AC_HEALTH_METRIC_META[metric as AcHealthMetric];
        if (!meta) continue;
        const nextInstance = points.reduce((m, p) => Math.max(m, p.instance), -1) + 1;
        const created = await this.prisma.devicePoint.create({
          data: {
            deviceId: id,
            tag: meta.tag,
            objectName: meta.objectName,
            objectType: 'snmp',
            instance: nextInstance,
            unit: known?.unit ?? '',
            binding: { metric, oid, scale: known?.scale ?? 1, unsupported: false },
          },
        });
        points.push(created);
        continue;
      }
      const b = (point.binding ?? {}) as Record<string, unknown>;
      await this.prisma.devicePoint.update({
        where: { id: point.id },
        data: {
          binding: { ...b, metric, oid, scale: known?.scale ?? 1, unsupported: false },
          ...(known?.unit !== undefined ? { unit: known.unit } : {}),
        },
      });
    }

    await this.configPublisher.publishForDevice(id);
    this.logger.log(
      `OIDs SNMP aplicados via diagnóstico na controladora ${id} por ${user.email}: ` +
        entries.map(([m, o]) => `${m}=${o}`).join(', '),
    );

    const updated = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true },
    });
    return this.mapController(updated, await this.deviceStatus.resolveLastSeen(updated.id));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async findControllerOrThrow(id: string) {
    const device = await this.prisma.device.findFirst({
      where: { id, ...ONLY_ACCESS_CONTROLLER_DEVICES },
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
      snmpVersion: cfg.snmpVersion ?? '2c',
      community: cfg.community ?? 'public',
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
      points: device.points.map((p) => {
        const b = (p.binding ?? {}) as {
          metric?: string;
          oid?: string | null;
          unsupported?: boolean;
        };
        return {
          id: p.id,
          tag: p.tag,
          objectName: p.objectName,
          metric: b.metric ?? 'custom',
          oid: b.oid ?? null,
          unsupported: Boolean(b.unsupported),
          unit: p.unit ?? '',
          critical: p.critical,
          lastValue: p.lastValue ?? null,
          lastValueAt: p.lastValueAt ? p.lastValueAt.toISOString() : null,
          lastValueState: p.lastValueState ?? null,
        };
      }),
    };
  }
}
