import {
  ForbiddenException,
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
  ONLY_CFTV_DEVICES,
  ONVIF_PROTOCOL,
  SNMP_PROTOCOL,
} from '../../prisma/device-filters.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DeviceConfigPublisherService } from '../application/device-config-publisher.service.js';
import {
  SnmpNetworkScanService,
  type SnmpScanProgress,
  type SnmpScanResult,
} from '../application/snmp-network-scan.service.js';
import { OnvifProbeService, type OnvifDeviceInfo } from '../application/onvif-probe.service.js';
import {
  OnvifNetworkScanService,
  type OnvifScanResult,
} from '../application/onvif-network-scan.service.js';
import {
  decryptCameraSecret,
  encryptCameraSecret,
} from '../application/camera-credentials.util.js';
import {
  CAMERA_OID_PROFILES,
  GENERIC_PROFILE,
  HEALTH_METRIC_META,
  resolveOidProfile,
  type HealthMetric,
  type HealthOidEntry,
} from '../application/camera-oid-profiles.js';
import {
  SnmpHealthTestService,
  type SnmpHealthTestResult,
} from '../application/snmp-health-test.service.js';
import {
  SnmpDiagnoseService,
  type DiagnoseOidProbe,
  type SnmpDiagnoseProgress,
} from '../application/snmp-diagnose.service.js';
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { resolveBodyTenantScope, resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

/** Porta SNMP padrão. */
const DEFAULT_SNMP_PORT = 161;

/** Porta padrão do serviço ONVIF (HTTP). */
const DEFAULT_ONVIF_PORT = 80;

/** Intervalo de polling SNMP padrão (s). */
const DEFAULT_POLLING_S = 30;

/**
 * Pontos padrão de saúde de uma câmera CFTV (SNMP MIB-II / UCD).
 * O ponto 'status' NÃO tem OID — o gateway o deriva da alcançabilidade
 * (respondeu = 1, sem resposta = 0). OIDs podem ser ajustados no binding
 * caso o fabricante use MIB própria.
 */
const DEFAULT_CAMERA_POINTS = [
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
    // sysUpTime (centésimos de segundo) → segundos via scale 0.01
    oid: '1.3.6.1.2.1.1.3.0',
    scale: 0.01,
    unit: 's',
  },
  {
    tag: 'MEMORIA_LIVRE',
    objectName: 'Memória livre',
    metric: 'memory',
    // UCD-SNMP memAvailReal (kB) — comum em firmwares Linux de câmeras
    oid: '1.3.6.1.4.1.2021.4.6.0',
    scale: 1,
    unit: 'kB',
  },
  {
    tag: 'PACOTES_PERDIDOS',
    objectName: 'Pacotes perdidos (descartes if1)',
    metric: 'packet_loss',
    // ifInDiscards da interface 1 (contador acumulado)
    oid: '1.3.6.1.2.1.2.2.1.13.1',
    scale: 1,
    unit: 'pkts',
  },
  {
    tag: 'CPU',
    objectName: 'Uso de CPU',
    metric: 'cpu',
    // hrProcessorLoad da 1ª CPU (HOST-RESOURCES-MIB) — % de uso
    oid: '1.3.6.1.2.1.25.3.3.1.2.1',
    scale: 1,
    unit: '%',
  },
  {
    tag: 'TEMPERATURA',
    objectName: 'Temperatura',
    metric: 'temperature',
    // UCD lm-sensors (mili-°C → °C). Câmera sem o OID responde erro no
    // varbind e o gateway publica null — a UI mostra "sem dados".
    oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1',
    scale: 0.001,
    unit: '°C',
  },
  {
    tag: 'PERDA_PING',
    objectName: 'Perda de pacotes (ping)',
    metric: 'ping_loss',
    // Sem OID — o gateway mede via ping ICMP (4 pacotes por ciclo).
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
];

/** Métricas do canal de saúde (ordem estável de criação dos pontos). */
const HEALTH_METRICS: HealthMetric[] = [
  'cpu',
  'memory',
  'ram_total',
  'storage',
  'temperature',
  'packet_loss',
];

/** Métricas cobertas pelo diagnóstico SNMP (saúde + uptime). */
type DiagMetric = HealthMetric | 'uptime';
const DIAG_METRICS: DiagMetric[] = [
  'cpu',
  'memory',
  'ram_total',
  'storage',
  'temperature',
  'packet_loss',
  'uptime',
];

/** Rótulos das métricas no resultado do diagnóstico. */
const DIAG_METRIC_LABELS: Record<DiagMetric, string> = {
  cpu: 'Uso de CPU',
  memory: 'Memória (uso de RAM)',
  ram_total: 'Memória RAM total',
  storage: 'Uso de armazenamento',
  temperature: 'Temperatura',
  packet_loss: 'Pacotes perdidos',
  uptime: 'Tempo ligada',
};

/** Candidato de OID do diagnóstico (com origem e scale/unit do perfil). */
interface DiagnoseCandidate {
  metric: DiagMetric;
  oid: string;
  profileLabel: string;
  scale: number;
  unit: string;
}

/**
 * Catálogo de OIDs candidatos do diagnóstico: união dos OIDs de TODOS os
 * perfis de fabricante (+ genérico) por métrica, deduplicado por metric+oid
 * (perfis que compartilham o OID aparecem juntos no rótulo), mais o sysUpTime
 * padrão para uptime.
 */
function buildDiagnoseCandidateCatalog(): DiagnoseCandidate[] {
  const byKey = new Map<string, DiagnoseCandidate>();
  for (const profile of CAMERA_OID_PROFILES) {
    for (const metric of HEALTH_METRICS) {
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
  // Uptime: sysUpTime padrão MIB-II (centésimos de segundo → s).
  byKey.set('uptime|1.3.6.1.2.1.1.3.0', {
    metric: 'uptime',
    oid: '1.3.6.1.2.1.1.3.0',
    profileLabel: 'MIB-II padrão',
    scale: 0.01,
    unit: 's',
  });
  return [...byKey.values()];
}

/** Prefixos MIB-II de contadores de perda por interface (coluna → rótulo). */
const IF_LOSS_COLUMNS: Array<{ prefix: string; label: string }> = [
  { prefix: '1.3.6.1.2.1.2.2.1.13.', label: 'ifInDiscards' },
  { prefix: '1.3.6.1.2.1.2.2.1.14.', label: 'ifInErrors' },
];

/**
 * Candidatos dinâmicos de "pacotes perdidos" descobertos no walk da subárvore
 * MIB-II interfaces: muitas câmeras não têm interface de índice 1, então o
 * candidato estático ifInDiscards.1 falha. O walk revela os ifIndex reais —
 * cada entrada de ifInDiscards/ifInErrors vira um candidato aplicável, e o
 * valor lido no walk alimenta oidResults (o walk é a prova de que responde).
 */
export function buildDynamicPacketLossCandidates(
  walk: Array<{ root: string; entries: Array<{ oid: string; value: string }> }>,
  knownOids: Set<string>,
  oidResults: Record<
    string,
    { oid: string; responded: boolean; value: number | null; raw: string | null }
  >,
): DiagnoseCandidate[] {
  const dynamic: DiagnoseCandidate[] = [];
  const ifSection = walk.find((s) => s.root === '1.3.6.1.2.1.2');
  if (!ifSection) return dynamic;
  for (const entry of ifSection.entries) {
    for (const col of IF_LOSS_COLUMNS) {
      if (!entry.oid.startsWith(col.prefix)) continue;
      const ifIndex = entry.oid.slice(col.prefix.length);
      if (!/^\d+$/.test(ifIndex)) continue;
      if (knownOids.has(entry.oid)) continue;
      knownOids.add(entry.oid);
      dynamic.push({
        metric: 'packet_loss',
        oid: entry.oid,
        profileLabel: `MIB-II ${col.label} (interface ${ifIndex})`,
        scale: 1,
        unit: 'pkts',
      });
      if (!oidResults[entry.oid]?.responded) {
        const n = Number(entry.value);
        oidResults[entry.oid] = {
          oid: entry.oid,
          responded: true,
          value: Number.isFinite(n) ? n : null,
          raw: entry.value,
        };
      }
    }
  }
  return dynamic;
}

/**
 * Pontos padrão de uma câmera ONVIF. Sem OID: o gateway lê via serviços ONVIF
 * (STATUS = GetDeviceInformation respondeu; STREAM = GetStreamUri OK) e os
 * eventos (motion/tamper/video_loss) chegam pela assinatura pull-point como
 * pontos digitais 0/1 — prontos para regras de alarme protocol-agnósticas.
 * UPTIME fica null (o ONVIF não padroniza uptime), mantido por simetria com SNMP.
 */
const DEFAULT_ONVIF_POINTS = [
  { tag: 'STATUS', objectName: 'Status (online/offline)', metric: 'status', unit: '' },
  { tag: 'UPTIME', objectName: 'Tempo ligada', metric: 'uptime', unit: 's' },
  { tag: 'STREAM', objectName: 'Stream de vídeo (disponível)', metric: 'stream', unit: '' },
  { tag: 'MOVIMENTO', objectName: 'Detecção de movimento', metric: 'motion', unit: '' },
  { tag: 'TAMPER', objectName: 'Violação/tamper', metric: 'tamper', unit: '' },
  { tag: 'PERDA_VIDEO', objectName: 'Perda de vídeo', metric: 'video_loss', unit: '' },
  { tag: 'LATENCIA', objectName: 'Latência de resposta', metric: 'latency', unit: 'ms' },
  { tag: 'ULTIMO_MOVIMENTO', objectName: 'Tempo desde o último movimento', metric: 'last_motion', unit: 's' },
  { tag: 'PERDA_PING', objectName: 'Perda de pacotes (ping)', metric: 'ping_loss', unit: '%' },
];

/** Canal SNMP opcional de saúde no cadastro de câmera ONVIF (híbrido). */
interface SnmpHealthBody {
  enabled?: boolean;
  community?: string;
  port?: number;
  snmpVersion?: '1' | '2c';
  /** Overrides manuais de OID por métrica (vazio = perfil do fabricante). */
  oids?: Partial<Record<HealthMetric, string>>;
}

interface CameraBody {
  monitoringProtocol?: 'snmp' | 'onvif';
  onvifUsername?: string;
  onvifPassword?: string;
  name?: string;
  siteId?: string;
  tenantId?: string;
  gatewayId?: string;
  ip?: string;
  port?: number;
  snmpVersion?: '1' | '2c';
  community?: string;
  rtspUrl?: string | null;
  pollingInterval?: number;
  /** ONVIF: canal SNMP opcional de saúde. */
  snmpHealth?: SnmpHealthBody | null;
  /**
   * ONVIF: "Cadastrar mesmo assim" — salva a câmera mesmo com o probe
   * falhando em todas as portas, marcando a validação como pendente.
   */
  forceCreate?: boolean;
  /** SNMP: overrides manuais de OID por ponto (saúde + uptime). */
  healthOids?: Partial<Record<DiagMetric, string>>;
  /**
   * SNMP: fabricante informado no cadastro (Hikvision/Dahua/Intelbras…) —
   * precedência máxima na identificação de provider do gateway.
   */
  manufacturer?: string | null;
}

type CameraWithRelations = Prisma.DeviceGetPayload<{
  include: { points: true; site: true };
}>;

/**
 * CftvController — área de CFTV (câmeras monitoradas via SNMP).
 *
 * Câmeras são Devices com protocol='snmp': o gateway faz o polling dos OIDs e
 * publica no tópico canônico de telemetria (trends/alarmes funcionam sem
 * mudanças no motor), mas elas são EXCLUÍDAS de todas as listagens BMS
 * (mesmo padrão dos dispositivos virtuais) e vivem nesta área própria.
 */
@Controller('cftv')
export class CftvController {
  private readonly logger = new Logger(CftvController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configPublisher: DeviceConfigPublisherService,
    private readonly snmpScan: SnmpNetworkScanService,
    private readonly onvifProbe: OnvifProbeService,
    private readonly onvifScan: OnvifNetworkScanService,
    private readonly snmpHealthTest: SnmpHealthTestService,
    private readonly snmpDiagnose: SnmpDiagnoseService,
    private readonly deviceStatus: DeviceStatusService,
  ) {}

  /** Garante que o gateway informado pertence ao tenant efetivo do usuário. */
  private async assertGatewayInTenant(gatewayId: string, tenantId: string): Promise<void> {
    const gw = await this.prisma.gateway.findFirst({
      where: { id: gatewayId, tenantId },
      select: { id: true },
    });
    if (!gw) {
      throw new ForbiddenException('Gateway não pertence ao cliente informado');
    }
  }

  /** GET /cftv/oid-profiles — catálogo de perfis de OIDs por fabricante. */
  @Get('oid-profiles')
  @UseGuards(JwtAuthGuard)
  getOidProfiles() {
    return CAMERA_OID_PROFILES.map((p) => ({
      id: p.id,
      label: p.label,
      oids: p.oids,
    }));
  }

  /**
   * POST /cftv/test-snmp — testa o canal SNMP de uma câmera via gateway e
   * pré-visualiza os valores dos OIDs de saúde (botão "Testar SNMP").
   */
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
      oids?: Partial<Record<HealthMetric, string>>;
    },
  ): Promise<SnmpHealthTestResult & { oids?: Record<string, string> }> {
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');
    if (!body.gatewayId?.trim()) throw new BadRequestException('gatewayId é obrigatório');
    await this.assertGatewayInTenant(body.gatewayId, tenantId);
    if (!this.isValidIp(body.ip)) {
      throw new BadRequestException('ip inválido (IPv4 esperado)');
    }

    const effective = this.resolveHealthOids(body.manufacturer, body.oids);
    const oids: Record<string, string> = {};
    for (const metric of HEALTH_METRICS) {
      const entry = effective[metric];
      if (entry?.oid) oids[metric] = entry.oid;
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

    // Devolve também os OIDs efetivamente testados (pré-preenchimento na UI).
    return result.success ? { ...result, oids } : result;
  }

  /** GET /cftv/cameras — lista as câmeras (com status vivo). */
  @Get('cameras')
  @UseGuards(JwtAuthGuard)
  async listCameras(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tenantId') tenantId?: string,
  ) {
    const effectiveTenantId = resolveTenantScope(user, tenantId);

    const cameras = await this.prisma.device.findMany({
      where: {
        ...(effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
        ...ONLY_CFTV_DEVICES,
      },
      orderBy: { name: 'asc' },
      include: { points: true, site: true },
    });

    // "Visto por último" com fallback durável (status_events/lastValueAt) —
    // sobrevive a reinícios do backend; nunca datas de cadastro.
    const lastSeenMap = await this.deviceStatus.resolveLastSeenMany(
      cameras.map((c) => c.id),
    );
    return cameras.map((c) => this.mapCamera(c, lastSeenMap.get(c.id) ?? null));
  }

  /** POST /cftv/cameras — cadastra uma câmera com os pontos padrão de saúde. */
  @Post('cameras')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async createCamera(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CameraBody,
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

    const protocol = body.monitoringProtocol === 'onvif' ? ONVIF_PROTOCOL : SNMP_PROTOCOL;

    if (protocol === ONVIF_PROTOCOL) {
      return this.createOnvifCamera(user, body, { name, ip, tenantId });
    }

    const camera = await this.prisma.device.create({
      data: {
        name,
        protocol: SNMP_PROTOCOL,
        ip,
        port: body.port || DEFAULT_SNMP_PORT,
        status: 'offline',
        tenantId,
        siteId: body.siteId || null,
        gatewayId: body.gatewayId,
        config: {
          snmpVersion: body.snmpVersion ?? '2c',
          community: body.community?.trim() || 'public',
          rtspUrl: body.rtspUrl?.trim() || null,
          pollingIntervalMs: (body.pollingInterval ?? DEFAULT_POLLING_S) * 1000,
          // Fabricante manual — identifica o provider de telemetria no gateway.
          manufacturer: body.manufacturer?.trim() || null,
        },
        points: {
          create: DEFAULT_CAMERA_POINTS.map((p, i) => ({
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

    await this.configPublisher.publishForDevice(camera.id);
    this.logger.log(`Câmera CFTV cadastrada: ${camera.id} (${ip}) por ${user.email}`);
    // Câmera recém-cadastrada: nenhuma comunicação real ainda.
    return this.mapCamera(camera, null);
  }

  /**
   * Cadastro de câmera ONVIF: valida as credenciais conectando na câmera via
   * gateway (probe) e auto-preenche fabricante/modelo/firmware/série.
   * A senha é armazenada cifrada em Device.config e nunca retorna na API.
   */
  private async createOnvifCamera(
    user: AuthenticatedUser,
    body: CameraBody,
    ctx: { name: string; ip: string; tenantId: string },
  ) {
    const username = body.onvifUsername?.trim();
    const password = body.onvifPassword;
    if (!username) throw new BadRequestException('Usuário ONVIF é obrigatório');
    if (!password) throw new BadRequestException('Senha ONVIF é obrigatória');
    const port = body.port || DEFAULT_ONVIF_PORT;

    const probe = await this.onvifProbe.probe({
      tenantId: ctx.tenantId,
      gatewayId: body.gatewayId as string,
      ip: ctx.ip,
      port,
      username,
      password,
    });
    if (!probe.success && !body.forceCreate) {
      // Erro estruturado: o frontend usa o code para oferecer o botão
      // "Cadastrar mesmo assim" (validação pendente).
      throw new BadRequestException({
        message: probe.error,
        code: 'ONVIF_PROBE_FAILED',
        errorCode: probe.errorCode,
      });
    }

    // Porta efetiva: a que respondeu ONVIF (o gateway tenta as portas comuns
    // automaticamente quando a informada falha). Sem sucesso, mantém a digitada.
    const effectivePort = probe.success ? probe.port || port : port;
    const deviceInfo = probe.success ? probe.deviceInfo : null;
    const pendingValidation = !probe.success;

    // Canal SNMP opcional de saúde (híbrido): perfil de OIDs pré-selecionado
    // pelo fabricante do probe (genérico quando pendente), com overrides do usuário.
    const health = body.snmpHealth;
    const healthEnabled = Boolean(health?.enabled);
    const healthOids = healthEnabled
      ? this.resolveHealthOids(deviceInfo?.manufacturer ?? null, health?.oids)
      : null;

    const camera = await this.prisma.device.create({
      data: {
        name: ctx.name,
        protocol: ONVIF_PROTOCOL,
        ip: ctx.ip,
        port: effectivePort,
        status: 'offline',
        tenantId: ctx.tenantId,
        siteId: body.siteId || null,
        gatewayId: body.gatewayId,
        config: {
          onvifUsername: username,
          onvifPasswordEnc: encryptCameraSecret(password),
          rtspUrl: body.rtspUrl?.trim() || null,
          pollingIntervalMs: (body.pollingInterval ?? DEFAULT_POLLING_S) * 1000,
          ...(deviceInfo
            ? { deviceInfo: deviceInfo as unknown as Prisma.InputJsonValue }
            : {}),
          ...(pendingValidation ? { pendingValidation: true } : {}),
          ...(healthEnabled
            ? {
                snmpHealth: {
                  enabled: true,
                  port: health?.port || DEFAULT_SNMP_PORT,
                  snmpVersion: health?.snmpVersion === '1' ? '1' : '2c',
                  community: health?.community?.trim() || 'public',
                },
              }
            : {}),
        },
        points: {
          create: DEFAULT_ONVIF_POINTS.map((p, i) => ({
            tag: p.tag,
            objectName: p.objectName,
            objectType: 'onvif',
            instance: i,
            unit: p.unit,
            binding: { metric: p.metric },
          })),
        },
      },
      include: { points: true, site: true },
    });

    if (healthEnabled && healthOids) {
      await this.syncOnvifHealthPoints(camera.id, healthOids, false);
    }

    await this.configPublisher.publishForDevice(camera.id);
    this.logger.log(
      `Câmera CFTV (ONVIF) cadastrada: ${camera.id} (${ctx.ip}:${effectivePort}` +
        `${effectivePort !== port ? `, porta ajustada de ${port}` : ''}, ` +
        (pendingValidation
          ? 'validação pendente'
          : `${deviceInfo?.manufacturer ?? '?'} ${deviceInfo?.model ?? '?'}`) +
        `) por ${user.email}`,
    );
    const created = await this.prisma.device.findUniqueOrThrow({
      where: { id: camera.id },
      include: { points: true, site: true },
    });
    return this.mapCamera(created, await this.deviceStatus.resolveLastSeen(created.id));
  }

  /** PATCH /cftv/cameras/:id — edita nome/site/rede/config SNMP e republica a config. */
  @Patch('cameras/:id')
  @UseGuards(JwtAuthGuard)
  async updateCamera(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CameraBody,
  ) {
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);

    if (body.siteId) {
      const site = await this.prisma.site.findFirst({
        where: { id: body.siteId, tenantId: camera.tenantId },
      });
      if (!site) throw new BadRequestException('Site inválido para esta câmera');
    }

    const cfg = (camera.config ?? {}) as Record<string, unknown>;
    const isOnvif = camera.protocol === ONVIF_PROTOCOL;
    // ONVIF: porta que efetivamente respondeu no probe (fallback do gateway
    // pode diferir da digitada) — sobrepõe body.port na gravação.
    let onvifEffectivePort: number | null = null;

    let newConfig: Record<string, unknown> = {
      ...cfg,
      // rtspUrl: string vazia limpa; undefined mantém
      ...(body.rtspUrl !== undefined ? { rtspUrl: body.rtspUrl?.trim() || null } : {}),
      ...(body.pollingInterval
        ? { pollingIntervalMs: Number(body.pollingInterval) * 1000 }
        : {}),
    };

    if (!isOnvif) {
      newConfig = {
        ...newConfig,
        ...(body.snmpVersion ? { snmpVersion: body.snmpVersion } : {}),
        ...(body.community?.trim() ? { community: body.community.trim() } : {}),
        // undefined = mantém; string vazia/null = limpa o fabricante manual.
        ...(body.manufacturer !== undefined
          ? { manufacturer: body.manufacturer?.trim() || null }
          : {}),
      };
    } else {
      const newUsername = body.onvifUsername?.trim();
      const newPassword = body.onvifPassword; // vazio/undefined = manter a atual
      const nextIp = body.ip?.trim() || camera.ip;
      const nextPort = body.port != null ? Number(body.port) : camera.port;
      const connectionChanged =
        (newUsername && newUsername !== cfg.onvifUsername) ||
        !!newPassword ||
        nextIp !== camera.ip ||
        nextPort !== camera.port;

      // Câmera pendente re-tenta o probe em TODO salvamento, mesmo sem
      // mudança de conexão — é a chance de finalmente validar.
      if (connectionChanged || cfg.pendingValidation === true) {
        // Revalida a conexão antes de gravar — evita salvar credenciais quebradas.
        const password =
          newPassword || decryptCameraSecret(cfg.onvifPasswordEnc as string | undefined);
        const username = newUsername || (cfg.onvifUsername as string | undefined);
        if (!username || !password) {
          throw new BadRequestException('Usuário e senha ONVIF são obrigatórios');
        }
        const probe = await this.onvifProbe.probe({
          tenantId: camera.tenantId,
          gatewayId: camera.gatewayId as string,
          ip: nextIp as string,
          port: nextPort ?? DEFAULT_ONVIF_PORT,
          username,
          password,
        });
        if (probe.success) {
          // Porta efetiva pode diferir da digitada (fallback do gateway).
          onvifEffectivePort = probe.port || nextPort || DEFAULT_ONVIF_PORT;
          const { pendingValidation: _pending, ...rest } = newConfig;
          newConfig = {
            ...rest,
            onvifUsername: username,
            ...(newPassword ? { onvifPasswordEnc: encryptCameraSecret(newPassword) } : {}),
            deviceInfo: probe.deviceInfo as unknown as Prisma.InputJsonValue,
          };
        } else if (body.forceCreate) {
          // "Salvar mesmo assim": grava as credenciais/rede novas e mantém
          // (ou marca) a validação como pendente — re-tentada em segundo plano.
          newConfig = {
            ...newConfig,
            onvifUsername: username,
            ...(newPassword ? { onvifPasswordEnc: encryptCameraSecret(newPassword) } : {}),
            pendingValidation: true,
          };
        } else {
          throw new BadRequestException({
            message: probe.error,
            code: 'ONVIF_PROBE_FAILED',
            errorCode: probe.errorCode,
          });
        }
      }

      // Canal SNMP de saúde: habilita/edita/desabilita (undefined = mantém).
      if (body.snmpHealth !== undefined) {
        const health = body.snmpHealth;
        const enabled = Boolean(health?.enabled);
        if (enabled) {
          newConfig = {
            ...newConfig,
            snmpHealth: {
              enabled: true,
              port: health?.port || DEFAULT_SNMP_PORT,
              snmpVersion: health?.snmpVersion === '1' ? '1' : '2c',
              community: health?.community?.trim() || 'public',
            },
          };
          const deviceInfo = (newConfig.deviceInfo ?? cfg.deviceInfo) as
            | OnvifDeviceInfo
            | undefined;
          const healthOids = this.resolveHealthOids(
            deviceInfo?.manufacturer ?? null,
            health?.oids,
          );
          await this.syncOnvifHealthPoints(id, healthOids, false);
        } else {
          newConfig = { ...newConfig, snmpHealth: { enabled: false } };
          await this.syncOnvifHealthPoints(
            id,
            {} as Record<HealthMetric, HealthOidEntry | null>,
            true,
          );
        }
      }
    }

    // Câmera SNMP: overrides manuais de OID por ponto (métricas de saúde +
    // uptime). Encontra o ponto pelo metric do binding; editar o OID limpa a
    // marca "não suportado" (será revalidada no próximo diagnóstico).
    if (!isOnvif && body.healthOids) {
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

    await this.prisma.device.update({
      where: { id },
      data: {
        ...(body.name?.trim() ? { name: body.name.trim() } : {}),
        ...(body.ip?.trim() ? { ip: body.ip.trim() } : {}),
        ...(onvifEffectivePort != null
          ? { port: onvifEffectivePort }
          : body.port != null
            ? { port: Number(body.port) }
            : {}),
        ...(body.siteId ? { siteId: body.siteId } : {}),
        config: newConfig as Prisma.InputJsonValue,
      },
    });

    await this.configPublisher.publishForDevice(id);
    this.logger.log(`Câmera CFTV atualizada: ${id} por ${user.email}`);

    const updated = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true },
    });
    return this.mapCamera(updated, await this.deviceStatus.resolveLastSeen(updated.id));
  }

  /** DELETE /cftv/cameras/:id — exclusão sensível (confirmação de senha). */
  @Delete('cameras/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, SensitiveActionGuard)
  async deleteCamera(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Apenas ADMIN ou CCO podem excluir câmeras');
    }
    const camera = await this.findCameraOrThrow(id);

    await this.prisma.$transaction([
      this.prisma.devicePoint.deleteMany({ where: { deviceId: id } }),
      this.prisma.device.delete({ where: { id } }),
    ]);
    this.logger.log(`Câmera CFTV excluída: ${id} por ${user.email}`);

    if (camera.gatewayId) {
      await this.configPublisher.publishForGateway(camera.tenantId, camera.gatewayId);
    }
  }

  /** POST /cftv/scan — varre um range de IP via SNMP no gateway (MQTT). */
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async scan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: {
      tenantId?: string;
      gatewayId?: string;
      ipStart?: string;
      ipEnd?: string;
      snmpVersion?: '1' | '2c';
      community?: string;
      port?: number;
      scanId?: string;
    },
  ): Promise<SnmpScanResult> {
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');
    if (!body.gatewayId?.trim()) throw new BadRequestException('gatewayId é obrigatório');
    await this.assertGatewayInTenant(body.gatewayId, tenantId);
    if (!this.isValidIp(body.ipStart)) {
      throw new BadRequestException('ipStart inválido (IPv4 esperado)');
    }
    if (!this.isValidIp(body.ipEnd)) {
      throw new BadRequestException('ipEnd inválido (IPv4 esperado)');
    }

    // "public, private" → ['public', 'private'] (fallback automático no gateway)
    const communities = (body.community ?? 'public')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    try {
      return await this.snmpScan.scanSnmp({
        tenantId,
        gatewayId: body.gatewayId,
        ipStart: body.ipStart as string,
        ipEnd: body.ipEnd as string,
        snmpVersion: body.snmpVersion,
        communities: communities.length ? communities : undefined,
        port: body.port,
        scanId: body.scanId,
      });
    } catch (err) {
      const msg = (err as Error).message ?? 'Erro interno no scan SNMP';
      this.logger.error(`Erro não tratado no scan SNMP: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * POST /cftv/scan/onvif — descoberta automática de câmeras ONVIF
   * (WS-Discovery multicast executado pelo gateway na rede local).
   */
  @Post('scan/onvif')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async scanOnvif(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { tenantId?: string; gatewayId?: string; targets?: string },
  ): Promise<OnvifScanResult> {
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');
    if (!body.gatewayId?.trim()) throw new BadRequestException('gatewayId é obrigatório');
    await this.assertGatewayInTenant(body.gatewayId, tenantId);

    // Campo opcional "IP ou faixa": expande IP único, CIDR ou intervalo em
    // uma lista de IPs para sondagem WS-Discovery unicast direta no gateway.
    const targets = this.expandOnvifTargets(body.targets);

    try {
      return await this.onvifScan.scanOnvif({
        tenantId,
        gatewayId: body.gatewayId,
        ...(targets.length ? { targets } : {}),
      });
    } catch (err) {
      const msg = (err as Error).message ?? 'Erro interno no scan ONVIF';
      this.logger.error(`Erro não tratado no scan ONVIF: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /** GET /cftv/scan/:scanId/progress — progresso parcial do scan (polling). */
  @Get('scan/:scanId/progress')
  @UseGuards(JwtAuthGuard)
  getScanProgress(
    @Param('scanId') scanId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): SnmpScanProgress | { unknown: true } {
    const progress = this.snmpScan.getProgress(scanId);
    if (!progress) return { unknown: true };
    // Papel de cliente só enxerga progresso de scans do próprio tenant.
    // Fail-closed: usuário escopado só vê progresso comprovadamente do
    // próprio tenant (sem tenant no progresso = não mostra).
    const scope = resolveTenantScope(user);
    if (scope && progress.tenantId !== scope) {
      return { unknown: true };
    }
    return progress;
  }

  /**
   * POST /cftv/cameras/:id/diagnose-snmp — diagnóstico do canal SNMP da
   * câmera via gateway: testa cada OID cadastrado e os candidatos de TODOS os
   * perfis de fabricante, e faz um walk resumido (MIB-II system/interfaces +
   * subárvore enterprise detectada). Falha rápido se o gateway está offline.
   */
  @Post('cameras/:id/diagnose-snmp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async diagnoseSnmp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { diagnoseId?: string },
  ) {
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);

    if (!camera.gatewayId) {
      throw new BadRequestException('Câmera sem gateway associado');
    }
    // Fast-fail: o status explícito (LWT/heartbeat) do gateway evita esperar
    // o timeout inteiro quando o gateway está comprovadamente fora do ar.
    if (this.deviceStatus.getStatus(camera.gatewayId) === 'offline') {
      throw new BadRequestException(
        'Gateway offline — o diagnóstico precisa do gateway para falar com a câmera. ' +
          'Verifique se o gateway está ligado e conectado.',
      );
    }

    const cfg = (camera.config ?? {}) as {
      snmpVersion?: '1' | '2c';
      community?: string;
      snmpHealth?: {
        enabled?: boolean;
        port?: number;
        snmpVersion?: '1' | '2c';
        community?: string;
      } | null;
    };
    const isOnvif = camera.protocol === ONVIF_PROTOCOL;

    // Parâmetros de conexão SNMP: câmera SNMP usa os campos principais;
    // câmera ONVIF usa o canal opcional de saúde (precisa estar habilitado).
    let port: number;
    let snmpVersion: '1' | '2c';
    let community: string;
    if (isOnvif) {
      if (!cfg.snmpHealth?.enabled) {
        throw new BadRequestException(
          'Esta câmera ONVIF não tem o monitoramento de saúde via SNMP habilitado',
        );
      }
      port = cfg.snmpHealth.port || DEFAULT_SNMP_PORT;
      snmpVersion = cfg.snmpHealth.snmpVersion === '1' ? '1' : '2c';
      community = cfg.snmpHealth.community?.trim() || 'public';
    } else {
      port = camera.port ?? DEFAULT_SNMP_PORT;
      snmpVersion = cfg.snmpVersion === '1' ? '1' : '2c';
      community = cfg.community?.trim() || 'public';
    }

    // OIDs atualmente cadastrados nos pontos (por métrica do binding).
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

    const catalog = buildDiagnoseCandidateCatalog();
    const candidates: DiagnoseOidProbe[] = catalog.map((c) => ({
      metric: c.metric,
      oid: c.oid,
    }));

    const result = await this.snmpDiagnose.diagnose({
      tenantId: camera.tenantId,
      gatewayId: camera.gatewayId,
      ip: camera.ip as string,
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

    // Candidatos dinâmicos de "pacotes perdidos" com o ifIndex real da câmera
    // (descobertos no walk de MIB-II interfaces) — cobrem câmeras cuja
    // interface não é a de índice 1.
    const knownOids = new Set(catalog.map((c) => c.oid));
    const fullCatalog = [
      ...catalog,
      ...buildDynamicPacketLossCandidates(result.walk, knownOids, result.oidResults),
    ];

    // Monta a visão por métrica: OID atual + candidatos testados.
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

    // Persiste nos pontos atuais a marca "não suportado pela câmera": com a
    // câmera comprovadamente respondendo (reachable), um OID cadastrado que
    // não respondeu não existe no firmware — a UI mostra isso em vez do
    // genérico "sem dados". Aplicar/editar um OID limpa a marca.
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

  /** GET /cftv/diagnose/:diagnoseId/progress — progresso parcial (polling). */
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
   * POST /cftv/cameras/:id/apply-snmp-oids — aplica as sugestões do
   * diagnóstico: atualiza o binding dos pontos existentes (IDs preservados —
   * trends e alarmes sobrevivem) e republica a config no gateway.
   */
  @Post('cameras/:id/apply-snmp-oids')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async applySnmpOids(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { oids?: Partial<Record<string, string>> },
  ) {
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);

    const entries = Object.entries(body?.oids ?? {}).filter(
      ([metric, oid]) =>
        DIAG_METRICS.includes(metric as DiagMetric) &&
        typeof oid === 'string' &&
        oid.trim(),
    ) as Array<[DiagMetric, string]>;
    if (entries.length === 0) {
      throw new BadRequestException('Nenhum OID para aplicar');
    }

    const catalog = buildDiagnoseCandidateCatalog();
    const points = await this.prisma.devicePoint.findMany({
      where: { deviceId: id },
    });

    for (const [metric, rawOid] of entries) {
      const oid = rawOid.trim();
      const point = points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string };
        return b.metric === metric;
      });
      // Scale/unit vêm do catálogo quando o OID é conhecido; senão valor cru.
      const known = catalog.find((c) => c.metric === metric && c.oid === oid);
      if (!point) {
        // Métrica de saúde sem ponto (ex.: RAM total/armazenamento em câmera
        // antiga, ou canal híbrido ONVIF) — cria o ponto na hora.
        if (metric === 'uptime') continue; // uptime sempre existe em SNMP puro
        const meta = HEALTH_METRIC_META[metric];
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
          // OID recém-aplicado comprovadamente responde — limpa a marca.
          binding: { ...b, metric, oid, scale: known?.scale ?? 1, unsupported: false },
          ...(known?.unit !== undefined ? { unit: known.unit } : {}),
        },
      });
    }

    await this.configPublisher.publishForDevice(id);
    this.logger.log(
      `OIDs SNMP aplicados via diagnóstico na câmera ${id} por ${user.email}: ` +
        entries.map(([m, o]) => `${m}=${o}`).join(', '),
    );

    const updated = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true },
    });
    return this.mapCamera(updated, await this.deviceStatus.resolveLastSeen(updated.id));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Resolve os OIDs efetivos das métricas de saúde: perfil do fabricante
   * (probe ONVIF) como base + overrides manuais do usuário por cima.
   * Override manual mantém unit do perfil e scale 1 (valor cru).
   */
  private resolveHealthOids(
    manufacturer?: string | null,
    overrides?: Partial<Record<HealthMetric, string>>,
  ): Record<HealthMetric, HealthOidEntry | null> {
    const profile = resolveOidProfile(manufacturer);
    const out = {} as Record<HealthMetric, HealthOidEntry | null>;
    for (const metric of HEALTH_METRICS) {
      const manual = overrides?.[metric]?.trim();
      const base = profile.oids[metric] ?? GENERIC_PROFILE.oids[metric] ?? null;
      if (manual) {
        out[metric] = base && base.oid === manual
          ? base
          : { oid: manual, scale: 1, unit: base?.unit ?? '' };
      } else {
        out[metric] = base;
      }
    }
    return out;
  }

  /**
   * Sincroniza (upsert por tag) os pontos de saúde SNMP de uma câmera ONVIF.
   * Preserva IDs de pontos existentes (trends/alarmes sobrevivem à edição).
   * Com remove=true, apaga os pontos de saúde (canal desabilitado).
   */
  private async syncOnvifHealthPoints(
    deviceId: string,
    oids: Record<HealthMetric, HealthOidEntry | null>,
    remove: boolean,
  ): Promise<void> {
    const existing = await this.prisma.devicePoint.findMany({
      where: { deviceId, objectType: 'snmp' },
    });

    if (remove) {
      if (existing.length > 0) {
        await this.prisma.devicePoint.deleteMany({
          where: { deviceId, objectType: 'snmp' },
        });
      }
      return;
    }

    const all = await this.prisma.devicePoint.findMany({ where: { deviceId } });
    let nextInstance = all.reduce((m, p) => Math.max(m, p.instance), -1) + 1;

    for (const metric of HEALTH_METRICS) {
      const entry = oids[metric];
      if (!entry?.oid) continue;
      const meta = HEALTH_METRIC_META[metric];
      const found = existing.find((p) => p.tag === meta.tag);
      const binding = { metric, oid: entry.oid, scale: entry.scale };
      if (found) {
        await this.prisma.devicePoint.update({
          where: { id: found.id },
          data: { binding, unit: entry.unit },
        });
      } else {
        await this.prisma.devicePoint.create({
          data: {
            deviceId,
            tag: meta.tag,
            objectName: meta.objectName,
            objectType: 'snmp',
            instance: nextInstance++,
            unit: entry.unit,
            binding,
          },
        });
      }
    }
  }

  private async findCameraOrThrow(id: string) {
    const camera = await this.prisma.device.findFirst({
      where: { id, ...ONLY_CFTV_DEVICES },
    });
    if (!camera) throw new NotFoundException('Câmera não encontrada');
    return camera;
  }

  private assertCanEdit(user: AuthenticatedUser, tenantId: string): void {
    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO';
    if (!isGlobal && tenantId !== user.tenantId) {
      throw new BadRequestException('Sem permissão para editar esta câmera');
    }
  }

  /** Máximo de IPs expandidos para a sondagem unicast ONVIF. */
  private static readonly MAX_ONVIF_TARGETS = 1024;

  /**
   * Expande a entrada opcional de IP/faixa do scan ONVIF em uma lista de IPs.
   * Aceita (separados por vírgula): IP único, CIDR (ex.: 192.168.0.0/24) e
   * intervalo (ex.: 192.168.0.10-192.168.0.50 ou 192.168.0.10-50).
   * Lança BadRequestException para formato inválido ou faixa grande demais.
   */
  private expandOnvifTargets(input?: string): string[] {
    const raw = input?.trim();
    if (!raw) return [];

    const toNum = (ip: string): number => {
      const parts = ip.split('.').map(Number);
      return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    };
    const toIp = (n: number): string =>
      [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

    const ips = new Set<string>();
    const max = CftvController.MAX_ONVIF_TARGETS;

    const addRange = (start: number, end: number, label: string) => {
      if (end < start) {
        throw new BadRequestException(`Faixa invertida: ${label}`);
      }
      if (end - start + 1 > max) {
        throw new BadRequestException(
          `Faixa grande demais (${label}) — máximo de ${max} IPs por scan`,
        );
      }
      for (let n = start; n <= end; n++) {
        ips.add(toIp(n));
        if (ips.size > max) {
          throw new BadRequestException(`Máximo de ${max} IPs por scan`);
        }
      }
    };

    for (const piece of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
      // CIDR: 192.168.0.0/24
      const cidr = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(piece);
      if (cidr) {
        if (!this.isValidIp(cidr[1])) {
          throw new BadRequestException(`IP inválido em "${piece}"`);
        }
        const prefix = Number(cidr[2]);
        if (prefix < 22 || prefix > 32) {
          throw new BadRequestException(
            `CIDR inválido em "${piece}" — use prefixo entre /22 e /32`,
          );
        }
        const base = toNum(cidr[1]) & (prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0);
        const size = 2 ** (32 - prefix);
        // Exclui network/broadcast em faixas maiores que /31
        const start = size > 2 ? base + 1 : base;
        const end = size > 2 ? base + size - 2 : base + size - 1;
        addRange(start >>> 0, end >>> 0, piece);
        continue;
      }

      // Intervalo: 192.168.0.10-192.168.0.50 ou 192.168.0.10-50
      const range = /^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\S+)$/.exec(piece);
      if (range) {
        if (!this.isValidIp(range[1])) {
          throw new BadRequestException(`IP inválido em "${piece}"`);
        }
        let endIp = range[2];
        if (/^\d{1,3}$/.test(endIp)) {
          // Forma curta: só o último octeto
          endIp = range[1].split('.').slice(0, 3).join('.') + '.' + endIp;
        }
        if (!this.isValidIp(endIp)) {
          throw new BadRequestException(`IP final inválido em "${piece}"`);
        }
        addRange(toNum(range[1]), toNum(endIp), piece);
        continue;
      }

      // IP único
      if (this.isValidIp(piece)) {
        ips.add(piece);
        if (ips.size > max) {
          throw new BadRequestException(`Máximo de ${max} IPs por scan`);
        }
        continue;
      }

      throw new BadRequestException(
        `Formato inválido: "${piece}" — use um IP (192.168.0.50), ` +
          'CIDR (192.168.0.0/24) ou intervalo (192.168.0.10-50)',
      );
    }

    return [...ips];
  }

  private isValidIp(ip?: string): boolean {
    if (!ip) return false;
    const parts = ip.trim().split('.');
    return (
      parts.length === 4 &&
      parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
    );
  }

  /** Mapeia a câmera para o shape esperado pelo frontend. */
  private mapCamera(camera: CameraWithRelations, lastCommunication: string | null) {
    const cfg = (camera.config ?? {}) as {
      snmpVersion?: string;
      community?: string;
      rtspUrl?: string | null;
      pollingIntervalMs?: number;
      onvifUsername?: string;
      onvifPasswordEnc?: string;
      deviceInfo?: OnvifDeviceInfo;
      pendingValidation?: boolean;
      manufacturer?: string | null;
      availability?: { onlineSince?: string };
      snmpHealth?: {
        enabled?: boolean;
        port?: number;
        snmpVersion?: '1' | '2c';
        community?: string;
      } | null;
    };
    const isOnvif = camera.protocol === ONVIF_PROTOCOL;

    // Canal SNMP de saúde da câmera ONVIF: config + OIDs efetivos dos pontos.
    const healthOids: Record<string, string> = {};
    for (const p of camera.points) {
      const b = (p.binding ?? {}) as { metric?: string; oid?: string | null };
      if (b.metric && b.oid && (HEALTH_METRICS as string[]).includes(b.metric)) {
        healthOids[b.metric] = b.oid;
      }
    }
    const snmpHealth = isOnvif
      ? {
          enabled: Boolean(cfg.snmpHealth?.enabled),
          port: cfg.snmpHealth?.port ?? DEFAULT_SNMP_PORT,
          snmpVersion: cfg.snmpHealth?.snmpVersion ?? '2c',
          community: cfg.snmpHealth?.community ?? 'public',
          oids: healthOids,
        }
      : null;
    return {
      id: camera.id,
      name: camera.name,
      protocol: camera.protocol,
      monitoringProtocol: isOnvif ? 'onvif' : 'snmp',
      // ONVIF: credenciais nunca saem na API — só o usuário e a flag de senha.
      onvifUsername: isOnvif ? (cfg.onvifUsername ?? null) : null,
      hasOnvifPassword: isOnvif ? Boolean(cfg.onvifPasswordEnc) : false,
      deviceInfo: isOnvif ? (cfg.deviceInfo ?? null) : null,
      // ONVIF: cadastro salvo sem probe bem-sucedido (re-validado em background).
      pendingValidation: isOnvif ? cfg.pendingValidation === true : false,
      // SNMP: fabricante manual do cadastro (identificação de provider).
      manufacturer: isOnvif
        ? (cfg.deviceInfo?.manufacturer ?? null)
        : (cfg.manufacturer ?? null),
      // "Online desde" estimado pelo backend (transições do ponto STATUS) —
      // usado na UI como "tempo online estimado" quando não há uptime real.
      estimatedOnlineSince: cfg.availability?.onlineSince ?? null,
      snmpHealth,
      site: camera.site?.name ?? '',
      siteId: camera.siteId,
      tenantId: camera.tenantId,
      gatewayId: camera.gatewayId,
      ip: camera.ip,
      port: camera.port,
      snmpVersion: cfg.snmpVersion ?? '2c',
      community: cfg.community ?? 'public',
      rtspUrl: cfg.rtspUrl ?? null,
      pollingInterval: cfg.pollingIntervalMs ? cfg.pollingIntervalMs / 1000 : DEFAULT_POLLING_S,
      status: this.deviceStatus.getStatus(camera.id),
      critical: camera.critical,
      lastCommunication,
      points: camera.points.map((p) => {
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
          // OID comprovadamente inexistente na câmera (último diagnóstico).
          unsupported: Boolean(b.unsupported),
          unit: p.unit ?? '',
          // Ponto crítico (card Ativos Críticos) — independente da câmera crítica.
          critical: p.critical,
          // Último valor persistido — seed do status antes da telemetria ao vivo.
          lastValue: p.lastValue ?? null,
          lastValueAt: p.lastValueAt ? p.lastValueAt.toISOString() : null,
          // Estado da última leitura (waiting_event/unsupported/error/estimated).
          lastValueState: p.lastValueState ?? null,
        };
      }),
    };
  }
}
