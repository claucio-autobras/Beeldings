/**
 * CapabilityProbeService
 *
 * Executa o probe de capacidades de uma câmera monitorada:
 *   1. Identifica o dispositivo (sysDescr / sysObjectId via SNMP).
 *   2. Seleciona o perfil de OIDs correspondente.
 *   3. Testa cada métrica do catálogo e classifica em 4 estados.
 *   4. Persiste o resultado em DeviceCapabilityMap (upsert idempotente).
 *   5. Propaga o flag `unsupported` nos DevicePoint.binding (compatibilidade
 *      com o gateway antigo que não lê DeviceCapabilityMap).
 *
 * Regras de estado (mem: bluebee-snmp-error-is-response, bluebee-snmp-v1-batch):
 *   - reachable=false, cause='community'   → NO_PERMISSION  (community errada)
 *   - reachable=false, cause='no_response' → TEMPORARY_ERROR (timeout/rede)
 *   - reachable=true,  OID respondeu       → SUPPORTED
 *   - reachable=true,  OID não respondeu   → UNSUPPORTED
 *     (noSuchObject = prova de que o device está vivo; timeout = silêncio)
 *
 * A sondagem periódica cobre câmeras SNMP a cada 6h. Câmeras ONVIF sem canal
 * SNMP de saúde são marcadas como SUPPORTED nas métricas ONVIF (status, stream,
 * eventos) e TEMPORARY_ERROR nas SNMP (não testadas).
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { DeviceConfigPublisherService } from './device-config-publisher.service.js';
import {
  SnmpDiagnoseService,
  type DiagnoseOidProbe,
} from './snmp-diagnose.service.js';
import { SwitchPortSyncService } from './switch-port-sync.service.js';
import { NvrTableSyncService } from './nvr-table-sync.service.js';
import {
  CAMERA_OID_PROFILES,
  GENERIC_PROFILE,
  type CameraOidProfile,
  type HealthMetric,
} from './camera-oid-profiles.js';
import {
  ACCESS_CONTROLLER_OID_PROFILES,
  GENERIC_AC_PROFILE,
  type AcOidProfile,
  type AcHealthMetric,
} from './access-controller-oid-profiles.js';
import {
  NVR_OID_PROFILES,
  GENERIC_NVR_PROFILE,
  NVR_TABLE_OIDS,
  EMPTY_NVR_TABLE_OIDS,
  detectNvrProfile,
  resolveNvrProfileLabel,
  type NvrOidProfile,
  type NvrScalarMetric,
} from './nvr-oid-profiles.js';
import {
  ONLY_MONITORED_DEVICES,
  ONVIF_PROTOCOL,
  SNMP_PROTOCOL,
} from '../../prisma/device-filters.js';

/** Estados de capacidade. */
export type CapabilityState =
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | 'TEMPORARY_ERROR'
  | 'NO_PERMISSION';

/** Resultado de capacidade de uma métrica. */
export interface MetricCapability {
  metricKey: string;
  state: CapabilityState;
  probeValue: number | null;
  profileId: string | null;
  profileLayer: 'base' | 'vendor' | 'override' | null;
  lastProbeAt: string;
}

/** Resultado completo do probe. */
export interface ProbeCapabilityResult {
  success: boolean;
  error?: string;
  reachable: boolean;
  cause?: 'community' | 'no_response' | null;
  sysDescr?: string | null;
  detectedProfileId: string;
  detectedProfileLabel: string;
  capabilities: MetricCapability[];
}

/** Resposta da leitura de capacidades de uma câmera. */
export interface CameraCapabilitiesResult {
  profileId: string | null;
  profileLabel: string;
  profileSource: 'detected' | 'manual' | 'generic';
  profileOverrides: Record<string, string> | null;
  capabilities: MetricCapability[];
}

/** Porta SNMP padrão. */
const DEFAULT_SNMP_PORT = 161;

/** Intervalo do probe periódico (6h). */
const PERIODIC_INTERVAL_MS = 6 * 60 * 60_000;

/** Delay inicial após o boot (60s — deixa os gateways reconectarem). */
const BOOT_DELAY_MS = 60_000;

/**
 * Orçamento de tempo compartilhado para o probe de switches (40 s).
 *
 * As duas pernas (scalar + discovery) disparam em paralelo; o tempo total é
 * max(t_scalar, t_table). 40 s deixa margem de segurança abaixo de qualquer
 * HTTP timeout razoável de servidor, mesmo se ambas as pernas atingirem seus
 * timeouts individuais de 30 s quase ao mesmo tempo.
 */
export const SWITCH_PROBE_BUDGET_MS = 40_000;

// ─── Métricas SNMP sondadas pelo probe ────────────────────────────────────────

/** Métricas SNMP testadas no probe — câmeras. */
const PROBE_SNMP_METRICS: HealthMetric[] = [
  'cpu',
  'memory',
  'ram_total',
  'storage',
  'temperature',
  'packet_loss',
];

/** Métricas SNMP testadas no probe — controladoras de acesso. */
const AC_PROBE_SNMP_METRICS: AcHealthMetric[] = [
  'cpu',
  'memory',
  'ram_total',
  'temperature',
  'packet_loss',
];

/** Métrica de uptime (sysUpTime — MIB-II padrão). */
const UPTIME_OID = '1.3.6.1.2.1.1.3.0';

/** Métricas ONVIF puras (presença derivada do probe ONVIF). */
const ONVIF_METRICS = [
  'status',
  'stream',
  'motion',
  'tamper',
  'video_loss',
  'latency',
  'last_motion',
  'ping_loss',
];

// ─── Catálogo de OIDs para o probe ───────────────────────────────────────────

interface ProbeOidEntry {
  metric: string;
  oid: string;
  /** Perfil que define este OID (para atribuição de profileId/profileLayer). */
  profileId: string;
  /** Camada: 'base' para genéricos, 'vendor' para proprietários. */
  layer: 'base' | 'vendor';
}

/**
 * Monta o catálogo de OIDs candidatos: todos os OIDs de todos os perfis para
 * cada métrica. Deduplicado por metric+oid — o probe testa cada OID uma vez.
 */
function buildProbeOidCatalog(): ProbeOidEntry[] {
  const byKey = new Map<string, ProbeOidEntry>();

  // Perfil base (genérico) — layer 'base'.
  for (const metric of PROBE_SNMP_METRICS) {
    const entry = GENERIC_PROFILE.oids[metric];
    if (!entry?.oid) continue;
    const key = `${metric}|${entry.oid}`;
    byKey.set(key, {
      metric,
      oid: entry.oid,
      profileId: GENERIC_PROFILE.id,
      layer: 'base',
    });
  }

  // Perfis de fabricante — layer 'vendor'.
  for (const profile of CAMERA_OID_PROFILES) {
    if (profile.id === GENERIC_PROFILE.id) continue;
    for (const metric of PROBE_SNMP_METRICS) {
      const entry = profile.oids[metric];
      if (!entry?.oid) continue;
      const key = `${metric}|${entry.oid}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          metric,
          oid: entry.oid,
          profileId: profile.id,
          layer: 'vendor',
        });
      }
    }
  }

  // Uptime: sysUpTime padrão MIB-II.
  byKey.set(`uptime|${UPTIME_OID}`, {
    metric: 'uptime',
    oid: UPTIME_OID,
    profileId: GENERIC_PROFILE.id,
    layer: 'base',
  });

  return [...byKey.values()];
}

const PROBE_OID_CATALOG = buildProbeOidCatalog();

// ─── Catálogo de OIDs para o probe SCA (ACCESS_CONTROLLER) ───────────────────

/**
 * Monta o catálogo de OIDs candidatos para controladoras de acesso.
 * Mesma lógica do catálogo de câmeras, mas usando os perfis SCA.
 */
function buildAcProbeOidCatalog(): ProbeOidEntry[] {
  const byKey = new Map<string, ProbeOidEntry>();

  // Perfil base SCA (genérico MIB-II).
  for (const metric of AC_PROBE_SNMP_METRICS) {
    const entry = GENERIC_AC_PROFILE.oids[metric];
    if (!entry?.oid) continue;
    const key = `${metric}|${entry.oid}`;
    byKey.set(key, {
      metric,
      oid: entry.oid,
      profileId: GENERIC_AC_PROFILE.id,
      layer: 'base',
    });
  }

  // Perfis de fabricante SCA.
  for (const profile of ACCESS_CONTROLLER_OID_PROFILES) {
    if (profile.id === GENERIC_AC_PROFILE.id) continue;
    for (const metric of AC_PROBE_SNMP_METRICS) {
      const entry = profile.oids[metric];
      if (!entry?.oid) continue;
      const key = `${metric}|${entry.oid}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          metric,
          oid: entry.oid,
          profileId: profile.id,
          layer: 'vendor',
        });
      }
    }
  }

  // Uptime: sysUpTime MIB-II (igual ao catálogo de câmeras).
  byKey.set(`uptime|${UPTIME_OID}`, {
    metric: 'uptime',
    oid: UPTIME_OID,
    profileId: GENERIC_AC_PROFILE.id,
    layer: 'base',
  });

  return [...byKey.values()];
}

const AC_PROBE_OID_CATALOG = buildAcProbeOidCatalog();

// ─── Catálogo de OIDs escalares para o probe NVR ─────────────────────────────

/** Métricas escalares SNMP testadas no probe NVR. */
const NVR_PROBE_SCALAR_METRICS: NvrScalarMetric[] = ['cpu', 'memory', 'temperature'];

/**
 * Monta o catálogo de OIDs escalares candidatos para NVRs/DVRs.
 * Mesma lógica dos catálogos de câmera e controladora; deduplicado por metric+oid.
 */
function buildNvrProbeOidCatalog(): ProbeOidEntry[] {
  const byKey = new Map<string, ProbeOidEntry>();

  // Perfil base NVR (genérico MIB-II / UCD).
  for (const metric of NVR_PROBE_SCALAR_METRICS) {
    const entry = GENERIC_NVR_PROFILE.oids[metric];
    if (!entry?.oid) continue;
    const key = `${metric}|${entry.oid}`;
    byKey.set(key, { metric, oid: entry.oid, profileId: GENERIC_NVR_PROFILE.id, layer: 'base' });
  }

  // Perfis de fabricante NVR.
  for (const profile of NVR_OID_PROFILES) {
    if (profile.id === GENERIC_NVR_PROFILE.id) continue;
    for (const metric of NVR_PROBE_SCALAR_METRICS) {
      const entry = profile.oids[metric];
      if (!entry?.oid) continue;
      const key = `${metric}|${entry.oid}`;
      if (!byKey.has(key)) {
        byKey.set(key, { metric, oid: entry.oid, profileId: profile.id, layer: 'vendor' });
      }
    }
  }

  // Uptime: sysUpTime MIB-II.
  byKey.set(`uptime|${UPTIME_OID}`, {
    metric: 'uptime',
    oid: UPTIME_OID,
    profileId: GENERIC_NVR_PROFILE.id,
    layer: 'base',
  });

  return [...byKey.values()];
}

const NVR_PROBE_OID_CATALOG = buildNvrProbeOidCatalog();

// ─── Detecção de perfil pelo sysDescr / sysObjectId ──────────────────────────

/**
 * Enterprise numbers → ID de perfil (câmeras).
 * Ambíguo 1004849 (Dahua/Intelbras): prefere Intelbras (conservador no mercado BR).
 */
const ENTERPRISE_TO_PROFILE: Record<number, string> = {
  39165: 'hikvision',
  1004849: 'intelbras',
  368: 'axis',
};

/**
 * Enterprise numbers → ID de perfil SCA (controladoras de acesso).
 * Hikvision DS-K compartilha o enterprise 39165 com câmeras, mas o ID do
 * perfil SCA é 'hikvision-ac' (catálogo distinto).
 */
const AC_ENTERPRISE_TO_PROFILE: Record<number, string> = {
  39165: 'hikvision-ac',
  34475: 'control-id',
};

/**
 * Detecta o perfil de câmera mais adequado a partir dos dados lidos via SNMP.
 * Segue a mesma prioridade do gateway: fabricante manual → sysDescr → enterprise number.
 */
export function detectProfileFromSnmpProbe(
  sysDescr: string | null,
  sysObjectId: string | null,
  manufacturerHint?: string | null,
): CameraOidProfile {
  const mfr = (manufacturerHint ?? '').toLowerCase();
  const descr = (sysDescr ?? '').toLowerCase();

  // 1. Fabricante manual (maior prioridade).
  if (mfr) {
    const byMfr = CAMERA_OID_PROFILES.find(
      (p) => p.match.length > 0 && p.match.some((pat) => mfr.includes(pat)),
    );
    if (byMfr) return byMfr;
  }

  // 2. Substring no sysDescr.
  if (descr) {
    const byDescr = CAMERA_OID_PROFILES.find(
      (p) => p.match.length > 0 && p.match.some((pat) => descr.includes(pat)),
    );
    if (byDescr) return byDescr;
  }

  // 3. Enterprise number no sysObjectId.
  if (sysObjectId) {
    const m = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(sysObjectId.trim());
    if (m) {
      const ent = Number(m[1]);
      const profileId = ENTERPRISE_TO_PROFILE[ent];
      if (profileId) {
        const found = CAMERA_OID_PROFILES.find((p) => p.id === profileId);
        if (found) return found;
      }
    }
  }

  return GENERIC_PROFILE;
}

/**
 * Detecta o perfil de controladora de acesso mais adequado a partir dos dados
 * lidos via SNMP. Usa o catálogo SCA (ACCESS_CONTROLLER_OID_PROFILES) com
 * enterprise numbers próprios — nunca confunde com perfis de câmera.
 */
export function detectAcProfileFromSnmpProbe(
  sysDescr: string | null,
  sysObjectId: string | null,
  manufacturerHint?: string | null,
): AcOidProfile {
  const mfr = (manufacturerHint ?? '').toLowerCase();
  const descr = (sysDescr ?? '').toLowerCase();

  // 1. Fabricante manual (maior prioridade).
  if (mfr) {
    const byMfr = ACCESS_CONTROLLER_OID_PROFILES.find(
      (p) => p.match.length > 0 && p.match.some((pat) => mfr.includes(pat)),
    );
    if (byMfr) return byMfr;
  }

  // 2. Substring no sysDescr.
  if (descr) {
    const byDescr = ACCESS_CONTROLLER_OID_PROFILES.find(
      (p) => p.match.length > 0 && p.match.some((pat) => descr.includes(pat)),
    );
    if (byDescr) return byDescr;
  }

  // 3. Enterprise number no sysObjectId.
  if (sysObjectId) {
    const m = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(sysObjectId.trim());
    if (m) {
      const ent = Number(m[1]);
      const profileId = AC_ENTERPRISE_TO_PROFILE[ent];
      if (profileId) {
        const found = ACCESS_CONTROLLER_OID_PROFILES.find((p) => p.id === profileId);
        if (found) return found;
      }
    }
  }

  return GENERIC_AC_PROFILE;
}

/** Resolve o rótulo de um profileId de câmera (fallback: label do perfil genérico). */
export function resolveProfileLabel(profileId: string | null | undefined): string {
  if (!profileId) return GENERIC_PROFILE.label;
  const found = CAMERA_OID_PROFILES.find((p) => p.id === profileId);
  return found?.label ?? GENERIC_PROFILE.label;
}

/**
 * Resolve o rótulo de um profileId de controladora de acesso.
 * Usa exclusivamente o catálogo SCA — IDs de perfil de câmera são desconhecidos aqui.
 */
export function resolveAcProfileLabel(profileId: string | null | undefined): string {
  if (!profileId) return GENERIC_AC_PROFILE.label;
  const found = ACCESS_CONTROLLER_OID_PROFILES.find((p) => p.id === profileId);
  return found?.label ?? GENERIC_AC_PROFILE.label;
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

@Injectable()
export class CapabilityProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CapabilityProbeService.name);
  private readonly catalog = PROBE_OID_CATALOG;

  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly snmpDiagnose: SnmpDiagnoseService,
    private readonly configPublisher: DeviceConfigPublisherService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly switchPortSync: SwitchPortSyncService,
    private readonly nvrTableSync: NvrTableSyncService,
  ) {}

  onModuleInit(): void {
    // Atrasa o primeiro ciclo para os gateways reconectarem após o boot.
    this.bootTimer = setTimeout(() => {
      void this.runPeriodicCycle();
      this.periodicHandle = setInterval(
        () => void this.runPeriodicCycle(),
        PERIODIC_INTERVAL_MS,
      );
    }, BOOT_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.periodicHandle) clearInterval(this.periodicHandle);
  }

  // ─── Probe periódico ────────────────────────────────────────────────────────

  /** Ciclo periódico: sonda todas as câmeras SNMP sem probe recente. */
  private async runPeriodicCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Dispositivos monitorados SNMP (câmeras e controladoras de acesso).
      const cameras = await this.prisma.device.findMany({
        where: { protocol: SNMP_PROTOCOL, ...ONLY_MONITORED_DEVICES },
        select: { id: true, tenantId: true, gatewayId: true },
      });

      let probed = 0;
      for (const c of cameras) {
        // Pula câmeras com gateway offline.
        if (c.gatewayId && this.deviceStatus.getStatus(c.gatewayId) === 'offline') {
          continue;
        }
        await this.probeDevice(c.id).catch((err) => {
          this.logger.warn(
            `Probe periódico da câmera ${c.id} falhou: ${(err as Error).message}`,
          );
        });
        probed++;
      }

      if (cameras.length > 0) {
        this.logger.log(
          `Probe periódico de capacidades concluído — ${probed}/${cameras.length} câmera(s) sondadas`,
        );
      }
    } catch (err) {
      this.logger.error(`Ciclo periódico de probe falhou: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // ─── Probe sob demanda ──────────────────────────────────────────────────────

  /**
   * Sonda as capacidades de uma câmera e persiste os resultados.
   * Para câmeras SNMP: usa o SnmpDiagnoseService.
   * Para câmeras ONVIF sem canal SNMP: marca métricas ONVIF como SUPPORTED
   *   e SNMP como TEMPORARY_ERROR (não testadas).
   */
  async probeDevice(deviceId: string): Promise<ProbeCapabilityResult> {
    const camera = await this.prisma.device.findFirst({
      where: { id: deviceId, ...ONLY_MONITORED_DEVICES },
      include: { points: true },
    });
    if (!camera) {
      return {
        success: false,
        error: 'Dispositivo não encontrado',
        reachable: false,
        detectedProfileId: GENERIC_PROFILE.id,
        detectedProfileLabel: GENERIC_PROFILE.label,
        capabilities: [],
      };
    }

    const cfg = (camera.config ?? {}) as Record<string, unknown>;
    const isOnvif = camera.protocol === ONVIF_PROTOCOL;
    const hasSnmpHealth = isOnvif && (cfg.snmpHealth as { enabled?: boolean } | null)?.enabled === true;

    if (isOnvif && !hasSnmpHealth) {
      return this.probeOnvifPure(camera.id, cfg);
    }

    // Switch gerenciável — catálogo e lógica distintos.
    if (camera.monitoredDeviceType === 'SWITCH') {
      const port = Number(cfg.port) || (camera.port ?? DEFAULT_SNMP_PORT);
      const snmpVersion = cfg.snmpVersion === '1' ? '1' : ('2c' as const);
      const community = String(cfg.community ?? 'public').trim() || 'public';
      return this.probeSwitchDevice(camera.id, {
        tenantId: camera.tenantId,
        gatewayId: camera.gatewayId as string,
        ip: camera.ip as string,
        port,
        snmpVersion,
        community,
        existingPoints: camera.points,
      });
    }

    // NVR/DVR — catálogo NVR com escalares + walk de tabelas de disco/canal.
    if (camera.monitoredDeviceType === 'NVR') {
      const port = Number(cfg.port) || (camera.port ?? DEFAULT_SNMP_PORT);
      const snmpVersion = cfg.snmpVersion === '1' ? '1' : ('2c' as const);
      const community = String(cfg.community ?? 'public').trim() || 'public';
      const manufacturer = cfg.manufacturer as string | null ?? null;
      return this.probeNvrDevice(camera.id, {
        tenantId: camera.tenantId,
        gatewayId: camera.gatewayId as string,
        ip: camera.ip as string,
        port,
        snmpVersion,
        community,
        manufacturer,
        existingPoints: camera.points,
        existingConfig: cfg,
      });
    }

    // SNMP puro ou ONVIF com canal SNMP de saúde.
    const snmpCfg = hasSnmpHealth
      ? (cfg.snmpHealth as { port?: number; snmpVersion?: string; community?: string })
      : cfg;

    const port = Number(snmpCfg.port) || (hasSnmpHealth ? DEFAULT_SNMP_PORT : (camera.port ?? DEFAULT_SNMP_PORT));
    const snmpVersion = snmpCfg.snmpVersion === '1' ? '1' : ('2c' as const);
    const community = String(snmpCfg.community ?? 'public').trim() || 'public';
    const manufacturer = cfg.manufacturer as string | null ?? null;

    return this.probeSnmp(camera.id, {
      tenantId: camera.tenantId,
      gatewayId: camera.gatewayId as string,
      ip: camera.ip as string,
      port,
      snmpVersion,
      community,
      manufacturer,
      monitoredDeviceType: camera.monitoredDeviceType ?? 'CAMERA',
      existingPoints: camera.points,
      existingConfig: cfg,
    });
  }

  /**
   * Probe de capacidades para switches gerenciáveis.
   *
   * Executa as duas pernas em PARALELO (comandos MQTT independentes ao gateway)
   * sob um orçamento de tempo compartilhado de {@link SWITCH_PROBE_BUDGET_MS}.
   * O tempo total é max(t_scalar, t_table), não a soma — garantindo resposta
   * bem antes de qualquer HTTP timeout do servidor.
   *
   * Scalars (uptime, cpu): sondados via SnmpDiagnoseService (MIB-II / HOST-RESOURCES-MIB).
   * Tabelas IF-MIB (if_oper_status, if_in_octets, if_out_octets): sondadas
   * via SwitchPortSyncService.discoverPorts().
   *
   * Resultados parciais: se uma das pernas expirar o budget ou falhar, seus
   * pontos são marcados como TEMPORARY_ERROR e persistidos mesmo assim — o caller
   * recebe o estado real e pode exibir as métricas com a classificação correta.
   */
  private async probeSwitchDevice(
    deviceId: string,
    opts: {
      tenantId: string;
      gatewayId: string;
      ip: string;
      port: number;
      snmpVersion: '1' | '2c';
      community: string;
      existingPoints: Array<{ id: string; tag: string; binding?: unknown }>;
    },
  ): Promise<ProbeCapabilityResult> {
    if (!opts.gatewayId) {
      return {
        success: false,
        error: 'Switch sem gateway associado',
        reachable: false,
        detectedProfileId: 'base-switch',
        detectedProfileLabel: 'Padrão universal (MIB-II / IF-MIB)',
        capabilities: [],
      };
    }

    const now = new Date().toISOString();
    const SWITCH_SCALAR_OIDS: Array<{ metric: string; oid: string }> = [
      { metric: 'uptime', oid: '1.3.6.1.2.1.1.3.0' },        // sysUpTime
      { metric: 'cpu',    oid: '1.3.6.1.2.1.25.3.3.1.2.1' }, // hrProcessorLoad.1
    ];

    const current: DiagnoseOidProbe[] = [];
    for (const p of opts.existingPoints) {
      const b = (p.binding ?? {}) as { metric?: string; oid?: string | null };
      if (b.metric && b.oid && SWITCH_SCALAR_OIDS.some((e) => e.metric === b.metric)) {
        current.push({ metric: b.metric, oid: b.oid });
      }
    }

    // ── Budget compartilhado ────────────────────────────────────────────────
    // As duas pernas disparam em paralelo. O timer compartilhado garante que
    // ambas resolvam dentro do budget, evitando que o probe ultrapasse o
    // HTTP timeout — mesmo quando as duas pernas demoram no pior caso.
    const budgetExpiry = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), SWITCH_PROBE_BUDGET_MS),
    );

    /**
     * Corre a promise `p` contra o budget compartilhado. Retorna null se
     * a promise rejeitar OU se o budget expirar antes de ela resolver.
     */
    const cap = <T>(p: Promise<T>): Promise<T | null> =>
      Promise.race([p.catch((): null => null), budgetExpiry]);

    // ── Disparo em paralelo ─────────────────────────────────────────────────
    const [diagResult, discoverResult] = await Promise.all([
      cap(this.snmpDiagnose.diagnose({
        tenantId: opts.tenantId,
        gatewayId: opts.gatewayId,
        ip: opts.ip,
        port: opts.port,
        snmpVersion: opts.snmpVersion,
        community: opts.community,
        current,
        candidates: SWITCH_SCALAR_OIDS.map((e) => ({ metric: e.metric, oid: e.oid })),
      })),
      cap(this.switchPortSync.discoverPorts({
        tenantId: opts.tenantId,
        gatewayId: opts.gatewayId,
        ip: opts.ip,
        port: opts.port,
        snmpVersion: opts.snmpVersion,
        community: opts.community,
      })),
    ]);

    // ── Interpretação do diagnóstico scalar ────────────────────────────────
    // diagResult === null  → budget expirou (TEMPORARY_ERROR)
    // diagResult.success === false → gateway não respondeu ao backend (TEMPORARY_ERROR)
    // diagResult.success === true  → reachable determina SUPPORTED / NO_PERMISSION / TEMPORARY_ERROR
    let scalarReachable = false;
    let scalarCause: 'community' | 'no_response' | null = null;
    let scalarSysDescr: string | null = null;
    let globalState: CapabilityState = 'TEMPORARY_ERROR';

    if (diagResult !== null && diagResult.success) {
      scalarReachable = diagResult.reachable;
      scalarSysDescr = diagResult.sysDescr ?? null;
      if (diagResult.reachable) {
        globalState = 'SUPPORTED';
      } else {
        scalarCause = diagResult.cause ?? null;
        globalState = diagResult.cause === 'community' ? 'NO_PERMISSION' : 'TEMPORARY_ERROR';
      }
    }

    // ── Capacidades scalares ────────────────────────────────────────────────
    const capabilities: MetricCapability[] = [];

    for (const entry of SWITCH_SCALAR_OIDS) {
      let state: CapabilityState;
      let probeValue: number | null = null;

      if (diagResult === null || !diagResult.success) {
        // Budget expirou ou gateway não respondeu ao backend.
        state = 'TEMPORARY_ERROR';
      } else if (!diagResult.reachable) {
        // Gateway respondeu mas device inacessível → propaga o estado global.
        state = globalState;
      } else {
        const read = diagResult.oidResults[entry.oid];
        state = read?.responded ? 'SUPPORTED' : 'UNSUPPORTED';
        probeValue = read?.value ?? null;
      }

      capabilities.push({
        metricKey: entry.metric,
        state,
        probeValue,
        profileId: 'base-switch',
        profileLayer: 'base',
        lastProbeAt: now,
      });
    }

    // ── Capacidades de tabela (IF-MIB) ─────────────────────────────────────
    const TABLE_METRICS = ['if_oper_status', 'if_in_octets', 'if_out_octets'];

    let tableState: CapabilityState;
    let tableProbeValue: number | null = null;

    if (!scalarReachable) {
      // Device inacessível ou scalar expirou → mesmo estado global.
      tableState = globalState;
    } else if (discoverResult === null || !discoverResult.success) {
      // Budget expirou ou discovery falhou → resultado parcial TEMPORARY_ERROR.
      tableState = 'TEMPORARY_ERROR';
    } else {
      tableState = discoverResult.ports.length > 0 ? 'SUPPORTED' : 'UNSUPPORTED';
      tableProbeValue = discoverResult.ports.length;
    }

    for (const metric of TABLE_METRICS) {
      capabilities.push({
        metricKey: metric,
        state: tableState,
        probeValue: tableProbeValue,
        profileId: 'base-switch',
        profileLayer: 'base',
        lastProbeAt: now,
      });
    }

    // ── Persiste sempre — inclusive resultados parciais ─────────────────────
    // Garante que o estado real (TEMPORARY_ERROR para leg que expirou) fique
    // salvo no banco — a UI não mostra "sem dados" para métricas que já foram
    // tentadas, mesmo que o resultado seja indeterminado no momento.
    await this.persistCapabilities(deviceId, capabilities, opts.existingPoints);

    return {
      success: true,
      reachable: scalarReachable,
      cause: scalarCause,
      sysDescr: scalarSysDescr,
      detectedProfileId: 'base-switch',
      detectedProfileLabel: 'Padrão universal (MIB-II / IF-MIB)',
      capabilities,
    };
  }

  /**
   * Probe NVR/DVR: escalares via SnmpDiagnoseService + tabelas de disco/canal
   * via NvrTableSyncService. Sequencial: scalar primeiro (sysDescr → detecta perfil),
   * depois walk das tabelas com os OID-prefixos do perfil detectado.
   *
   * Métricas escalares: cpu, memory, temperature, uptime.
   * Métricas de tabela: disk_status, disk_capacity, disk_used, channel_status.
   * Quando o walk retorna 0 linhas, o capability map marca UNSUPPORTED (nunca erro).
   */
  private async probeNvrDevice(
    deviceId: string,
    opts: {
      tenantId: string;
      gatewayId: string;
      ip: string;
      port: number;
      snmpVersion: '1' | '2c';
      community: string;
      manufacturer?: string | null;
      existingPoints: Array<{ id: string; tag: string; binding?: unknown }>;
      existingConfig: Record<string, unknown>;
    },
  ): Promise<ProbeCapabilityResult> {
    if (!opts.gatewayId) {
      return {
        success: false,
        error: 'NVR sem gateway associado',
        reachable: false,
        detectedProfileId: GENERIC_NVR_PROFILE.id,
        detectedProfileLabel: GENERIC_NVR_PROFILE.label,
        capabilities: [],
      };
    }

    const now = new Date().toISOString();

    // OIDs atuais dos pontos (current para o diagnose).
    const current: DiagnoseOidProbe[] = [];
    for (const p of opts.existingPoints) {
      const b = (p.binding ?? {}) as { metric?: string; oid?: string | null };
      if (b.metric && b.oid) current.push({ metric: b.metric, oid: b.oid });
    }

    // ── 1. Probe escalar ──────────────────────────────────────────────────────
    const diagResult = await this.snmpDiagnose.diagnose({
      tenantId: opts.tenantId,
      gatewayId: opts.gatewayId,
      ip: opts.ip,
      port: opts.port,
      snmpVersion: opts.snmpVersion,
      community: opts.community,
      current,
      candidates: NVR_PROBE_OID_CATALOG.map((c) => ({ metric: c.metric, oid: c.oid })),
    }).catch(() => null);

    if (!diagResult || !diagResult.success) {
      return {
        success: false,
        error: diagResult?.error ?? 'Gateway não respondeu',
        reachable: false,
        detectedProfileId: GENERIC_NVR_PROFILE.id,
        detectedProfileLabel: GENERIC_NVR_PROFILE.label,
        capabilities: [],
      };
    }

    // ── 2. Detecção do perfil via sysDescr / sysObjectId ──────────────────────
    const existingProfileSource = opts.existingConfig.profileSource as string | undefined;
    const existingProfileId     = opts.existingConfig.profileId     as string | undefined;
    const isManual = existingProfileSource === 'manual' && !!existingProfileId;

    const detectedProfile: NvrOidProfile = detectNvrProfile(
      diagResult.sysDescr,
      diagResult.sysObjectId,
      opts.manufacturer,
    );
    const profileToUse: NvrOidProfile = isManual
      ? (NVR_OID_PROFILES.find((p) => p.id === existingProfileId) ?? detectedProfile)
      : detectedProfile;

    // ── 3. Classifica métricas escalares ─────────────────────────────────────
    const globalState: CapabilityState = diagResult.reachable
      ? 'SUPPORTED'
      : diagResult.cause === 'community'
        ? 'NO_PERMISSION'
        : 'TEMPORARY_ERROR';

    const capabilities: MetricCapability[] = [];

    for (const entry of NVR_PROBE_OID_CATALOG) {
      let state: CapabilityState;
      let probeValue: number | null = null;

      if (!diagResult.reachable) {
        state = globalState;
      } else {
        const read = diagResult.oidResults[entry.oid];
        if (read?.responded) {
          state = 'SUPPORTED';
          probeValue = read.value;
        } else {
          state = 'UNSUPPORTED';
        }
      }

      const bestForMetric = (profileToUse.oids as Record<string, { oid: string } | undefined>)[entry.metric];
      const isBestOid    = bestForMetric?.oid === entry.oid;
      const profileLayer = isBestOid
        ? (profileToUse.id === GENERIC_NVR_PROFILE.id ? 'base' : 'vendor')
        : 'base';

      capabilities.push({
        metricKey: entry.metric,
        state,
        probeValue,
        profileId: entry.profileId,
        profileLayer,
        lastProbeAt: now,
      });
    }

    // ── 4. Probe de tabelas (disco + canal) ───────────────────────────────────
    // Só realiza o walk se o device é alcançável; caso contrário propaga globalState.
    const TABLE_METRICS = ['disk_status', 'disk_capacity', 'disk_used', 'channel_status'] as const;

    if (!diagResult.reachable) {
      for (const metric of TABLE_METRICS) {
        capabilities.push({ metricKey: metric, state: globalState, probeValue: null, profileId: profileToUse.id, profileLayer: 'vendor', lastProbeAt: now });
      }
    } else {
      const tableOids = NVR_TABLE_OIDS[profileToUse.id] ?? EMPTY_NVR_TABLE_OIDS;
      const hasAnyDiskOid    = Object.values(tableOids.disk).some(Boolean);
      const hasAnyChannelOid = Object.values(tableOids.channel).some(Boolean);

      const tableResult = (hasAnyDiskOid || hasAnyChannelOid)
        ? await this.nvrTableSync.discoverNvrTables({
            tenantId: opts.tenantId,
            gatewayId: opts.gatewayId,
            ip: opts.ip,
            port: opts.port,
            snmpVersion: opts.snmpVersion,
            community: opts.community,
            diskTableOids:    tableOids.disk,
            channelTableOids: tableOids.channel,
          }).catch(() => null)
        : null;

      // Disk metrics.
      const diskState = !hasAnyDiskOid
        ? ('UNSUPPORTED' as CapabilityState)
        : tableResult === null || !tableResult.success
          ? ('TEMPORARY_ERROR' as CapabilityState)
          : tableResult.disks.length > 0
            ? ('SUPPORTED' as CapabilityState)
            : ('UNSUPPORTED' as CapabilityState);

      const diskProbeValue = tableResult?.success ? (tableResult.disks.length || null) : null;
      for (const metric of ['disk_status', 'disk_capacity', 'disk_used'] as const) {
        capabilities.push({ metricKey: metric, state: diskState, probeValue: diskProbeValue, profileId: profileToUse.id, profileLayer: 'vendor', lastProbeAt: now });
      }

      // Channel metric.
      const chanState = !hasAnyChannelOid
        ? ('UNSUPPORTED' as CapabilityState)
        : tableResult === null || !tableResult.success
          ? ('TEMPORARY_ERROR' as CapabilityState)
          : tableResult.channels.length > 0
            ? ('SUPPORTED' as CapabilityState)
            : ('UNSUPPORTED' as CapabilityState);

      const chanProbeValue = tableResult?.success ? (tableResult.channels.length || null) : null;
      capabilities.push({ metricKey: 'channel_status', state: chanState, probeValue: chanProbeValue, profileId: profileToUse.id, profileLayer: 'vendor', lastProbeAt: now });
    }

    // ── 5. Persistência ───────────────────────────────────────────────────────
    await this.persistCapabilities(deviceId, capabilities, opts.existingPoints);

    if (!isManual) {
      await this.saveDetectedProfile(deviceId, detectedProfile.id, opts.existingConfig, false).catch((err) => {
        this.logger.warn(`saveDetectedProfile NVR ${deviceId}: ${(err as Error).message}`);
      });
    }

    return {
      success: true,
      reachable: diagResult.reachable,
      cause: diagResult.reachable ? null : (diagResult.cause ?? 'no_response'),
      sysDescr: diagResult.sysDescr,
      detectedProfileId: detectedProfile.id,
      detectedProfileLabel: detectedProfile.label,
      capabilities,
    };
  }

  /**
   * Probe SNMP: usa o SnmpDiagnoseService para testar todos os OIDs do catálogo.
   */
  private async probeSnmp(
    deviceId: string,
    opts: {
      tenantId: string;
      gatewayId: string;
      ip: string;
      port: number;
      snmpVersion: '1' | '2c';
      community: string;
      manufacturer?: string | null;
      /**
       * Tipo do dispositivo monitorado — direciona qual catálogo de OIDs e qual
       * função de detecção de perfil usar. 'CAMERA' é o padrão histórico.
       */
      monitoredDeviceType?: string | null;
      existingPoints: Array<{ id: string; tag: string; binding?: unknown }>;
      existingConfig: Record<string, unknown>;
    },
  ): Promise<ProbeCapabilityResult> {
    if (!opts.gatewayId) {
      return {
        success: false,
        error: 'Câmera sem gateway associado',
        reachable: false,
        detectedProfileId: GENERIC_PROFILE.id,
        detectedProfileLabel: GENERIC_PROFILE.label,
        capabilities: [],
      };
    }

    // Dispatcha para o catálogo correto conforme o tipo do device.
    const isAc = opts.monitoredDeviceType === 'ACCESS_CONTROLLER';
    const activeCatalog = isAc ? AC_PROBE_OID_CATALOG : this.catalog;
    const genericProfileId = isAc ? GENERIC_AC_PROFILE.id : GENERIC_PROFILE.id;
    const genericProfileLabel = isAc ? GENERIC_AC_PROFILE.label : GENERIC_PROFILE.label;
    const allProfiles = isAc ? ACCESS_CONTROLLER_OID_PROFILES : CAMERA_OID_PROFILES;

    // OIDs atuais dos pontos (o SnmpDiagnoseService diferencia "current" de "candidates").
    const current: DiagnoseOidProbe[] = [];
    for (const p of opts.existingPoints) {
      const b = (p.binding ?? {}) as { metric?: string; oid?: string | null };
      if (b.metric && b.oid) {
        current.push({ metric: b.metric, oid: b.oid });
      }
    }

    // Todos os candidatos do catálogo activo.
    const candidates: DiagnoseOidProbe[] = activeCatalog.map((c) => ({
      metric: c.metric,
      oid: c.oid,
    }));

    const result = await this.snmpDiagnose.diagnose({
      tenantId: opts.tenantId,
      gatewayId: opts.gatewayId,
      ip: opts.ip,
      port: opts.port,
      snmpVersion: opts.snmpVersion,
      community: opts.community,
      current,
      candidates,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        reachable: false,
        detectedProfileId: genericProfileId,
        detectedProfileLabel: genericProfileLabel,
        capabilities: [],
      };
    }

    // Detecta o perfil do fabricante usando o catálogo correto.
    const existingProfileSource = opts.existingConfig.profileSource as string | undefined;
    const existingProfileId = opts.existingConfig.profileId as string | undefined;
    const isManual = existingProfileSource === 'manual' && !!existingProfileId;

    const detectedProfile: CameraOidProfile | AcOidProfile = isAc
      ? detectAcProfileFromSnmpProbe(result.sysDescr, result.sysObjectId, opts.manufacturer)
      : detectProfileFromSnmpProbe(result.sysDescr, result.sysObjectId, opts.manufacturer);

    const profileToUse: CameraOidProfile | AcOidProfile = isManual
      ? (allProfiles.find((p) => p.id === existingProfileId) ?? detectedProfile)
      : detectedProfile;

    // Classifica cada métrica.
    const capabilities: MetricCapability[] = [];

    // Determina o estado global de acesso.
    const globalState: CapabilityState = result.reachable
      ? 'SUPPORTED'
      : result.cause === 'community'
        ? 'NO_PERMISSION'
        : 'TEMPORARY_ERROR';

    for (const entry of activeCatalog) {
      let state: CapabilityState;
      let probeValue: number | null = null;

      if (!result.reachable) {
        state = globalState;
      } else {
        const read = result.oidResults[entry.oid];
        if (read?.responded) {
          state = 'SUPPORTED';
          probeValue = read.value;
        } else {
          // OID não respondeu mas o device está vivo → UNSUPPORTED.
          state = 'UNSUPPORTED';
        }
      }

      // Identifica a camada do perfil para este OID.
      // Ambos CameraOidProfile e AcOidProfile têm o campo `oids` com a mesma estrutura.
      const bestForMetric = (profileToUse.oids as Record<string, { oid: string } | undefined>)[entry.metric];
      const isBestOid = bestForMetric?.oid === entry.oid;
      const profileLayer = isBestOid
        ? (profileToUse.id === genericProfileId ? 'base' : 'vendor')
        : 'base';

      capabilities.push({
        metricKey: entry.metric,
        state,
        probeValue,
        profileId: entry.profileId,
        profileLayer,
        lastProbeAt: new Date().toISOString(),
      });
    }

    // Persiste os resultados.
    await this.persistCapabilities(deviceId, capabilities, opts.existingPoints);

    // Salva o perfil detectado em Device.config (não sobrescreve configuração manual).
    if (!isManual) {
      await this.saveDetectedProfile(deviceId, detectedProfile.id, opts.existingConfig, isAc);
    }

    return {
      success: true,
      reachable: result.reachable,
      cause: result.reachable ? null : (result.cause ?? 'no_response'),
      sysDescr: result.sysDescr,
      detectedProfileId: detectedProfile.id,
      detectedProfileLabel: detectedProfile.label,
      capabilities,
    };
  }

  /**
   * Probe ONVIF puro (sem canal SNMP): marca métricas ONVIF como SUPPORTED
   * (câmera já validada no cadastro) e SNMP como TEMPORARY_ERROR (não testadas).
   */
  private async probeOnvifPure(
    deviceId: string,
    cfg: Record<string, unknown>,
  ): Promise<ProbeCapabilityResult> {
    const now = new Date().toISOString();
    // ONVIF puro: sem canal SNMP significa que as métricas SNMP são
    // estruturalmente indisponíveis neste dispositivo — UNSUPPORTED, não erro
    // transitório. TEMPORARY_ERROR seria enganoso (não é falha de rede).
    const capabilities: MetricCapability[] = [
      ...ONVIF_METRICS.map((metric) => ({
        metricKey: metric,
        state: 'SUPPORTED' as CapabilityState,
        probeValue: null,
        profileId: null,
        profileLayer: null,
        lastProbeAt: now,
      })),
      ...PROBE_SNMP_METRICS.map((metric) => ({
        metricKey: metric as string,
        state: 'UNSUPPORTED' as CapabilityState,
        probeValue: null,
        profileId: null,
        profileLayer: null,
        lastProbeAt: now,
      })),
    ];

    // Detecta fabricante pelo deviceInfo do probe ONVIF.
    const deviceInfo = cfg.deviceInfo as { manufacturer?: string | null } | undefined;
    const detectedProfile = detectProfileFromSnmpProbe(
      null,
      null,
      deviceInfo?.manufacturer ?? null,
    );

    await this.persistCapabilities(deviceId, capabilities, []);

    return {
      success: true,
      reachable: true,
      cause: null,
      sysDescr: null,
      detectedProfileId: detectedProfile.id,
      detectedProfileLabel: detectedProfile.label,
      capabilities,
    };
  }

  // ─── Persistência ───────────────────────────────────────────────────────────

  /**
   * Upsert de DeviceCapabilityMap para cada métrica sondada.
   * Também propaga o flag `unsupported` em DevicePoint.binding para compatibilidade
   * com gateways que leem o campo do ponto (não o DeviceCapabilityMap).
   */
  private async persistCapabilities(
    deviceId: string,
    capabilities: MetricCapability[],
    existingPoints: Array<{ id: string; tag: string; binding?: unknown }>,
  ): Promise<void> {
    const now = new Date();

    // O catálogo de OIDs pode conter várias entradas para o mesmo metricKey
    // (ex.: cpu via hrProcessorLoad genérico + hikCpu Hikvision + OID Dahua).
    // Antes de persistir, agrega por metricKey mantendo o melhor resultado:
    // SUPPORTED > TEMPORARY_ERROR > NO_PERMISSION > UNSUPPORTED.
    // Isso evita que um OID não-suportado de outro fabricante sobrescreva
    // um OID suportado do fabricante correcto numa corrida de upserts.
    const STATE_PRIORITY: Record<CapabilityState, number> = {
      SUPPORTED: 4,
      TEMPORARY_ERROR: 3,
      NO_PERMISSION: 2,
      UNSUPPORTED: 1,
    };

    const bestByMetric = new Map<string, MetricCapability>();
    for (const cap of capabilities) {
      const current = bestByMetric.get(cap.metricKey);
      if (!current || STATE_PRIORITY[cap.state] > STATE_PRIORITY[current.state]) {
        bestByMetric.set(cap.metricKey, cap);
      }
    }

    const best = [...bestByMetric.values()];

    // Upsert por (deviceId, metricKey) — um por métrica, sem corrida.
    await Promise.all(
      best.map((cap) =>
        this.prisma.deviceCapabilityMap.upsert({
          where: { deviceId_metricKey: { deviceId, metricKey: cap.metricKey } },
          create: {
            deviceId,
            metricKey: cap.metricKey,
            state: cap.state,
            probeValue: cap.probeValue,
            profileId: cap.profileId,
            profileLayer: cap.profileLayer,
            lastProbeAt: now,
          },
          update: {
            state: cap.state,
            probeValue: cap.probeValue,
            profileId: cap.profileId,
            profileLayer: cap.profileLayer,
            lastProbeAt: now,
          },
        }),
      ),
    );

    // Propaga `unsupported` nos pontos existentes para compatibilidade.
    for (const p of existingPoints) {
      const b = (p.binding ?? {}) as Record<string, unknown>;
      const metric = b.metric as string | undefined;
      if (!metric) continue;

      const cap = best.find((c) => c.metricKey === metric);
      if (!cap) continue;

      const shouldBeUnsupported = cap.state === 'UNSUPPORTED';
      const isCurrentlyUnsupported = Boolean(b.unsupported);

      if (shouldBeUnsupported !== isCurrentlyUnsupported) {
        await this.prisma.devicePoint.update({
          where: { id: p.id },
          data: { binding: { ...b, unsupported: shouldBeUnsupported } },
        });
      }
    }
  }

  /**
   * Salva o perfil detectado em Device.config (não sobrescreve configuração manual).
   * `isAc` determina qual perfil é "genérico" (sem perfil de fabricante detectado)
   * para câmeras usa GENERIC_PROFILE.id; para AC usa GENERIC_AC_PROFILE.id —
   * ambos têm id 'generic', mas é preferível manter o dispatch explícito.
   */
  private async saveDetectedProfile(
    deviceId: string,
    detectedProfileId: string,
    currentConfig: Record<string, unknown>,
    isAc = false,
  ): Promise<void> {
    const genericId = isAc ? GENERIC_AC_PROFILE.id : GENERIC_PROFILE.id;
    // GENERIC_NVR_PROFILE.id ('base-nvr') é o "genérico" para NVRs —
    // não tem entradas em NVR_TABLE_OIDS, então salvá-lo como profileId
    // causaria OIDs vazios no sync-disks. Tratá-lo como isGeneric=true
    // salva null no config, sinalizando "sem perfil vendor detectado".
    const isGeneric = detectedProfileId === genericId || detectedProfileId === GENERIC_NVR_PROFILE.id;
    const { profileId: _old, profileSource: _src, ...rest } = currentConfig;

    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        config: {
          ...rest,
          profileId: isGeneric ? null : detectedProfileId,
          profileSource: isGeneric ? 'generic' : 'detected',
        } as Prisma.InputJsonValue,
      },
    });

    // Republica a config no gateway para que o SnmpDriver use o novo perfil.
    if (!isGeneric) {
      await this.configPublisher.publishForDevice(deviceId).catch((err) => {
        this.logger.warn(
          `Republication após probe falhou para ${deviceId}: ${(err as Error).message}`,
        );
      });
    }
  }

  // ─── Leitura de capacidades ─────────────────────────────────────────────────

  /**
   * Lê as capacidades de um device a partir do DeviceCapabilityMap.
   * Usa o catálogo correto para resolver o label do perfil conforme o tipo do device.
   */
  async getCapabilities(deviceId: string): Promise<CameraCapabilitiesResult> {
    const [device, rows] = await Promise.all([
      this.prisma.device.findFirst({
        where: { id: deviceId, ...ONLY_MONITORED_DEVICES },
        select: { config: true, monitoredDeviceType: true },
      }),
      this.prisma.deviceCapabilityMap.findMany({
        where: { deviceId },
        orderBy: { metricKey: 'asc' },
      }),
    ]);

    const cfg = (device?.config ?? {}) as Record<string, unknown>;
    const profileId = cfg.profileId as string | null ?? null;
    const profileSource = (cfg.profileSource as 'detected' | 'manual' | 'generic') ?? 'generic';
    const profileOverrides = cfg.profileOverrides as Record<string, string> | null ?? null;

    // Resolve o label pelo catálogo correto para o tipo do dispositivo.
    const monitoredType = device?.monitoredDeviceType;
    const isAc  = monitoredType === 'ACCESS_CONTROLLER';
    const isNvr = monitoredType === 'NVR';
    const profileLabel = isAc
      ? resolveAcProfileLabel(profileId)
      : isNvr
        ? resolveNvrProfileLabel(profileId)
        : resolveProfileLabel(profileId);

    return {
      profileId,
      profileLabel,
      profileSource,
      profileOverrides,
      capabilities: rows.map((r) => ({
        metricKey: r.metricKey,
        state: r.state as CapabilityState,
        probeValue: r.probeValue,
        profileId: r.profileId,
        profileLayer: r.profileLayer as 'base' | 'vendor' | 'override' | null,
        lastProbeAt: r.lastProbeAt.toISOString(),
      })),
    };
  }
}
