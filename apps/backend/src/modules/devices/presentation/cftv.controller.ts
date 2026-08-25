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
  resolveProfileLabel,
} from '../application/capability-probe.service.js';
import {
  SwitchPortSyncService,
} from '../application/switch-port-sync.service.js';
import {
  NvrTableSyncService,
} from '../application/nvr-table-sync.service.js';
import {
  NVR_TABLE_OIDS,
  detectNvrProfile,
  resolveNvrProfileLabel,
  type NvrDiskTableOids,
  type NvrChannelTableOids,
  type NvrTableOids,
} from '../application/nvr-oid-profiles.js';
import {
  buildDiscoveredObjects,
  buildInterfaceWalkInfo,
  isMonitorableWalkInterface,
} from '../application/snmp-oid-semantics.js';
import { partitionDiscoveredPorts } from '../application/switch-port-filter.util.js';
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
import { CameraLiveViewService } from '../application/camera-live-view.service.js';
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
    tag: 'REACHABILITY',
    objectName: 'Alcançabilidade SNMP',
    metric: 'reachability',
    // Sem OID: derivado pela alcançabilidade (respondeu ao GET = 1, sem resposta = 0).
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
  ...REACHABILITY_DETAIL_POINTS,
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

/**
 * Pontos padrão de saúde de um switch gerenciável (SNMP MIB-II / HOST-RESOURCES-MIB).
 * Pontos de porta (if_oper_status, if_in_octets, if_out_octets) são criados
 * depois pelo endpoint sync-ports, one per port, objectType 'sw-state'/'sw-in'/'sw-out'.
 */
const DEFAULT_SWITCH_POINTS = [
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
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
  ...REACHABILITY_DETAIL_POINTS,
  {
    tag: 'UPTIME',
    objectName: 'Tempo ligado',
    metric: 'uptime',
    // sysUpTime (centésimos de segundo) → segundos via scale 0.01
    oid: '1.3.6.1.2.1.1.3.0',
    scale: 0.01,
    unit: 's',
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
];

/** Where-cláusula Prisma para filtrar somente switches gerenciáveis. */
const ONLY_SWITCH_DEVICES = { monitoredDeviceType: 'SWITCH' } as const;

/** Where-cláusula Prisma para filtrar somente NVRs/DVRs monitorados. */
const ONLY_NVR_DEVICES = { monitoredDeviceType: 'NVR' } as const;

/**
 * Pontos padrão de um NVR/DVR (SNMP MIB-II + enterprise NVR-MIBs).
 * Pontos de disco (nvr-disk/nvr-disk-cap/nvr-disk-used) e canais (nvr-chan)
 * são criados no endpoint sync-disks, indexados por slotIndex/channelIndex.
 */
const DEFAULT_NVR_POINTS = [
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
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
  ...REACHABILITY_DETAIL_POINTS,
  {
    tag: 'UPTIME',
    objectName: 'Tempo ligado',
    metric: 'uptime',
    oid: '1.3.6.1.2.1.1.3.0',
    scale: 0.01,
    unit: 's',
  },
  {
    tag: 'CPU',
    objectName: 'Uso de CPU',
    metric: 'cpu',
    // OID omitido intencionalmente: o gateway resolve pelo perfil vendor detectado
    // (Hikvision: .1.7.0, Dahua: 2.1.3.1.1.1, base: hrProcessorLoad).
    // OID concreto no binding daria precedência sobre o perfil e tornaria
    // os perfis vendor inefetivos sem edição manual.
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
  {
    tag: 'MEMORIA',
    objectName: 'Memória (uso de RAM)',
    metric: 'memory',
    // OID omitido — idem CPU. Vendor profile decide o OID certo por fabricante.
    // Todos os perfis vendor NVR (Hikvision/Dahua/Intelbras) expõem memória como
    // percentual de uso sob metricKey 'memory'. O perfil base usa UCD memAvailReal.
    oid: null as string | null,
    scale: 1,
    unit: '%',
  },
  {
    tag: 'TEMPERATURA',
    objectName: 'Temperatura',
    metric: 'temperature',
    // OID omitido — idem CPU. Base fallback: UCD lm-sensors (.2021.13.16.2.1.3.1).
    oid: null as string | null,
    scale: 0.001,
    unit: '°C',
  },
];

/** Corpo do request para criar/editar um NVR/DVR. */
interface NvrBody {
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
  profileId?: string | null;
  profileOverrides?: Record<string, string> | null;
}

/** Corpo do request para criar/editar um switch. */
interface SwitchBody {
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
  profileId?: string | null;
  profileOverrides?: Record<string, string> | null;
}

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
  // Contexto por ifIndex (ifType/ifOperStatus/ifDescr) extraído do próprio
  // walk: loopback (ifType 24) e interfaces down NUNCA viram candidato — era
  // a origem do "PACOTES PERDIDOS — LO". Rótulo pelo ifDescr, não pelo índice.
  const ifInfo = buildInterfaceWalkInfo(walk);
  for (const entry of ifSection.entries) {
    for (const col of IF_LOSS_COLUMNS) {
      if (!entry.oid.startsWith(col.prefix)) continue;
      const ifIndex = entry.oid.slice(col.prefix.length);
      if (!/^\d+$/.test(ifIndex)) continue;
      const iface = ifInfo.get(Number(ifIndex));
      if (!isMonitorableWalkInterface(iface)) continue;
      if (knownOids.has(entry.oid)) continue;
      knownOids.add(entry.oid);
      dynamic.push({
        metric: 'packet_loss',
        oid: entry.oid,
        profileLabel: `MIB-II ${col.label} (${iface?.descr ?? `interface ${ifIndex}`})`,
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
  /**
   * Credenciais ONVIF. Na câmera ONVIF são obrigatórias (monitoramento).
   * Na câmera SNMP são o canal OPCIONAL de "Vídeo ao vivo": username vazio
   * limpa as credenciais; senha vazia na edição mantém a atual.
   */
  onvifUsername?: string;
  onvifPassword?: string;
  /** SNMP: porta do serviço ONVIF/vídeo (a porta principal é a do SNMP). */
  onvifPort?: number;
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
  /**
   * ID do perfil de monitoramento selecionado manualmente (override do
   * auto-detected). null = limpar override e usar detecção automática.
   * Valores válidos: 'hikvision', 'dahua', 'intelbras', 'axis', 'generic'.
   */
  profileId?: string | null;
  /**
   * Overrides de OID por métrica definidos pelo operador.
   * Ex.: { "cpu": "1.3.6.1.4.1.39165.1.7.0" }
   * null = limpar todos os overrides.
   */
  profileOverrides?: Record<string, string> | null;
}

type CameraWithRelations = Prisma.DeviceGetPayload<{
  include: { points: true; site: true };
}> & {
  snmpCredential?: Prisma.SnmpCredentialGetPayload<object> | null;
};

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
    private readonly capabilityProbe: CapabilityProbeService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly liveView: CameraLiveViewService,
    private readonly switchPortSync: SwitchPortSyncService,
    private readonly nvrTableSync: NvrTableSyncService,
    private readonly snmpMib: SnmpMibService,
    private readonly snmpDiscovery: SnmpDiscoveryPersistenceService,
    private readonly snmpMetric: SnmpMetricService,
  ) {}

  /**
   * POST /cftv/cameras/:id/live-view — inicia uma sessão de visualização ao
   * vivo (frames JPEG via socket /telemetry, evento `camera:frame`).
   * UMA sessão por operador: um segundo start substitui a anterior.
   */
  @Post('cameras/:id/live-view')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async startLiveView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { tenantId?: string },
  ) {
    return this.liveView.start(
      { id: user.id, tenantId: user.tenantId },
      id,
      body?.tenantId,
    );
  }

  /** POST /cftv/live-view/:sessionId/keepalive — renova a sessão (espectador presente). */
  @Post('live-view/:sessionId/keepalive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async keepAliveLiveView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.liveView.keepAlive({ id: user.id, tenantId: user.tenantId }, sessionId);
  }

  /** DELETE /cftv/live-view/:sessionId — encerra a sessão explicitamente. */
  @Delete('live-view/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async stopLiveView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    await this.liveView.stop({ id: user.id, tenantId: user.tenantId }, sessionId);
  }

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
   * GET /cftv/profiles?deviceType=CAMERA — catálogo de perfis de monitoramento
   * para um tipo de dispositivo. Retorna perfis selecionáveis manualmente.
   * deviceType padrão: 'CAMERA'.
   */
  @Get('profiles')
  @UseGuards(JwtAuthGuard)
  getMonitoringProfiles(@Query('deviceType') deviceType = 'CAMERA') {
    if (deviceType !== 'CAMERA') return [];
    return CAMERA_OID_PROFILES.map((p) => ({
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

  /**
   * GET /cftv/cameras/:id/capabilities — lê o mapa de capacidades da câmera
   * (resultado do último probe periódico ou manual).
   */
  @Get('cameras/:id/capabilities')
  @UseGuards(JwtAuthGuard)
  async getCameraCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);
    return this.capabilityProbe.getCapabilities(id);
  }

  /**
   * POST /cftv/cameras/:id/probe-capabilities — executa o probe de capacidades
   * da câmera via gateway (identifica equipamento, testa métricas, persiste).
   * Mesmo mecanismo de diagnóstico SNMP — aguarda o resultado.
   */
  @Post('cameras/:id/probe-capabilities')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async probeCameraCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);

    if (!camera.gatewayId) {
      throw new BadRequestException('Câmera sem gateway associado');
    }
    if (this.deviceStatus.getStatus(camera.gatewayId) === 'offline') {
      throw new BadRequestException(
        'Gateway offline — o probe precisa do gateway para falar com a câmera.',
      );
    }

    const result = await this.capabilityProbe.probeDevice(id);
    if (!result.success) {
      return { success: false as const, error: result.error };
    }

    this.logger.log(
      `Probe de capacidades da câmera ${id} por ${user.email}: ` +
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
      include: { points: true, site: true, snmpCredential: true },
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

    const snmpVersion: SnmpVersion = body.snmpVersion === '1' || body.snmpVersion === '3'
      ? body.snmpVersion
      : '2c';
    // Valida ANTES de criar o device: credenciais v3 incompletas = 400.
    const credentialData = buildSnmpCredentialData(snmpVersion, body);

    const camera = await this.prisma.device.create({
      data: {
        name,
        protocol: SNMP_PROTOCOL,
        monitoredDeviceType: 'CAMERA',
        ip,
        port: body.port || DEFAULT_SNMP_PORT,
        status: 'offline',
        tenantId,
        siteId: body.siteId || null,
        gatewayId: body.gatewayId,
        snmpCredential: { create: { tenantId, ...credentialData } },
        config: {
          // Retrocompat: versão/community continuam em Device.config enquanto
          // as duas fontes coexistirem; a tabela snmp_credential é a fonte da
          // verdade (chaves v3 SÓ lá, cifradas).
          snmpVersion,
          ...(snmpVersion !== '3'
            ? { community: body.community?.trim() || 'public' }
            : {}),
          rtspUrl: body.rtspUrl?.trim() || null,
          pollingIntervalMs: (body.pollingInterval ?? DEFAULT_POLLING_S) * 1000,
          // Fabricante manual — identifica o provider de telemetria no gateway.
          manufacturer: body.manufacturer?.trim() || null,
          // "Vídeo ao vivo" opcional: credenciais ONVIF só para o live view
          // (senha cifrada como nas câmeras ONVIF; nunca retorna na API).
          ...(body.onvifUsername?.trim() && body.onvifPassword
            ? {
                onvifUsername: body.onvifUsername.trim(),
                onvifPasswordEnc: encryptCameraSecret(body.onvifPassword),
                onvifPort: Number(body.onvifPort) || DEFAULT_ONVIF_PORT,
              }
            : {}),
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
      include: { points: true, site: true, snmpCredential: true },
    });

    await this.configPublisher.publishForDevice(camera.id);
    this.logger.log(`Câmera CFTV cadastrada: ${camera.id} (${ip}) por ${user.email}`);

    // Descoberta de cadastro fire-and-forget: walk completo persistido como
    // discovery_run (snapshot + diff). Automática = no máx. 1×/dia por device.
    void this.runAutoDiscovery(camera.id, 'registration').catch((err: Error) => {
      this.logger.warn(
        `Descoberta pós-cadastro da câmera ${camera.id} falhou (não bloqueante): ${err.message}`,
      );
    });

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
        monitoredDeviceType: 'CAMERA',
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
      include: { points: true, site: true, snmpCredential: true },
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
      include: { points: true, site: true, snmpCredential: true },
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
          create: { tenantId: camera.tenantId, deviceId: id, ...credentialData },
          update: credentialData,
        });
      }

      newConfig = {
        ...newConfig,
        ...(body.snmpVersion ? { snmpVersion: body.snmpVersion } : {}),
        ...(body.community?.trim() ? { community: body.community.trim() } : {}),
        // undefined = mantém; string vazia/null = limpa o fabricante manual.
        ...(body.manufacturer !== undefined
          ? { manufacturer: body.manufacturer?.trim() || null }
          : {}),
      };
      // "Vídeo ao vivo" opcional da câmera SNMP: username vazio limpa as
      // credenciais; senha vazia mantém a atual; undefined = não mexe.
      if (body.onvifUsername !== undefined) {
        const videoUser = body.onvifUsername.trim();
        if (!videoUser) {
          const { onvifUsername: _u, onvifPasswordEnc: _p, onvifPort: _pt, ...rest } =
            newConfig;
          newConfig = rest;
        } else {
          newConfig = {
            ...newConfig,
            onvifUsername: videoUser,
            ...(body.onvifPassword
              ? { onvifPasswordEnc: encryptCameraSecret(body.onvifPassword) }
              : {}),
          };
          if (!newConfig.onvifPasswordEnc) {
            throw new BadRequestException(
              'Informe a senha ONVIF do vídeo ao vivo',
            );
          }
        }
      }
      if (body.onvifPort !== undefined && newConfig.onvifUsername) {
        newConfig = { ...newConfig, onvifPort: Number(body.onvifPort) || DEFAULT_ONVIF_PORT };
      }
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

    // Perfil de monitoramento: troca manual (profileId) ou overrides por métrica.
    // 'profileId' presente no body → atualiza o perfil e marca a fonte como manual.
    // null explícito → limpa a seleção manual e volta ao auto-detectado.
    if (body.profileId !== undefined) {
      // 'generic' explícito ou null → volta ao auto-detectado (mesma semântica).
      // Permite que o dropdown da UI ofereça "Genérico (MIB padrão)" como opção
      // de reset sem causar erro — GET /cftv/profiles inclui 'generic', o PATCH
      // deve aceitá-lo.
      const rawProfileId = body.profileId;
      const newProfileId =
        rawProfileId === null || rawProfileId === GENERIC_PROFILE.id ? null : rawProfileId;

      // Valida IDs desconhecidos (nem null/generic nem perfil do catálogo).
      if (newProfileId !== null) {
        const known = CAMERA_OID_PROFILES.find((p) => p.id === newProfileId);
        if (!known) {
          throw new BadRequestException(
            `ID de perfil desconhecido: "${newProfileId}". ` +
              `Perfis válidos: ${CAMERA_OID_PROFILES.map((p) => p.id).join(', ')} (ou null para detecção automática).`,
          );
        }
      }
      newConfig = {
        ...newConfig,
        profileId: newProfileId,
        profileSource: newProfileId ? 'manual' : 'generic',
      };
    }
    // 'profileOverrides' presente → substitui os overrides de métrica.
    // null explícito → limpa todos os overrides.
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
      include: { points: true, site: true, snmpCredential: true },
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

  /**
   * DELETE /cftv/cameras/:id/points/:pointId — remove um ponto SNMP individual
   * da câmera (para de coletar o OID e apaga alarmes/trends via cascade).
   *
   * Pontos essenciais (STATUS e eventos ONVIF) são protegidos.
   * Não requer confirmação de senha (análogo à remoção de porta de switch).
   */
  @Delete('cameras/:id/points/:pointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async deleteCameraPoint(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('pointId') pointId: string,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Apenas ADMIN ou CCO podem remover pontos de câmeras');
    }
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);

    const point = await this.prisma.devicePoint.findFirst({
      where: { id: pointId, deviceId: id },
    });
    if (!point) throw new NotFoundException('Ponto não encontrado nesta câmera');

    const b = (point.binding ?? {}) as { metric?: string };
    if (point.tag === 'STATUS' || b.metric === 'status') {
      throw new BadRequestException(
        'O ponto STATUS é essencial e não pode ser removido individualmente.',
      );
    }
    if (point.objectType === 'onvif') {
      throw new BadRequestException(
        'Pontos de eventos ONVIF não podem ser removidos individualmente.',
      );
    }

    await this.prisma.devicePoint.delete({ where: { id: pointId } });
    this.logger.log(
      `Ponto SNMP "${point.tag}" (${pointId}) da câmera ${id} removido por ${user.email}`,
    );

    await this.configPublisher.publishForDevice(id);
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
      manufacturer?: string;
      snmpHealth?: {
        enabled?: boolean;
        port?: number;
        snmpVersion?: '1' | '2c';
        community?: string;
      } | null;
    };
    const isOnvif = camera.protocol === ONVIF_PROTOCOL;

    // Parâmetros de conexão SNMP: câmera SNMP usa os campos principais
    // (credencial da tabela snmp_credential > Device.config); câmera ONVIF
    // usa o canal opcional de saúde (sempre v1/2c — precisa estar habilitado).
    let port: number;
    let snmpVersion: '1' | '2c' | '3';
    let community: string;
    let v3: ReturnType<typeof resolveSnmpRuntimeCredentials>['v3'];
    if (isOnvif) {
      if (!cfg.snmpHealth?.enabled) {
        throw new BadRequestException(
          'Esta câmera ONVIF não tem o monitoramento de saúde via SNMP habilitado',
        );
      }
      port = cfg.snmpHealth.port || DEFAULT_SNMP_PORT;
      snmpVersion = cfg.snmpHealth.snmpVersion === '1' ? '1' : '2c';
      community = cfg.snmpHealth.community?.trim() || 'public';
      v3 = null;
    } else {
      port = camera.port ?? DEFAULT_SNMP_PORT;
      const credential = await this.prisma.snmpCredential.findUnique({
        where: { deviceId: id },
      });
      const creds = resolveSnmpRuntimeCredentials(credential, cfg);
      snmpVersion = creds.snmpVersion;
      community = creds.community;
      v3 = creds.v3;
    }

    // OIDs atualmente cadastrados nos pontos (por métrica do binding).
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
      v3,
      current,
      candidates,
      diagnoseId: body?.diagnoseId,
      // Dicas de identificação: perfis do gateway aportam raízes de walk
      // proprietárias (conhecimento aditivo — nenhum ramo por fabricante).
      deviceType: camera.monitoredDeviceType ?? 'CAMERA',
      manufacturer: cfg.manufacturer?.trim() || undefined,
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

    // Descoberta separada da interpretação: TODOS os objetos do walk viram
    // candidatos — classificados quando a semântica é conhecida, "OID
    // desconhecido" (selecionável) quando não. Nada é descartado.
    const discovered = buildDiscoveredObjects(result.walk);

    // Enriquece OIDs "desconhecidos" com nomes das MIBs importadas pelo admin.
    // A classificação semântica (snmp-oid-semantics) sempre tem precedência —
    // o enriquecimento só preenche `mibName` quando `known` é null.
    // A MIB selected on the device is only a naming aid for this diagnosis.
    // Keep it scoped to the explicit choice; it never changes collection.
    await this.snmpMib.enrichDiscovered(
      discovered,
      camera.snmpMibId,
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
      const currentCfg = (camera.config ?? {}) as Record<string, unknown>;
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

    // Monta a visão por métrica: OID atual + candidatos testados.
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

    // Persiste nos pontos atuais a marca "não suportado pela câmera": com a
    // câmera comprovadamente respondendo (reachable), um OID cadastrado que
    // não respondeu não existe no firmware — a UI mostra isso em vez do
    // genérico "sem dados". Aplicar/editar um OID limpa a marca.
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
        tenantId: camera.tenantId,
        deviceId: id,
        trigger: 'manual',
        result,
      });
    } catch (err) {
      this.logger.warn(
        `Persistência da descoberta da câmera ${id} falhou: ${(err as Error).message}`,
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

        // Fontes de binding:
        // 1. canonicalMetrics do gateway (verificadas pelo gateway)
        // 2. metrics legacy (OIDs respondidos no catálogo estático)
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
          .filter((cm) => cm.oid)
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

        // Merge: canonical tem precedência (deduplicado por metricKey normalizado).
        const allResolved = [...resolvedFromCanonical];
        const canonicalKeys = new Set(resolvedFromCanonical.map((r) => normalizeMetricKey(r.metricKey)));
        for (const r of resolvedFromLegacy) {
          if (!canonicalKeys.has(normalizeMetricKey(r.metricKey))) {
            allResolved.push(r);
          }
        }

        await this.snmpMetric.persistAutoResolvedBindings({
          tenantId: camera.tenantId,
          deviceId: id,
          sysObjectId: result.sysObjectId,
          firmwareFamily,
          resolved: allResolved,
        });

        if (result.sysObjectId) {
          await this.snmpMetric.inheritBindingsFromSameModel({
            tenantId: camera.tenantId,
            deviceId: id,
            sysObjectId: result.sysObjectId,
            firmwareFamily,
          });
        }

        // Carrega bindings existentes (incluindo herdados) para as propostas.
        const existingBindings = await this.snmpMetric.getBindingsForProposals(id);
        const currentOidsByMetric: Record<string, string> = {};
        for (const m of metrics) {
          if (m.currentOid) currentOidsByMetric[normalizeMetricKey(m.metric)] = m.currentOid;
        }

        proposals = this.snmpMetric.buildProposals({
          tenantId: camera.tenantId,
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
          `Persistência de bindings/propostas da câmera ${id} falhou (não bloqueante): ${(err as Error).message}`,
        );
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
      /** Campo para frontend — shape: MetricProposal[] */
      proposals,
      /** @deprecated use proposals */
      metricProposals: proposals,
      walk: result.walk,
      walkStats: result.walkStats,
      discovered,
      discovery,
    };
  }

  /**
   * GET /cftv/cameras/:id/discovery-runs — histórico de runs de descoberta
   * (snapshot walk + diff + bindings quebrados). Últimos 10 runs.
   */
  @Get('cameras/:id/discovery-runs')
  @UseGuards(JwtAuthGuard)
  async listDiscoveryRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);
    return this.snmpDiscovery.listRuns(camera.tenantId, id);
  }

  /**
   * Descoberta automática (pós-cadastro): walk completo persistido como run.
   * Gated por canRunAutoDiscovery (máx. 1×/dia por device) e gateway online.
   * Nunca bloqueia o fluxo de cadastro — chamada fire-and-forget.
   */
  private async runAutoDiscovery(
    deviceId: string,
    trigger: 'registration' | 'scheduled',
  ): Promise<void> {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device?.gatewayId) return;
    if (this.deviceStatus.getStatus(device.gatewayId) === 'offline') return;
    if (!(await this.snmpDiscovery.canRunAutoDiscovery(deviceId))) return;

    const cfg = (device.config ?? {}) as { snmpVersion?: string; community?: string };
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
      deviceType: device.monitoredDeviceType ?? 'CAMERA',
    });
    if (!result.success) return;

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
  }

  /**
   * POST /cftv/cameras/:id/test-oid — lê o valor ATUAL de um OID via gateway
   * (teste ao vivo na descoberta, antes de aplicar). Retorna tipo ASN.1,
   * valor bruto e normalizado (com a escala da semântica, quando conhecida).
   */
  @Post('cameras/:id/test-oid')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async testOid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { oid?: string },
  ) {
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);

    // Câmera ONVIF usa o canal SNMP opcional de saúde; câmera SNMP usa os
    // parâmetros principais. Normaliza o config para o util compartilhado.
    let device = camera;
    if (camera.protocol === ONVIF_PROTOCOL) {
      const cfg = (camera.config ?? {}) as {
        snmpHealth?: {
          enabled?: boolean;
          port?: number;
          snmpVersion?: '1' | '2c';
          community?: string;
        } | null;
      };
      if (!cfg.snmpHealth?.enabled) {
        throw new BadRequestException(
          'Esta câmera ONVIF não tem o monitoramento de saúde via SNMP habilitado',
        );
      }
      device = {
        ...camera,
        port: cfg.snmpHealth.port || DEFAULT_SNMP_PORT,
        config: {
          snmpVersion: cfg.snmpHealth.snmpVersion === '1' ? '1' : '2c',
          community: cfg.snmpHealth.community?.trim() || 'public',
        },
      };
    }
    return runLiveOidTest(this.snmpHealthTest, this.deviceStatus, device, body?.oid);
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
    @Body()
    body: {
      oids?: Partial<Record<string, string | SnmpOidSelection>>;
      /** Objetos descobertos no walk selecionados como pontos (OIDs livres). */
      customPoints?: Array<{ oid?: string; name?: string; unit?: string }>;
      /**
       * Confiança marcada pelo cliente para os OIDs aplicados.
       * 'manual' = operador explicitamente escolheu este OID.
       * 'exact' = confirmação automática de proposta sugerida.
       * Padrão: 'manual' (aplica via UI = operador).
       */
      metricConfidence?: Partial<Record<string, 'exact' | 'inferred' | 'manual'>>;
    },
  ) {
    const camera = await this.findCameraOrThrow(id);
    this.assertCanEdit(user, camera.tenantId);

    // Aceita tanto métricas legacy (DIAG_METRICS) quanto canônicas.
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

    const catalog = buildDiagnoseCandidateCatalog();
    const points = await this.prisma.devicePoint.findMany({
      where: { deviceId: id },
    });
    const storageVolumes =
      (await this.snmpMetric?.getStorageVolumeBindings(id)) ?? [];

    // OIDs reprovados na validação de plausibilidade do último diagnóstico
    // NUNCA podem virar métrica canônica — nem via payload direto/forjado.
    const unconfirmedOids = new Set(
      Array.isArray((camera.config as Record<string, unknown> | null)?.snmpUnconfirmedOids)
        ? ((camera.config as Record<string, unknown>).snmpUnconfirmedOids as string[]).filter(
            (o): o is string => typeof o === 'string',
          )
        : [],
    );

    let cpuBindingTouched = false;
    for (const [metric, selection] of entries) {
      const oid = selection.oid;
      if (unconfirmedOids.has(oid)) {
        this.logger.warn(
          `OID ${oid} reprovado na plausibilidade — recusado como métrica '${metric}' na câmera ${id}`,
        );
        continue;
      }
      // Normaliza alias canônicos para o metricKey armazenado no ponto
      const normalizedMetric = normalizeMetricKey(metric);
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
            healthState: 'pending',
            healthReason: 'awaiting_read',
          };
          if (existingVolume) {
            await this.prisma.devicePoint.update({
              where: { id: existingVolume.id },
              data: {
                objectName: volume.label,
                unit: '%',
                binding: volumeBinding,
                lastValue: null,
                lastValueAt: null,
                lastValueState: 'waiting_event',
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
            lastValueState: 'waiting_event',
              },
            });
            points.push(created);
          }
        }
        continue;
      }
      // Procura ponto pelo metric original E pelo normalizado
      const point = points.find((p) => {
        const b = (p.binding ?? {}) as { metric?: string };
        return (
          b.metric === metric ||
          b.metric === normalizedMetric ||
          (typeof b.metric === 'string' && normalizeMetricKey(b.metric) === normalizedMetric)
        );
      });
      // Scale/unit vêm do catálogo quando o OID é conhecido; senão valor cru.
      const known = catalog.find((c) => (c.metric === metric || c.metric === normalizedMetric) && c.oid === oid);
      const scale = selection.scale ?? known?.scale ?? 1;
      const unit = selection.unit ?? known?.unit ?? '';
      const seedValue =
        typeof selection.seedValue === 'number' && Number.isFinite(selection.seedValue)
          ? selection.seedValue
          : null;
      if (!point) {
        // Métrica de saúde sem ponto — cria o ponto na hora.
        if (metric === 'uptime') continue; // uptime sempre existe em SNMP puro
        // Tenta meta legada primeiro, depois fallback genérico para canônicas.
        const meta = (HEALTH_METRIC_META as Record<string, { tag: string; objectName: string }>)[metric]
          ?? (HEALTH_METRIC_META as Record<string, { tag: string; objectName: string }>)[normalizedMetric]
          ?? { tag: metric.toUpperCase().replace(/_/g, ''), objectName: metric };
        const nextInstance = points.reduce((m, p) => Math.max(m, p.instance), -1) + 1;
        const created = await this.prisma.devicePoint.create({
          data: {
            deviceId: id,
            tag: meta.tag,
            objectName: meta.objectName,
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
      // OID recém-aplicado comprovadamente responde — limpa a marca.
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
      // Mantém o snapshot em memória coerente: applyCustomDiscoveredPoints
      // faz match por binding.oid — sem isto, o mesmo OID selecionado também
      // como custom criaria um segundo ponto (polling/card duplicados).
      (point as { binding: unknown }).binding = nextBinding;
    }

    // Objetos descobertos no walk selecionados como pontos de monitoramento:
    // match/create por binding.oid (métricas 'custom' colidem entre si).
    // OIDs reprovados na plausibilidade entram sem ponte canônica/rótulo
    // semântico (nunca rótulo errado).
    await applyCustomDiscoveredPoints(this.prisma, id, points, customPoints, unconfirmedOids);

    // Persiste bindings com confidência correta:
    // - metricConfidence='manual' → confidence='manual' (operador escolheu)
    // - metricConfidence='exact' → confidence='exact' (confirmação automática)
    for (const [metric, selection] of entries) {
      const oid = selection.oid;
      if (unconfirmedOids.has(oid)) continue;
      const normalizedMetric = normalizeMetricKey(metric);
      const known = catalog.find((c) => (c.metric === metric || c.metric === normalizedMetric) && c.oid === oid);
      const scale = selection.scale ?? known?.scale ?? 1;
      const unit = selection.unit ?? known?.unit ?? '';
      try {
        await this.snmpMetric.persistBinding({
          tenantId: camera.tenantId,
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
          `Falha ao persistir binding metric=${metric} oid=${oid} na câmera ${id}: ${(err as Error).message}`,
        );
      }
    }

    if (cpuBindingTouched) {
      await this.snmpMetric.syncCpuPeakPoint(id);
    }

    await this.configPublisher.publishForDevice(id);
    this.logger.log(
      `OIDs SNMP aplicados via diagnóstico na câmera ${id} por ${user.email}: ` +
        [
          ...entries.map(([m, o]) => `${m}=${o.oid}`),
          ...customPoints.map((c) => `custom=${c.oid}`),
        ].join(', '),
    );

    const updated = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true, snmpCredential: true },
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

  // ══════════════════════════════════════════════════════════════════════════════
  // Switches gerenciáveis — CRUD + sync de portas
  // ══════════════════════════════════════════════════════════════════════════════

  /** GET /cftv/switches — lista switches do tenant. */
  @Get('switches')
  @UseGuards(JwtAuthGuard)
  async listSwitches(@CurrentUser() user: AuthenticatedUser, @Query('tenantId') tenantId?: string) {
    const scopeTenantId = resolveTenantScope(user, tenantId);
    const switches = await this.prisma.device.findMany({
      where: { ...(scopeTenantId ? { tenantId: scopeTenantId } : {}), ...ONLY_SWITCH_DEVICES },
      include: { points: true, site: true },
      orderBy: { name: 'asc' },
    });
    const lastSeenMap = await this.deviceStatus.resolveLastSeenMany(switches.map((s) => s.id));
    return switches.map((sw) => this.mapSwitch(sw as Parameters<typeof this.mapSwitch>[0], lastSeenMap.get(sw.id) ?? null));
  }

  /** POST /cftv/switches — cadastra um switch. */
  @Post('switches')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async createSwitch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SwitchBody,
  ) {
    const name = body.name?.trim();
    const ip = body.ip?.trim();
    if (!name) throw new BadRequestException('name é obrigatório');
    if (!ip) throw new BadRequestException('ip é obrigatório');
    if (!body.gatewayId) throw new BadRequestException('gatewayId é obrigatório');

    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');

    // Garante que o gateway pertence ao tenant antes de qualquer I/O.
    await this.assertGatewayInTenant(body.gatewayId, tenantId);

    // Teste de alcançabilidade via SNMP antes de salvar.
    const testResult = await this.snmpHealthTest.test({
      tenantId,
      gatewayId: body.gatewayId,
      ip,
      port: body.port || DEFAULT_SNMP_PORT,
      snmpVersion: body.snmpVersion ?? '2c',
      community: body.community?.trim() || 'public',
      oids: { uptime: '1.3.6.1.2.1.1.3.0' }, // sysUpTime — probe universal
    });
    if (!testResult.success || !testResult.reachable) {
      throw new BadRequestException({
        message: testResult.success ? 'Switch não respondeu ao SNMP' : testResult.error,
        code: 'SWITCH_UNREACHABLE',
      });
    }

    const sw = await this.prisma.device.create({
      data: {
        name,
        protocol: SNMP_PROTOCOL,
        monitoredDeviceType: 'SWITCH',
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
          ...(body.profileId !== undefined ? { profileId: body.profileId } : {}),
          ...(body.profileOverrides !== undefined ? { profileOverrides: body.profileOverrides } : {}),
        },
        points: {
          create: DEFAULT_SWITCH_POINTS.map((p, i) => ({
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

    await this.configPublisher.publishForDevice(sw.id);
    this.logger.log(`Switch cadastrado: ${sw.id} (${ip}) por ${user.email}`);
    return this.mapSwitch(sw as Parameters<typeof this.mapSwitch>[0], null);
  }

  /** GET /cftv/switches/:id — detalhe de um switch com pontos e health. */
  @Get('switches/:id')
  @UseGuards(JwtAuthGuard)
  async getSwitch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const sw = await this.findSwitchOrThrow(id);
    const tenantScope = resolveTenantScope(user, sw.tenantId);
    if (tenantScope && tenantScope !== sw.tenantId) {
      throw new NotFoundException('Switch não encontrado');
    }
    const withPoints = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true },
    });
    const lastCommunication = await this.deviceStatus.resolveLastSeen(id);
    return this.mapSwitch(withPoints as Parameters<typeof this.mapSwitch>[0], lastCommunication);
  }

  /** PATCH /cftv/switches/:id — edita nome/site/rede/config SNMP e republica a config. */
  @Patch('switches/:id')
  @UseGuards(JwtAuthGuard)
  async updateSwitch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: SwitchBody,
  ) {
    const sw = await this.findSwitchOrThrow(id);
    this.assertCanEdit(user, sw.tenantId);

    // Se o corpo traz um novo gateway, valida que ele pertence ao mesmo tenant.
    if (body.gatewayId) {
      await this.assertGatewayInTenant(body.gatewayId, sw.tenantId);
    }

    const cfg = (sw.config ?? {}) as Record<string, unknown>;
    const updatedConfig = {
      ...cfg,
      ...(body.snmpVersion !== undefined ? { snmpVersion: body.snmpVersion } : {}),
      ...(body.community !== undefined ? { community: body.community?.trim() || 'public' } : {}),
      ...(body.pollingInterval !== undefined ? { pollingIntervalMs: body.pollingInterval * 1000 } : {}),
      ...(body.manufacturer !== undefined ? { manufacturer: body.manufacturer?.trim() || null } : {}),
      ...(body.profileId !== undefined ? { profileId: body.profileId } : {}),
      ...(body.profileOverrides !== undefined ? { profileOverrides: body.profileOverrides } : {}),
    };

    const updated = await this.prisma.device.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.siteId !== undefined ? { siteId: body.siteId || null } : {}),
        ...(body.gatewayId ? { gatewayId: body.gatewayId } : {}),
        ...(body.ip ? { ip: body.ip.trim() } : {}),
        ...(body.port !== undefined ? { port: body.port || DEFAULT_SNMP_PORT } : {}),
        config: updatedConfig as Prisma.InputJsonValue,
      },
      include: { points: true, site: true },
    });

    await this.configPublisher.publishForDevice(id);
    return this.mapSwitch(updated as Parameters<typeof this.mapSwitch>[0], await this.deviceStatus.resolveLastSeen(id));
  }

  /** DELETE /cftv/switches/:id — remove o switch e todos os seus pontos. */
  @Delete('switches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, SensitiveActionGuard)
  async deleteSwitch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const sw = await this.findSwitchOrThrow(id);
    this.assertCanEdit(user, sw.tenantId);
    await this.prisma.device.delete({ where: { id } });
    this.logger.log(`Switch removido: ${id} por ${user.email}`);
  }

  /**
   * POST /cftv/switches/:id/sync-ports — descobre portas do switch via IF-MIB e
   * sincroniza os DevicePoint do banco:
   *   - Portas novas: cria 3 pontos (sw-state, sw-in, sw-out).
   *   - Portas existentes com alias/nome alterados: atualiza objectName.
   *   - Portas não encontradas: retornadas em `removed` (NÃO deletadas).
   *   - Para cada nova porta de sw-state (if_oper_status): cria trend default.
   *
   * Retorna { added, updated, removed, sysDescr, ports }.
   */
  @Post('switches/:id/sync-ports')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async syncPorts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const sw = await this.findSwitchOrThrow(id);
    this.assertCanEdit(user, sw.tenantId);

    if (!sw.gatewayId) {
      throw new BadRequestException('Switch sem gateway associado');
    }

    const gwOnline = this.deviceStatus.getStatus(sw.gatewayId) === 'online';
    if (!gwOnline) {
      throw new BadRequestException('Gateway offline — não é possível descobrir portas agora');
    }

    const cfg = (sw.config ?? {}) as { snmpVersion?: string; community?: string; pollingIntervalMs?: number };

    const discoverResult = await this.switchPortSync.discoverPorts({
      tenantId: sw.tenantId,
      gatewayId: sw.gatewayId as string,
      ip: sw.ip as string,
      port: sw.port ?? DEFAULT_SNMP_PORT,
      snmpVersion: cfg.snmpVersion === '1' ? '1' : '2c',
      community: String(cfg.community ?? 'public'),
    });

    if (!discoverResult.success) {
      throw new BadRequestException({
        message: discoverResult.error ?? 'Falha na descoberta de portas',
        code: 'SWITCH_PORT_DISCOVER_FAILED',
      });
    }

    // Bug 3: loopback (ifType 24) some da lista; portas down ficam visíveis
    // mas NÃO ganham pontos automaticamente.
    const { visible: ports, creatable } = partitionDiscoveredPorts(discoverResult.ports);
    const { sysDescr } = discoverResult;

    // Carrega pontos de porta existentes (sw-state, sw-in, sw-out).
    const existingPortPoints = await this.prisma.devicePoint.findMany({
      where: {
        deviceId: id,
        objectType: { in: ['sw-state', 'sw-in', 'sw-out'] },
      },
    });

    // Mapeia ifIndex → pontos existentes.
    const existingByIndex = new Map<number, Array<typeof existingPortPoints[0]>>();
    for (const p of existingPortPoints) {
      const ifIndex = p.instance;
      if (ifIndex === null) continue;
      const arr = existingByIndex.get(ifIndex) ?? [];
      arr.push(p);
      existingByIndex.set(ifIndex, arr);
    }

    const discoveredIndexes = new Set(ports.map((p) => p.ifIndex));
    const existingIndexes = new Set(existingByIndex.keys());

    const toAdd = creatable.filter((p) => !existingIndexes.has(p.ifIndex));
    const toCheck = ports.filter((p) => existingIndexes.has(p.ifIndex));
    const removed = [...existingIndexes].filter((idx) => !discoveredIndexes.has(idx));

    let added = 0;
    let updated = 0;

    // Cria 3 pontos para cada nova porta descoberta.
    for (const port of toAdd) {
      const portLabel = port.ifAlias?.trim() || port.ifDescr?.trim() || `Porta ${port.ifIndex}`;
      const speedLabel = port.ifHighSpeed ? ` ${port.ifHighSpeed}Mbps` : '';
      const speedSuffix = speedLabel ? ` (${port.ifHighSpeed}Mbps)` : '';

      await this.prisma.device.update({
        where: { id },
        data: {
          points: {
            create: [
              {
                tag: `PORT_${port.ifIndex}_STATUS`,
                objectName: `${portLabel}${speedSuffix} — Status`,
                objectType: 'sw-state',
                instance: port.ifIndex,
                unit: '',
                binding: {
                  metric: 'if_oper_status',
                  collectionType: 'table',
                  ifIndex: port.ifIndex,
                },
              },
              {
                tag: `PORT_${port.ifIndex}_IN`,
                objectName: `${portLabel}${speedSuffix} — Tráfego entrada`,
                objectType: 'sw-in',
                instance: port.ifIndex,
                unit: 'B/s',
                binding: {
                  metric: 'if_in_octets',
                  collectionType: 'table',
                  ifIndex: port.ifIndex,
                },
              },
              {
                tag: `PORT_${port.ifIndex}_OUT`,
                objectName: `${portLabel}${speedSuffix} — Tráfego saída`,
                objectType: 'sw-out',
                instance: port.ifIndex,
                unit: 'B/s',
                binding: {
                  metric: 'if_out_octets',
                  collectionType: 'table',
                  ifIndex: port.ifIndex,
                },
              },
            ],
          },
        },
      });

      // Trend default para if_oper_status (histórico de estado da porta).
      // Auto-trends para if_in_octets / if_out_octets: NÃO (política de volume).
      const statusPoint = await this.prisma.devicePoint.findFirst({
        where: { deviceId: id, objectType: 'sw-state', instance: port.ifIndex },
      });
      if (statusPoint) {
        const existingTrend = await this.prisma.trend.findFirst({
          where: { pointId: statusPoint.id },
        });
        if (!existingTrend) {
          await this.prisma.trend.create({
            data: {
              pointId: statusPoint.id,
              tenantId: sw.tenantId,
              name: `${portLabel} — Status`,
              mode: 'ON_CHANGE',
              retentionDays: 90,
            },
          });
        }
      }

      added++;
    }

    // Atualiza objectName de portas existentes com alias/nome alterados.
    for (const port of toCheck) {
      const portLabel = port.ifAlias?.trim() || port.ifDescr?.trim() || `Porta ${port.ifIndex}`;
      const speedSuffix = port.ifHighSpeed ? ` (${port.ifHighSpeed}Mbps)` : '';
      const existingPoints = existingByIndex.get(port.ifIndex) ?? [];

      for (const p of existingPoints) {
        let expectedName: string;
        if (p.objectType === 'sw-state') expectedName = `${portLabel}${speedSuffix} — Status`;
        else if (p.objectType === 'sw-in') expectedName = `${portLabel}${speedSuffix} — Tráfego entrada`;
        else expectedName = `${portLabel}${speedSuffix} — Tráfego saída`;

        if (p.objectName !== expectedName) {
          await this.prisma.devicePoint.update({
            where: { id: p.id },
            data: { objectName: expectedName },
          });
          updated++;
        }
      }
    }

    // Republica a config do switch para o gateway (pontos novos/atualizados).
    await this.configPublisher.publishForDevice(id);

    this.logger.log(
      `Switch ${id} sync-ports: +${added} portas, ${updated} atualizadas, ` +
        `${removed.length} a remover`,
    );

    return {
      success: true as const,
      added,
      updated,
      removed,
      sysDescr,
      ports: ports.map((p) => ({
        ifIndex: p.ifIndex,
        ifDescr: p.ifDescr,
        ifAlias: p.ifAlias,
        ifType: p.ifType,
        ifHighSpeed: p.ifHighSpeed,
        ifOperStatus: p.ifOperStatus,
        existsInDb: existingIndexes.has(p.ifIndex),
      })),
    };
  }

  /**
   * DELETE /cftv/switches/:id/ports/:ifIndex — remove todos os pontos de uma
   * porta específica (sw-state, sw-in, sw-out) após confirmação de senha.
   */
  @Delete('switches/:id/ports/:ifIndex')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, SensitiveActionGuard)
  async deletePort(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('ifIndex') ifIndexStr: string,
  ) {
    const ifIndex = Number(ifIndexStr);
    if (!Number.isFinite(ifIndex) || ifIndex <= 0) {
      throw new BadRequestException('ifIndex inválido');
    }
    const sw = await this.findSwitchOrThrow(id);
    this.assertCanEdit(user, sw.tenantId);

    await this.prisma.devicePoint.deleteMany({
      where: {
        deviceId: id,
        objectType: { in: ['sw-state', 'sw-in', 'sw-out'] },
        instance: ifIndex,
      },
    });

    await this.configPublisher.publishForDevice(id);
    this.logger.log(`Switch ${id} porta ifIndex=${ifIndex} removida por ${user.email}`);
  }

  /** POST /cftv/switches/:id/probe-capabilities — executa probe de capacidades. */
  @Post('switches/:id/probe-capabilities')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async probeSwitchCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const sw = await this.findSwitchOrThrow(id);
    this.assertCanEdit(user, sw.tenantId);
    return this.capabilityProbe.probeDevice(id);
  }

  /** GET /cftv/switches/:id/capabilities — lê capacidades salvas do switch. */
  @Get('switches/:id/capabilities')
  @UseGuards(JwtAuthGuard)
  async getSwitchCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const sw = await this.findSwitchOrThrow(id);
    this.assertCanEdit(user, sw.tenantId);
    const maps = await this.prisma.deviceCapabilityMap.findMany({
      where: { deviceId: id },
      orderBy: { metricKey: 'asc' },
    });
    return maps.map((m) => ({
      metricKey: m.metricKey,
      state: m.state,
      probeValue: m.probeValue ?? null,
      profileId: m.profileId ?? null,
      lastProbeAt: m.lastProbeAt?.toISOString() ?? null,
    }));
  }

  // ─── NVRs/DVRs gerenciáveis (SNMP) ─────────────────────────────────────────

  /** GET /cftv/nvrs — lista NVRs/DVRs do tenant. */
  @Get('nvrs')
  @UseGuards(JwtAuthGuard)
  async listNvrs(@CurrentUser() user: AuthenticatedUser, @Query('tenantId') tenantId?: string) {
    const scopeTenantId = resolveTenantScope(user, tenantId);
    const nvrs = await this.prisma.device.findMany({
      where: { ...(scopeTenantId ? { tenantId: scopeTenantId } : {}), ...ONLY_NVR_DEVICES },
      include: { points: true, site: true },
      orderBy: { name: 'asc' },
    });
    const lastSeenMap = await this.deviceStatus.resolveLastSeenMany(nvrs.map((n) => n.id));
    return nvrs.map((nvr) => this.mapNvr(nvr as Parameters<typeof this.mapNvr>[0], lastSeenMap.get(nvr.id) ?? null));
  }

  /** POST /cftv/nvrs — cadastra um NVR/DVR. */
  @Post('nvrs')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async createNvr(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: NvrBody,
  ) {
    const name = body.name?.trim();
    const ip = body.ip?.trim();
    if (!name) throw new BadRequestException('name é obrigatório');
    if (!ip) throw new BadRequestException('ip é obrigatório');
    if (!body.gatewayId) throw new BadRequestException('gatewayId é obrigatório');

    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');

    await this.assertGatewayInTenant(body.gatewayId, tenantId);

    // Teste de alcançabilidade via SNMP antes de salvar.
    const testResult = await this.snmpHealthTest.test({
      tenantId,
      gatewayId: body.gatewayId,
      ip,
      port: body.port || DEFAULT_SNMP_PORT,
      snmpVersion: body.snmpVersion ?? '2c',
      community: body.community?.trim() || 'public',
      oids: { uptime: '1.3.6.1.2.1.1.3.0' },
    });
    if (!testResult.success || !testResult.reachable) {
      throw new BadRequestException({
        message: testResult.success ? 'NVR não respondeu ao SNMP' : testResult.error,
        code: 'NVR_UNREACHABLE',
      });
    }

    const nvr = await this.prisma.device.create({
      data: {
        name,
        protocol: SNMP_PROTOCOL,
        monitoredDeviceType: 'NVR',
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
          ...(body.profileId !== undefined ? { profileId: body.profileId } : {}),
          ...(body.profileOverrides !== undefined ? { profileOverrides: body.profileOverrides } : {}),
        },
        points: {
          create: DEFAULT_NVR_POINTS.map((p, i) => ({
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

    await this.configPublisher.publishForDevice(nvr.id);
    this.logger.log(`NVR cadastrado: ${nvr.id} (${ip}) por ${user.email}`);
    return this.mapNvr(nvr as Parameters<typeof this.mapNvr>[0], null);
  }

  /** GET /cftv/nvrs/:id — detalhe de um NVR com pontos e health. */
  @Get('nvrs/:id')
  @UseGuards(JwtAuthGuard)
  async getNvr(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const nvr = await this.findNvrOrThrow(id);
    const tenantScope = resolveTenantScope(user, nvr.tenantId);
    if (tenantScope && tenantScope !== nvr.tenantId) {
      throw new NotFoundException('NVR não encontrado');
    }
    const withPoints = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { points: true, site: true },
    });
    const lastCommunication = await this.deviceStatus.resolveLastSeen(id);
    return this.mapNvr(withPoints as Parameters<typeof this.mapNvr>[0], lastCommunication);
  }

  /** PATCH /cftv/nvrs/:id — edita nome/site/rede/config SNMP. */
  @Patch('nvrs/:id')
  @UseGuards(JwtAuthGuard)
  async updateNvr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: NvrBody,
  ) {
    const nvr = await this.findNvrOrThrow(id);
    this.assertCanEdit(user, nvr.tenantId);

    if (body.gatewayId) {
      await this.assertGatewayInTenant(body.gatewayId, nvr.tenantId);
    }

    const cfg = (nvr.config ?? {}) as Record<string, unknown>;
    const updatedConfig = {
      ...cfg,
      ...(body.snmpVersion !== undefined ? { snmpVersion: body.snmpVersion } : {}),
      ...(body.community !== undefined ? { community: body.community?.trim() || 'public' } : {}),
      ...(body.pollingInterval !== undefined ? { pollingIntervalMs: body.pollingInterval * 1000 } : {}),
      ...(body.manufacturer !== undefined ? { manufacturer: body.manufacturer?.trim() || null } : {}),
      ...(body.profileId !== undefined ? { profileId: body.profileId } : {}),
      ...(body.profileOverrides !== undefined ? { profileOverrides: body.profileOverrides } : {}),
    };

    const updated = await this.prisma.device.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.siteId !== undefined ? { siteId: body.siteId || null } : {}),
        ...(body.gatewayId ? { gatewayId: body.gatewayId } : {}),
        ...(body.ip ? { ip: body.ip.trim() } : {}),
        ...(body.port !== undefined ? { port: body.port || DEFAULT_SNMP_PORT } : {}),
        config: updatedConfig as Prisma.InputJsonValue,
      },
      include: { points: true, site: true },
    });

    await this.configPublisher.publishForDevice(id);
    return this.mapNvr(updated as Parameters<typeof this.mapNvr>[0], await this.deviceStatus.resolveLastSeen(id));
  }

  /** DELETE /cftv/nvrs/:id — remove o NVR e todos os seus pontos. */
  @Delete('nvrs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, SensitiveActionGuard)
  async deleteNvr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const nvr = await this.findNvrOrThrow(id);
    this.assertCanEdit(user, nvr.tenantId);
    await this.prisma.device.delete({ where: { id } });
    this.logger.log(`NVR removido: ${id} por ${user.email}`);
  }

  /**
   * POST /cftv/nvrs/:id/sync-disks — descobre discos e canais via SNMP e
   * sincroniza os DevicePoint do banco:
   *   - Disco novo: cria 3 pontos por slot (nvr-disk, nvr-disk-cap, nvr-disk-used).
   *   - Canal novo: cria 1 ponto por canal (nvr-chan).
   *   - Pontos existentes: atualiza objectName e lastValue/lastValueAt.
   *   - Para cada novo ponto nvr-disk (disk_status): cria trend default.
   *
   * Normalização Hikvision: disk_used = capacity - freeValue (nunca expõe freeGb à UI).
   *
   * Retorna { added, updatedDisks, updatedChannels, sysDescr, disks, channels }.
   */
  @Post('nvrs/:id/sync-disks')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async syncNvrDisks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const nvr = await this.findNvrOrThrow(id);
    this.assertCanEdit(user, nvr.tenantId);

    if (!nvr.gatewayId) {
      throw new BadRequestException('NVR sem gateway associado');
    }

    const gwOnline = this.deviceStatus.getStatus(nvr.gatewayId) === 'online';
    if (!gwOnline) {
      throw new BadRequestException('Gateway offline — não é possível descobrir discos agora');
    }

    const cfg = (nvr.config ?? {}) as {
      snmpVersion?: string;
      community?: string;
      manufacturer?: string | null;
      profileId?: string | null;
      profileSource?: string;
    };

    // ── Resolução do perfil vendor ────────────────────────────────────────────
    //
    // Só perfis com entradas em NVR_TABLE_OIDS são considerados "vendor" para fins
    // de tabela. 'base-nvr' (GENERIC_NVR_PROFILE.id) NÃO está nessa tabela — seria
    // tratado como "sem perfil", causando OIDs vazios e descoberta silenciosa vazia.
    //
    // Estratégia em duas etapas:
    //   1. Se há profileId vendor no config (definido manualmente ou por probe
    //      anterior) → usa diretamente com os OIDs corretos em uma só chamada.
    //   2. Se não há → primeira chamada com OIDs vazios apenas para obter sysDescr.
    //      Se o gateway retornar sysDescr que identifica um fabricante, faz uma
    //      segunda chamada com os OIDs vendor corretos E persiste o profileId.
    const hasVendorOids = (id: string | null | undefined): id is string =>
      !!id && id in NVR_TABLE_OIDS;

    const buildOids = (
      profileId: string | null,
    ): { disk: NvrDiskTableOids; channel: NvrChannelTableOids } => {
      const entry = profileId ? NVR_TABLE_OIDS[profileId] : undefined;
      return { disk: entry?.disk ?? {}, channel: entry?.channel ?? {} };
    };

    // Resolve profileId: config explícito > hint por manufacturer > nenhum.
    let resolvedProfileId: string | null = hasVendorOids(cfg.profileId) ? cfg.profileId : null;
    if (!resolvedProfileId && cfg.manufacturer) {
      const byMfr = detectNvrProfile(null, null, cfg.manufacturer);
      if (hasVendorOids(byMfr.id)) resolvedProfileId = byMfr.id;
    }

    // Parâmetros SNMP compartilhados entre as duas chamadas.
    const snmpTarget = {
      tenantId: nvr.tenantId,
      gatewayId: nvr.gatewayId as string,
      ip: nvr.ip as string,
      port: nvr.port ?? DEFAULT_SNMP_PORT,
      snmpVersion: (cfg.snmpVersion === '1' ? '1' : '2c') as '1' | '2c',
      community: String(cfg.community ?? 'public'),
    };

    // Primeira chamada: com OIDs vendor se conhecidos, ou vazia (só sysDescr).
    let tableOids = buildOids(resolvedProfileId);
    let discoverResult = await this.nvrTableSync.discoverNvrTables({
      ...snmpTarget,
      diskTableOids: tableOids.disk,
      channelTableOids: tableOids.channel,
    });

    if (!discoverResult.success) {
      throw new BadRequestException({
        message: discoverResult.error ?? 'Falha na descoberta de discos/canais',
        code: 'NVR_DISK_DISCOVER_FAILED',
      });
    }

    // ── Detecção via sysDescr (segunda chamada — só quando necessário) ────────
    //
    // Se não havia perfil vendor e o gateway retornou sysDescr útil:
    // tenta identificar o fabricante e re-descobre com OIDs corretos.
    // Persiste o profileId detectado para evitar re-detecção no próximo sync.
    if (!resolvedProfileId && discoverResult.sysDescr) {
      const detected = detectNvrProfile(discoverResult.sysDescr, null, cfg.manufacturer ?? null);
      if (hasVendorOids(detected.id)) {
        resolvedProfileId = detected.id;
        tableOids = buildOids(resolvedProfileId);

        // Segunda chamada com OIDs vendor corretos.
        const rediscoverResult = await this.nvrTableSync.discoverNvrTables({
          ...snmpTarget,
          diskTableOids: tableOids.disk,
          channelTableOids: tableOids.channel,
        });
        if (rediscoverResult.success) {
          discoverResult = rediscoverResult;
        }

        // Persiste profileId detectado (não sobrescreve seleção manual).
        if (cfg.profileSource !== 'manual') {
          await this.prisma.device.update({
            where: { id },
            data: {
              config: {
                ...(nvr.config as Record<string, unknown> ?? {}),
                profileId: resolvedProfileId,
                profileSource: 'detected',
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
    }

    const { disks: discoveredDisks, channels: discoveredChannels, sysDescr } = discoverResult;

    // diskScale resolvido aqui para que a resposta imediata use os mesmos valores GB
    // que foram persistidos — Hikvision (hikDiskTable oficial) envia MB (scale 0.001 → GB).
    const diskScaleForResponse: number = tableOids.disk.diskScale ?? 1;

    // Dahua/Intelbras oficial: physicalVolumeUsage é USO EM % (0–100), não GB.
    // O ponto disk_used é criado com unit '%' e o valor NÃO recebe diskScale.
    const usedIsPercent: boolean = tableOids.disk.usedIsPercent === true;

    // Carrega pontos de disco/canal existentes.
    const existingDiskPoints = await this.prisma.devicePoint.findMany({
      where: { deviceId: id, objectType: { in: ['nvr-disk', 'nvr-disk-cap', 'nvr-disk-used'] } },
    });
    const existingChanPoints = await this.prisma.devicePoint.findMany({
      where: { deviceId: id, objectType: 'nvr-chan' },
    });

    // Mapeia slotIndex → pontos existentes.
    const diskBySlot = new Map<number, { status?: typeof existingDiskPoints[0]; cap?: typeof existingDiskPoints[0]; used?: typeof existingDiskPoints[0] }>();
    for (const p of existingDiskPoints) {
      const slot = p.instance;
      if (slot === null) continue;
      const entry = diskBySlot.get(slot) ?? {};
      if (p.objectType === 'nvr-disk') entry.status = p;
      else if (p.objectType === 'nvr-disk-cap') entry.cap = p;
      else if (p.objectType === 'nvr-disk-used') entry.used = p;
      diskBySlot.set(slot, entry);
    }

    const chanByIdx = new Map<number, typeof existingChanPoints[0]>();
    for (const p of existingChanPoints) {
      if (p.instance !== null) chanByIdx.set(p.instance, p);
    }

    let added = 0;
    let updatedDisks = 0;
    let updatedChannels = 0;

    const now = new Date();

    // diskScale: fator de conversão de unidade para disco (padrão 1 = GB nativo).
    // Dahua/Intelbras reportam MB → 0.001; Hikvision reporta GB → 1.
    const diskScale: number = tableOids.disk.diskScale ?? 1;

    for (const disk of discoveredDisks) {
      const { slotIndex, status, capacityValue, usedValue, freeValue } = disk;

      // Aplica scale nos valores brutos ANTES de persistir.
      // O gateway receberá o `scale` no binding e também o aplicará na telemetria.
      // usedIsPercent (Dahua/Intelbras oficial): usedValue já é % — sem scale.
      const scaledCapacity: number | null = capacityValue !== null ? capacityValue * diskScale : null;
      const scaledFree: number | null     = freeValue    !== null ? freeValue    * diskScale : null;
      const scaledUsed: number | null     =
        usedValue !== null ? (usedIsPercent ? usedValue : usedValue * diskScale) : null;

      // Normaliza espaço usado: Hikvision usa freeValue, outros usedValue.
      // disk_used = capacity - free (Hikvision); disk_used = used (outros).
      // Ambos os lados já estão em GB (após a aplicação do diskScale).
      const normalizedUsed: number | null =
        scaledFree !== null && scaledCapacity !== null
          ? scaledCapacity - scaledFree
          : scaledUsed;

      const existing = diskBySlot.get(slotIndex);

      if (!existing) {
        // Cria 3 pontos novos.
        // `scale` no binding é lido pelo config-publisher e enviado ao gateway;
        // o driver usa-o na telemetria contínua para converter MB→GB.
        await this.prisma.device.update({
          where: { id },
          data: {
            points: {
              create: [
                {
                  tag: `DISCO_${slotIndex}_STATUS`,
                  objectName: `Disco ${slotIndex} — Status`,
                  objectType: 'nvr-disk',
                  instance: slotIndex,
                  unit: '',
                  binding: {
                    metric: 'disk_status',
                    collectionType: 'table',
                    slotIndex,
                    tableOidPrefix: tableOids.disk.status ?? null,
                    // Status não tem scale (é enumeração).
                  },
                  ...(status !== null ? { lastValue: status, lastValueAt: now } : {}),
                },
                {
                  tag: `DISCO_${slotIndex}_CAP`,
                  objectName: `Disco ${slotIndex} — Capacidade`,
                  objectType: 'nvr-disk-cap',
                  instance: slotIndex,
                  unit: 'GB',
                  binding: {
                    metric: 'disk_capacity',
                    collectionType: 'table',
                    slotIndex,
                    tableOidPrefix: tableOids.disk.capacityGb ?? null,
                    // scale permite ao gateway converter MB→GB na telemetria contínua.
                    ...(diskScale !== 1 ? { scale: diskScale } : {}),
                  },
                  ...(scaledCapacity !== null ? { lastValue: scaledCapacity, lastValueAt: now } : {}),
                },
                {
                  tag: `DISCO_${slotIndex}_USADO`,
                  objectName: usedIsPercent
                    ? `Disco ${slotIndex} — Uso (%)`
                    : `Disco ${slotIndex} — Espaço usado`,
                  objectType: 'nvr-disk-used',
                  instance: slotIndex,
                  // Dahua/Intelbras oficial reporta USO em % (physicalVolumeUsage).
                  unit: usedIsPercent ? '%' : 'GB',
                  binding: {
                    metric: 'disk_used',
                    collectionType: 'table',
                    slotIndex,
                    // disk_used não tem OID próprio na Hikvision (derivado no driver):
                    // tableOidPrefix só presente para Dahua/Intelbras.
                    tableOidPrefix: tableOids.disk.usedGb ?? null,
                    // Percentual não recebe scale (valor 0–100 já é final).
                    ...(!usedIsPercent && diskScale !== 1 ? { scale: diskScale } : {}),
                  },
                  ...(normalizedUsed !== null ? { lastValue: normalizedUsed, lastValueAt: now } : {}),
                },
              ],
            },
          },
        });

        // Trend default para disk_status (histórico de estado).
        const statusPoint = await this.prisma.devicePoint.findFirst({
          where: { deviceId: id, objectType: 'nvr-disk', instance: slotIndex },
        });
        if (statusPoint) {
          const existing = await this.prisma.trend.findFirst({ where: { pointId: statusPoint.id } });
          if (!existing) {
            await this.prisma.trend.create({
              data: {
                pointId: statusPoint.id,
                tenantId: nvr.tenantId,
                name: `Disco ${slotIndex} — Status`,
                mode: 'ON_CHANGE',
                retentionDays: 90,
              },
            });
          }
        }

        added++;
      } else {
        // Atualiza lastValue dos pontos existentes (valores já em GB após diskScale).
        if (existing.status && status !== null) {
          await this.prisma.devicePoint.update({
            where: { id: existing.status.id },
            data: { lastValue: status, lastValueAt: now },
          });
        }
        if (existing.cap && scaledCapacity !== null) {
          await this.prisma.devicePoint.update({
            where: { id: existing.cap.id },
            data: { lastValue: scaledCapacity, lastValueAt: now },
          });
        }
        if (existing.used && normalizedUsed !== null) {
          await this.prisma.devicePoint.update({
            where: { id: existing.used.id },
            data: { lastValue: normalizedUsed, lastValueAt: now },
          });
        }
        updatedDisks++;
      }
    }

    // Canais de gravação.
    for (const chan of discoveredChannels) {
      const { channelIndex, status } = chan;
      const existingChan = chanByIdx.get(channelIndex);

      if (!existingChan) {
        await this.prisma.device.update({
          where: { id },
          data: {
            points: {
              create: [
                {
                  tag: `CANAL_${channelIndex}_STATUS`,
                  objectName: `Canal ${channelIndex} — Status`,
                  objectType: 'nvr-chan',
                  instance: channelIndex,
                  unit: '',
                  binding: {
                    metric: 'channel_status',
                    collectionType: 'table',
                    channelIndex,
                    tableOidPrefix: tableOids.channel.status ?? null,
                  },
                  ...(status !== null ? { lastValue: status, lastValueAt: now } : {}),
                },
              ],
            },
          },
        });
        added++;
      } else {
        if (status !== null) {
          await this.prisma.devicePoint.update({
            where: { id: existingChan.id },
            data: { lastValue: status, lastValueAt: now },
          });
          updatedChannels++;
        }
      }
    }

    // Republica a config para o gateway (novos pontos/bindings).
    await this.configPublisher.publishForDevice(id);

    this.logger.log(
      `NVR ${id} sync-disks: +${added} pontos, ${updatedDisks} discos atualizados, ` +
        `${updatedChannels} canais atualizados`,
    );

    const diskStatusLabels: Record<number, string> = {
      0: 'sem disco',
      1: 'normal',
      2: 'erro',
      3: 'não formatado',
      4: 'inicializando',
    };
    const chanStatusLabels: Record<number, string> = {
      0: 'offline',
      1: 'idle',
      2: 'gravando',
      3: 'alarme',
    };

    return {
      success: true as const,
      added,
      updatedDisks,
      updatedChannels,
      sysDescr: sysDescr ?? null,
      disks: discoveredDisks.map((d) => {
        // Normaliza uso: Hikvision fornece disk_free; Dahua/Intelbras fornecem disk_used.
        const rawUsed: number | null =
          d.freeValue !== null && d.capacityValue !== null
            ? d.capacityValue - d.freeValue
            : d.usedValue;
        // Aplica diskScale para alinhar unidade da resposta com os pontos persistidos:
        // Hikvision (hikDiskTable) reporta MB (diskScale=0.001), Dahua reporta GB (=1).
        // usedIsPercent (Dahua/Intelbras): rawUsed já é % — sem scale.
        const capacityGb = d.capacityValue !== null ? d.capacityValue * diskScaleForResponse : null;
        const usedGb =
          rawUsed !== null ? (usedIsPercent ? rawUsed : rawUsed * diskScaleForResponse) : null;
        return {
          slotIndex: d.slotIndex,
          status: d.status,
          statusLabel: d.status !== null ? (diskStatusLabels[d.status] ?? String(d.status)) : null,
          capacityGb,
          usedGb,
          // Unidade do campo `usedGb` (% para Dahua/Intelbras oficial, GB demais).
          usedUnit: usedIsPercent ? ('%' as const) : ('GB' as const),
        };
      }),
      channels: discoveredChannels.map((c) => ({
        channelIndex: c.channelIndex,
        status: c.status,
        statusLabel: c.status !== null ? (chanStatusLabels[c.status] ?? String(c.status)) : null,
      })),
    };
  }

  /** POST /cftv/nvrs/:id/probe-capabilities — executa probe de capacidades. */
  @Post('nvrs/:id/probe-capabilities')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async probeNvrCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const nvr = await this.findNvrOrThrow(id);
    this.assertCanEdit(user, nvr.tenantId);
    return this.capabilityProbe.probeDevice(id);
  }

  /** GET /cftv/nvrs/:id/capabilities — lê capacidades salvas do NVR. */
  @Get('nvrs/:id/capabilities')
  @UseGuards(JwtAuthGuard)
  async getNvrCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const nvr = await this.findNvrOrThrow(id);
    this.assertCanEdit(user, nvr.tenantId);
    const maps = await this.prisma.deviceCapabilityMap.findMany({
      where: { deviceId: id },
      orderBy: { metricKey: 'asc' },
    });
    return maps.map((m) => ({
      metricKey: m.metricKey,
      state: m.state,
      probeValue: m.probeValue ?? null,
      profileId: m.profileId ?? null,
      lastProbeAt: m.lastProbeAt?.toISOString() ?? null,
    }));
  }

  // ── private helpers para NVRs ──────────────────────────────────────────────

  private async findNvrOrThrow(id: string) {
    const nvr = await this.prisma.device.findFirst({
      where: { id, ...ONLY_NVR_DEVICES },
    });
    if (!nvr) throw new NotFoundException('NVR não encontrado');
    return nvr;
  }

  private mapNvr(
    nvr: Prisma.DeviceGetPayload<{ include: { points: true; site: true } }>,
    lastCommunication: string | null,
  ) {
    const cfg = (nvr.config ?? {}) as {
      snmpVersion?: string;
      community?: string;
      pollingIntervalMs?: number;
      manufacturer?: string | null;
      profileId?: string | null;
      profileSource?: string;
      profileOverrides?: Record<string, string> | null;
    };

    const gatewayOnline: boolean | null = nvr.gatewayId
      ? this.deviceStatus.getStatus(nvr.gatewayId) === 'online'
      : null;

    const scalarPoints = nvr.points.filter(
      (p) => !['nvr-disk', 'nvr-disk-cap', 'nvr-disk-used', 'nvr-chan'].includes(p.objectType ?? ''),
    );
    const diskPoints = nvr.points.filter((p) => ['nvr-disk', 'nvr-disk-cap', 'nvr-disk-used'].includes(p.objectType ?? ''));
    const chanPoints = nvr.points.filter((p) => p.objectType === 'nvr-chan');

    // Agrupa pontos de disco por slotIndex.
    const diskBySlot = new Map<number, {
      slotIndex: number;
      statusPoint: typeof diskPoints[0] | null;
      capPoint: typeof diskPoints[0] | null;
      usedPoint: typeof diskPoints[0] | null;
    }>();
    for (const p of diskPoints) {
      const slot = p.instance;
      if (slot === null) continue;
      const entry = diskBySlot.get(slot) ?? { slotIndex: slot, statusPoint: null, capPoint: null, usedPoint: null };
      if (p.objectType === 'nvr-disk') entry.statusPoint = p;
      else if (p.objectType === 'nvr-disk-cap') entry.capPoint = p;
      else if (p.objectType === 'nvr-disk-used') entry.usedPoint = p;
      diskBySlot.set(slot, entry);
    }

    const diskStatusLabels: Record<number, string> = {
      0: 'sem disco', 1: 'normal', 2: 'erro', 3: 'não formatado', 4: 'inicializando',
    };
    const chanStatusLabels: Record<number, string> = {
      0: 'offline', 1: 'idle', 2: 'gravando', 3: 'alarme',
    };

    return {
      id: nvr.id,
      name: nvr.name,
      ip: nvr.ip,
      port: nvr.port,
      protocol: nvr.protocol,
      monitoredDeviceType: 'NVR',
      snmpVersion: cfg.snmpVersion ?? '2c',
      community: cfg.community ?? 'public',
      pollingInterval: cfg.pollingIntervalMs ? cfg.pollingIntervalMs / 1000 : DEFAULT_POLLING_S,
      manufacturer: cfg.manufacturer ?? null,
      profileId: cfg.profileId ?? null,
      profileLabel: resolveNvrProfileLabel(cfg.profileId ?? null),
      profileSource: cfg.profileSource ?? 'generic',
      profileOverrides: cfg.profileOverrides ?? null,
      site: nvr.site?.name ?? '',
      siteId: nvr.siteId,
      tenantId: nvr.tenantId,
      gatewayId: nvr.gatewayId,
      gatewayOnline,
      status: this.deviceStatus.getStatus(nvr.id),
      critical: nvr.critical,
      lastCommunication,
      // Pontos escalares (STATUS, UPTIME, CPU, MEMORIA, TEMPERATURA).
      points: scalarPoints.map((p) => {
        const b = (p.binding ?? {}) as { metric?: string; oid?: string | null; unsupported?: boolean };
        const metric = b.metric ?? 'custom';
        return {
          id: p.id,
          tag: p.tag,
          objectName: p.objectName,
          metric,
          oid: b.oid ?? null,
          unsupported: Boolean(b.unsupported),
          unit: p.unit ?? '',
          critical: p.critical,
          lastValue: p.lastValue ?? null,
          lastValueAt: p.lastValueAt ? p.lastValueAt.toISOString() : null,
          lastValueState: p.lastValueState ?? null,
          display: buildSnmpCardDisplay({
            tag: p.tag,
            objectName: p.objectName,
            metric,
            oid: b.oid ?? null,
            unit: p.unit ?? null,
          }),
        };
      }),
      snmpInfo: ((nvr.config ?? {}) as { snmpInfo?: unknown }).snmpInfo as SnmpInfoEntry[] | undefined,
      // Discos sincronizados (agrupados por slotIndex).
      disks: [...diskBySlot.values()]
        .sort((a, b) => a.slotIndex - b.slotIndex)
        .map((entry) => ({
          slotIndex: entry.slotIndex,
          statusPoint: entry.statusPoint ? {
            id: entry.statusPoint.id,
            tag: entry.statusPoint.tag,
            lastValue: entry.statusPoint.lastValue ?? null,
            statusLabel: entry.statusPoint.lastValue !== null
              ? (diskStatusLabels[Number(entry.statusPoint.lastValue)] ?? String(entry.statusPoint.lastValue))
              : null,
          } : null,
          capPoint: entry.capPoint ? {
            id: entry.capPoint.id,
            tag: entry.capPoint.tag,
            lastValue: entry.capPoint.lastValue ?? null,
            unit: entry.capPoint.unit ?? 'GB',
          } : null,
          usedPoint: entry.usedPoint ? {
            id: entry.usedPoint.id,
            tag: entry.usedPoint.tag,
            lastValue: entry.usedPoint.lastValue ?? null,
            // '%' para Dahua/Intelbras (physicalVolumeUsage), 'GB' demais.
            unit: entry.usedPoint.unit ?? 'GB',
          } : null,
        })),
      // Canais de gravação sincronizados.
      channels: chanPoints
        .filter((p) => p.instance !== null)
        .sort((a, b) => (a.instance ?? 0) - (b.instance ?? 0))
        .map((p) => ({
          channelIndex: p.instance!,
          pointId: p.id,
          lastValue: p.lastValue ?? null,
          statusLabel: p.lastValue !== null
            ? (chanStatusLabels[Number(p.lastValue)] ?? String(p.lastValue))
            : null,
        })),
    };
  }

  // ── private helpers para switches ─────────────────────────────────────────

  private async findSwitchOrThrow(id: string) {
    const sw = await this.prisma.device.findFirst({
      where: { id, ...ONLY_SWITCH_DEVICES },
    });
    if (!sw) throw new NotFoundException('Switch não encontrado');
    return sw;
  }

  private mapSwitch(
    sw: Prisma.DeviceGetPayload<{ include: { points: true; site: true } }>,
    lastCommunication: string | null,
  ) {
    const cfg = (sw.config ?? {}) as {
      snmpVersion?: string;
      community?: string;
      pollingIntervalMs?: number;
      manufacturer?: string | null;
      profileId?: string | null;
      profileSource?: string;
      profileOverrides?: Record<string, string> | null;
    };

    const gatewayOnline: boolean | null = sw.gatewayId
      ? this.deviceStatus.getStatus(sw.gatewayId) === 'online'
      : null;

    const scalarPoints = sw.points.filter((p) => !['sw-state', 'sw-in', 'sw-out'].includes(p.objectType ?? ''));
    const portPoints = sw.points.filter((p) => ['sw-state', 'sw-in', 'sw-out'].includes(p.objectType ?? ''));

    // Agrupa pontos de porta por ifIndex.
    const portsByIndex = new Map<number, {
      ifIndex: number;
      statePoint: typeof portPoints[0] | null;
      inPoint: typeof portPoints[0] | null;
      outPoint: typeof portPoints[0] | null;
    }>();
    for (const p of portPoints) {
      const ifIndex = p.instance;
      if (ifIndex === null) continue;
      const entry = portsByIndex.get(ifIndex) ?? { ifIndex, statePoint: null, inPoint: null, outPoint: null };
      if (p.objectType === 'sw-state') entry.statePoint = p;
      else if (p.objectType === 'sw-in') entry.inPoint = p;
      else if (p.objectType === 'sw-out') entry.outPoint = p;
      portsByIndex.set(ifIndex, entry);
    }

    return {
      id: sw.id,
      name: sw.name,
      ip: sw.ip,
      port: sw.port,
      protocol: sw.protocol,
      monitoredDeviceType: 'SWITCH',
      snmpVersion: cfg.snmpVersion ?? '2c',
      community: cfg.community ?? 'public',
      pollingInterval: cfg.pollingIntervalMs ? cfg.pollingIntervalMs / 1000 : DEFAULT_POLLING_S,
      manufacturer: cfg.manufacturer ?? null,
      profileId: cfg.profileId ?? null,
      profileLabel: resolveProfileLabel(cfg.profileId ?? null),
      profileSource: cfg.profileSource ?? 'generic',
      profileOverrides: cfg.profileOverrides ?? null,
      site: sw.site?.name ?? '',
      siteId: sw.siteId,
      tenantId: sw.tenantId,
      gatewayId: sw.gatewayId,
      gatewayOnline,
      status: this.deviceStatus.getStatus(sw.id),
      critical: sw.critical,
      lastCommunication,
      // Pontos escalares (STATUS, UPTIME, CPU).
      points: scalarPoints.map((p) => {
        const b = (p.binding ?? {}) as { metric?: string; oid?: string | null; unsupported?: boolean };
        const metric = b.metric ?? 'custom';
        return {
          id: p.id,
          tag: p.tag,
          objectName: p.objectName,
          metric,
          oid: b.oid ?? null,
          unsupported: Boolean(b.unsupported),
          unit: p.unit ?? '',
          critical: p.critical,
          lastValue: p.lastValue ?? null,
          lastValueAt: p.lastValueAt ? p.lastValueAt.toISOString() : null,
          lastValueState: p.lastValueState ?? null,
          display: buildSnmpCardDisplay({
            tag: p.tag,
            objectName: p.objectName,
            metric,
            oid: b.oid ?? null,
            unit: p.unit ?? null,
          }),
        };
      }),
      snmpInfo: ((sw.config ?? {}) as { snmpInfo?: unknown }).snmpInfo as SnmpInfoEntry[] | undefined,
      // Portas sincronizadas.
      ports: [...portsByIndex.values()]
        .sort((a, b) => a.ifIndex - b.ifIndex)
        .map((entry) => ({
          ifIndex: entry.ifIndex,
          statePoint: entry.statePoint ? {
            id: entry.statePoint.id,
            tag: entry.statePoint.tag,
            objectName: entry.statePoint.objectName,
            lastValue: entry.statePoint.lastValue ?? null,
            lastValueAt: entry.statePoint.lastValueAt?.toISOString() ?? null,
          } : null,
          inPoint: entry.inPoint ? {
            id: entry.inPoint.id,
            tag: entry.inPoint.tag,
            objectName: entry.inPoint.objectName,
            lastValue: entry.inPoint.lastValue ?? null,
            lastValueAt: entry.inPoint.lastValueAt?.toISOString() ?? null,
          } : null,
          outPoint: entry.outPoint ? {
            id: entry.outPoint.id,
            tag: entry.outPoint.tag,
            objectName: entry.outPoint.objectName,
            lastValue: entry.outPoint.lastValue ?? null,
            lastValueAt: entry.outPoint.lastValueAt?.toISOString() ?? null,
          } : null,
        })),
    };
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
      onvifPort?: number;
      deviceInfo?: OnvifDeviceInfo;
      pendingValidation?: boolean;
      manufacturer?: string | null;
      availability?: { onlineSince?: string };
      profileId?: string | null;
      profileSource?: 'detected' | 'manual' | 'generic';
      profileOverrides?: Record<string, string> | null;
      snmpInfo?: SnmpInfoEntry[];
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

    // Liveness do gateway responsável pela câmera: sinal explícito LWT/heartbeat
    // mantido em memória pelo DeviceStatusService (sobrepõe recência de telemetria).
    // null = câmera sem gatewayId cadastrado (caso patológico — não aplica regra).
    // TODO(follow-up): emitir via socket 'gateway:status' para atualização em tempo
    // real; por ora o frontend usa refetch periódico de 30s (useCameras hook).
    const gatewayOnline: boolean | null = camera.gatewayId
      ? this.deviceStatus.getStatus(camera.gatewayId) === 'online'
      : null;

    return {
      id: camera.id,
      name: camera.name,
      protocol: camera.protocol,
      monitoringProtocol: isOnvif ? 'onvif' : 'snmp',
      // Credenciais nunca saem na API — só o usuário e a flag de senha.
      // Na câmera SNMP são as credenciais opcionais de "Vídeo ao vivo".
      onvifUsername: cfg.onvifUsername ?? null,
      hasOnvifPassword: Boolean(cfg.onvifPasswordEnc),
      // SNMP: porta do serviço ONVIF/vídeo (a porta principal é a do SNMP).
      onvifPort: isOnvif ? null : (cfg.onvifPort ?? DEFAULT_ONVIF_PORT),
    // "Ver ao vivo" depende da fonte de vídeo configurada, não do protocolo
    // de monitoramento. Uma câmera SNMP pode ter um canal ONVIF/RTSP opcional;
    // uma câmera ONVIF salva sem credenciais/fonte também não pode iniciar uma
    // sessão. A senha nunca é devolvida — a presença do valor cifrado apenas
    // informa que há uma credencial configurada.
    liveViewAvailable:
        Boolean(
          (typeof cfg.onvifUsername === 'string' && cfg.onvifUsername.trim() &&
            typeof cfg.onvifPasswordEnc === 'string' && cfg.onvifPasswordEnc) ||
            (typeof cfg.rtspUrl === 'string' && cfg.rtspUrl.trim()),
        ),
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
      // Perfil de monitoramento: detectado automaticamente pelo probe ou
      // selecionado manualmente pelo operador. 'generic' = nenhum perfil específico.
      profileId: cfg.profileId ?? null,
      profileLabel: resolveProfileLabel(cfg.profileId),
      profileSource: cfg.profileSource ?? 'generic',
      profileOverrides: cfg.profileOverrides ?? null,
      snmpHealth,
      site: camera.site?.name ?? '',
      siteId: camera.siteId,
      tenantId: camera.tenantId,
      gatewayId: camera.gatewayId,
      gatewayOnline,
      ip: camera.ip,
      port: camera.port,
      snmpVersion: camera.snmpCredential?.version ?? cfg.snmpVersion ?? '2c',
      community: camera.snmpCredential?.community ?? cfg.community ?? 'public',
      // Vista pública da credencial: NUNCA expõe chaves (só flags has*Key).
      snmpCredential: snmpCredentialPublicView(camera.snmpCredential ?? null),
      rtspUrl: cfg.rtspUrl ?? null,
      pollingInterval: cfg.pollingIntervalMs ? cfg.pollingIntervalMs / 1000 : DEFAULT_POLLING_S,
      status: this.deviceStatus.getStatus(camera.id),
      critical: camera.critical,
      lastCommunication,
      // Informações estáticas do equipamento capturadas no diagnóstico SNMP.
      snmpInfo: Array.isArray(cfg.snmpInfo) ? cfg.snmpInfo : [],
      points: camera.points.map((p) => {
        const b = (p.binding ?? {}) as {
          metric?: string;
          oid?: string | null;
          unsupported?: boolean;
          healthState?: 'active' | 'broken' | 'suggested' | 'pending';
          healthReason?: 'missing' | 'type_changed' | 'awaiting_read' | null;
        };
        return {
          id: p.id,
          tag: p.tag,
          objectName: p.objectName,
          metric: b.metric ?? 'custom',
          oid: b.oid ?? null,
          // OID comprovadamente inexistente na câmera (último diagnóstico).
          unsupported: Boolean(b.unsupported),
          healthState:
            b.healthState === 'pending' && p.lastValueAt && p.lastValueState === null
              ? 'active'
              : b.healthState,
          healthReason: b.healthReason ?? null,
          unit: p.unit ?? '',
          // Ponto crítico (card Ativos Críticos) — independente da câmera crítica.
          critical: p.critical,
          // Último valor persistido — seed do status antes da telemetria ao vivo.
          lastValue: p.lastValue ?? null,
          lastValueAt: p.lastValueAt ? p.lastValueAt.toISOString() : null,
          // Estado da última leitura (waiting_event/unsupported/error/estimated).
          lastValueState: p.lastValueState ?? null,
          // Metadados de exibição do card dinâmico (derivados só de dados).
          display: buildSnmpCardDisplay({
            tag: p.tag,
            objectName: p.objectName,
            metric: b.metric ?? 'custom',
            oid: b.oid ?? null,
            unit: p.unit ?? null,
          }),
          // Indica se o ponto pode ser removido individualmente pelo operador.
          // STATUS e eventos ONVIF são essenciais e não podem ser removidos.
          removable: p.tag !== 'STATUS' && b.metric !== 'status' && p.objectType !== 'onvif',
        };
      }),
    };
  }
}
