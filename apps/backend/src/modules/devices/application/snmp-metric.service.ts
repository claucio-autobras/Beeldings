/**
 * SnmpMetricService — serviço canônico de métricas SNMP.
 *
 * Responsabilidades:
 * 1. Persistir bindings auto-resolvidos (confidence='exact') após diagnóstico.
 * 2. Herdar bindings de outro device do mesmo tenant com mesmo sysObjectID
 *    e família de firmware compatível (confidence='inferred').
 * 3. Persistir binding manual (confidence='manual') via apply-snmp-oids.
 * 4. Expor propostas metric-first no shape esperado pelo frontend:
 *    { metricKey, friendlyName, unit, exampleValue, confidence, candidates, selectedOid }
 * 5. Extrair família de firmware estável a partir de walk/sysDescr (ENTITY-MIB ou sysDescr).
 * 6. Persistir mapeamento model+firmware (sysObjectId + firmwareFamily).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { DiscoveredSnmpObjectView } from './snmp-oid-semantics.js';
import { SEMANTIC_TO_CANONICAL_METRIC } from './snmp-oid-semantics.js';
import type {
  GatewayCanonicalMetricResult,
  GatewayCanonicalMetrics,
} from './snmp-diagnose.service.js';

// ─── Tipos exportados ──────────────────────────────────────────────────────────

/** Confiança semântica do binding. */
export type BindingConfidence = 'exact' | 'inferred' | 'manual';

/**
 * Candidato de OID dentro de uma proposta.
 * Compatível com o shape esperado pelo frontend.
 */
export interface MetricProposalCandidate {
  oid: string;
  label: string;
  exampleValue: string | null;
  unit: string;
  scale: number;
  /** Valor já normalizado pelo diagnóstico, para semear uma reativação. */
  seedValue?: number | null;
  /** true = este OID está atualmente configurado no device. */
  isDefault: boolean;
  /** true somente quando este é o binding atualmente coletado. */
  isActive?: boolean;
}

/**
 * Proposta métrica-primeiro — shape exato esperado pelo frontend.
 *
 * Frontend espera:
 *   { metricKey, friendlyName, unit, exampleValue, confidence,
 *     candidates: [{oid, label, exampleValue, unit, isDefault}],
 *     selectedOid }
 */
export interface MetricProposal {
  /** Chave canônica da métrica (ex.: 'cpu_usage', 'uptime', 'reachability'). */
  metricKey: string;
  /** Rótulo amigável pt-BR. */
  friendlyName: string;
  /** Unidade de exibição do OID selecionado. */
  unit: string;
  /** Valor de exemplo já na unidade (null quando não testado/não responde). */
  exampleValue: string | null;
  /** Confiança consolidada da proposta. */
  confidence: BindingConfidence;
  /** Lista de OIDs candidatos para esta métrica. */
  candidates: MetricProposalCandidate[];
  /** OID selecionado (null para métricas derivadas como reachability). */
  selectedOid: string | null;
  state?: 'active' | 'broken' | 'suggested' | 'unavailable';
  activeOid?: string | null;
  suggestedOid?: string | null;
}

// ─── Chaves canônicas (alinhadas com o gateway) ────────────────────────────────

/** Conjunto canônico de métricas reconhecidas — superset de legado + novas. */
export const CANONICAL_METRIC_KEYS = new Set([
  // Alcançabilidade (sem OID)
  'reachability',
  'status',
  // Sistema
  'uptime',
  // CPU
  'cpu_usage',
  'cpu',            // alias legado
  // CPU temperatura
  'cpu_temperature',
  'temperature',    // alias legado
  // Memória
  'memory_used_percent',
  'memory',         // alias legado
  'ram_total',
  'memory_total',   // alias legado
  'memory_available',
  // Armazenamento
  'storage_used_percent',
  'storage',        // alias legado
  'disk_free',
  'disk_count',
  // Rede
  'net_in_rate',
  'if_in_octets',   // alias legado
  'net_out_rate',
  'if_out_octets',  // alias legado
  'net_error_rate',
  'net_discard_rate',
  'interface_status',
  'if_oper_status', // alias legado
  'packet_loss',    // legado
  'ping_loss',      // legado
]);

/** Métricas que NUNCA têm OID (derivadas por alcançabilidade ou ICMP). */
export const METRICS_WITHOUT_OID = new Set([
  'reachability',
  'reachability_latency',
  'reachability_failure_rate',
  'status',
  'ping_loss',
]);

/** Mapa de alias legado → chave canônica normalizada. */
export const LEGACY_TO_CANONICAL: Record<string, string> = {
  cpu: 'cpu_usage',
  temperature: 'cpu_temperature',
  memory: 'memory_used_percent',
  memory_total: 'ram_total',
  memory_available: 'memory_available',
  storage: 'storage_used_percent',
  if_in_octets: 'net_in_rate',
  if_out_octets: 'net_out_rate',
  if_oper_status: 'interface_status',
  packet_loss: 'net_discard_rate',
};

/** Ordem de prioridade das métricas nas propostas (mais importante primeiro). */
export const CANONICAL_METRICS_PRIORITY: string[] = [
  'reachability',
  'uptime',
  'cpu_usage',
  'cpu_temperature',
  'memory_used_percent',
  'ram_total',
  'storage_used_percent',
  'net_in_rate',
  'net_out_rate',
  'interface_status',
  'net_error_rate',
  'net_discard_rate',
];

/** Rótulos amigáveis pt-BR das métricas canônicas. */
export const CANONICAL_METRIC_LABELS: Record<string, string> = {
  reachability: 'Alcançabilidade',
  status: 'Alcançabilidade',
  uptime: 'Tempo ligado',
  cpu_usage: 'Uso de CPU',
  cpu: 'Uso de CPU',
  cpu_temperature: 'Temperatura do CPU',
  temperature: 'Temperatura',
  memory_used_percent: 'Memória usada (%)',
  memory: 'Memória livre',
  ram_total: 'Memória RAM total',
  memory_total: 'Memória RAM total',
  memory_available: 'Memória disponível',
  storage_used_percent: 'Armazenamento (%)',
  storage: 'Armazenamento',
  disk_free: 'Espaço livre em disco',
  disk_count: 'Número de discos',
  net_in_rate: 'Bytes recebidos',
  if_in_octets: 'Bytes recebidos',
  net_out_rate: 'Bytes enviados',
  if_out_octets: 'Bytes enviados',
  net_error_rate: 'Taxa de erros de rede',
  net_discard_rate: 'Pacotes descartados',
  packet_loss: 'Pacotes perdidos',
  interface_status: 'Status da interface',
  if_oper_status: 'Status da interface',
  ping_loss: 'Perda de ping',
};

/** Unidades padrão por métrica canônica. */
export const CANONICAL_METRIC_UNITS: Record<string, string> = {
  reachability: '',
  status: '',
  uptime: 's',
  cpu_usage: '%',
  cpu_temperature: '°C',
  temperature: '°C',
  memory_used_percent: '%',
  memory: 'kB',
  memory_total: 'bytes',
  ram_total: 'bytes',
  memory_available: 'bytes',
  storage_used_percent: '%',
  storage: '%',
  disk_free: 'kB',
  disk_count: '',
  net_in_rate: 'bit/s',
  if_in_octets: 'bit/s',
  net_out_rate: 'bit/s',
  if_out_octets: 'bit/s',
  net_error_rate: 'pkts',
  net_discard_rate: 'pkts',
  packet_loss: 'pkts',
  interface_status: '',
  if_oper_status: '',
  ping_loss: '%',
};

// ─── Tipos internos ────────────────────────────────────────────────────────────

/** Resultado do diagnóstico para auto-resolução de bindings. */
export interface DiagnoseResultForBinding {
  reachable: boolean;
  sysObjectId: string | null;
  sysDescr?: string | null;
  oidResults: Record<string, { responded: boolean; value: number | null; raw: string | null }>;
  walk: Array<{ root: string; entries: Array<{ oid: string; value: string; type?: string; numeric?: number | null }> }>;
  canonicalMetrics?:
    | GatewayCanonicalMetrics
    | Array<{
        metricKey: string;
        oid: string;
        value: number | null;
        unit: string;
        scale?: number;
        verified?: boolean;
        memberOids?: string[];
        memberLabels?: Record<string, string>;
      }>
    | null;
}

/**
 * Candidato de catálogo para uma métrica.
 * Aceita tanto `metricKey` quanto `metric` para compatibilidade com
 * DiagnoseCandidate (CFTV/SCA controllers usam `metric`).
 */
export interface CatalogCandidate {
  metricKey?: string;
  metric?: string;
  oid: string;
  scale: number;
  unit: string;
  profileLabel: string;
}

/** Seleção enviada pelo diagnóstico; a forma string mantém compatibilidade. */
export interface SnmpOidSelection {
  oid: string;
  scale?: number;
  unit?: string;
  seedValue?: number | null;
}

export function normalizeSnmpOidSelection(
  value: string | SnmpOidSelection | null | undefined,
): SnmpOidSelection | null {
  if (typeof value === 'string') {
    const oid = value.trim();
    return oid ? { oid } : null;
  }
  if (!value || typeof value !== 'object' || typeof value.oid !== 'string') return null;
  const oid = value.oid.trim();
  if (!oid) return null;
  if (value.scale !== undefined && (!Number.isFinite(value.scale) || value.scale <= 0)) {
    return null;
  }
  if (value.unit !== undefined && typeof value.unit !== 'string') return null;
  if (
    value.seedValue !== undefined &&
    value.seedValue !== null &&
    (typeof value.seedValue !== 'number' || !Number.isFinite(value.seedValue))
  ) {
    return null;
  }
  return {
    oid,
    ...(value.scale !== undefined ? { scale: value.scale } : {}),
    ...(value.unit !== undefined ? { unit: value.unit } : {}),
    ...(value.seedValue !== undefined ? { seedValue: value.seedValue } : {}),
  };
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

/**
 * Normaliza alias de métricas legadas para a chave canônica.
 * Preserva chaves já canônicas.
 */
export function normalizeMetricKey(key: string): string {
  return LEGACY_TO_CANONICAL[key] ?? key;
}

/**
 * Extrai família de firmware estável a partir do walk e sysDescr.
 * Usa ENTITY-MIB entPhysicalFirmwareRev (OID 1.3.6.1.2.1.47.1.1.1.1.9)
 * ou sysDescr como fallback. Retorna uma string "coarse" (ex.: "5.13",
 * "fw5", "V4") para agrupamento, nunca a versão completa.
 *
 * Retorna null quando não é possível extrair.
 */
export function extractFirmwareFamily(params: {
  walk: Array<{ root: string; entries: Array<{ oid: string; value: string }> }>;
  sysDescr?: string | null;
}): string | null {
  const { walk, sysDescr } = params;

  // 1. Tenta ENTITY-MIB entPhysicalFirmwareRev (coluna 1.3.6.1.2.1.47.1.1.1.1.9)
  const entitySection = walk.find((s) =>
    s.root === '1.3.6.1.2.1.47' || s.root.startsWith('1.3.6.1.2.1.47'),
  );
  if (entitySection) {
    for (const entry of entitySection.entries) {
      if (entry.oid.startsWith('1.3.6.1.2.1.47.1.1.1.1.9.') && entry.value?.trim()) {
        return coarseFirmware(entry.value.trim());
      }
    }
  }

  // 2. Tenta sysDescr (ex.: "Linux 5.10.0-19-amd64", "Control iD fw5.13.9")
  if (sysDescr?.trim()) {
    return coarseFirmware(sysDescr.trim());
  }

  return null;
}

/**
 * Reduz versão de firmware para família coarse (ex.: "5.13.9" → "5.13",
 * "fw5.13.9-build" → "5.13", "V4.12.3" → "V4.12").
 * Para sysDescr longo, extrai apenas a parte relevante de versão.
 */
function coarseFirmware(raw: string): string {
  // Extrai primeiro padrão de versão (ex.: 5.13.9, V4.12, fw5.13)
  const m = raw.match(/[Vv]?(\d+\.\d+)/);
  if (m) return m[1];
  // Para strings curtas (< 20 chars) retorna os primeiros 12 chars
  if (raw.length <= 20) return raw.slice(0, 12);
  // Para sysDescr longo, usa os primeiros tokens
  return raw.split(' ').slice(0, 2).join(' ').slice(0, 16);
}

/**
 * Verifica se duas famílias de firmware são compatíveis para herança.
 * - null + qualquer = compatível (sem informação não bloqueia)
 * - mesma string = compatível
 * - strings diferentes = incompatível
 */
export function areFirmwareFamiliesCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return true; // sem info = não bloqueia
  return a === b;
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

@Injectable()
export class SnmpMetricService {
  private readonly logger = new Logger(SnmpMetricService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Persistência ────────────────────────────────────────────────────────────

  /**
   * Persiste bindings auto-resolvidos (confidence='exact') após diagnóstico.
   * Processa canonicalMetrics do gateway em primeiro lugar; fallback para
   * métricas legadas do catálogo estático.
   * Nunca sobrescreve bindings manuais nem bindings que vieram de um ponto
   * existente. Estes últimos podem ter confidence='exact' em instalações
   * legadas, mas ainda representam a escolha de coleta já confirmada antes da
   * curadoria metric-first.
   *
   * @returns Número de bindings upsertados.
   */
  async persistAutoResolvedBindings(params: {
    tenantId: string;
    deviceId: string;
    sysObjectId: string | null;
    firmwareFamily?: string | null;
    resolved: Array<{
      metricKey: string;
      oid: string;
      scale: number;
      unit: string;
      confidence?: Exclude<BindingConfidence, 'manual'>;
      memberOids?: string[];
      memberLabels?: Record<string, string>;
    }>;
    /** Cadastro automático só preenche métricas ainda sem fonte ativa. */
    onlyIfMissing?: boolean;
  }): Promise<number> {
    const { tenantId, deviceId, sysObjectId, firmwareFamily, resolved, onlyIfMissing = false } = params;
    if (resolved.length === 0) return 0;

    const existing = await this.prisma.deviceMetricBinding.findMany({
      where: { deviceId },
      select: { id: true, metricKey: true, confidenceLabel: true, source: true },
    });
    const existingByMetric = new Map(
      existing.map((b) => [normalizeMetricKey(b.metricKey), b]),
    );

    let count = 0;
    for (const r of resolved) {
      const canonicalKey = normalizeMetricKey(r.metricKey);
      // Nunca persistir métricas sem OID (reachability/status/ping_loss).
      if (METRICS_WITHOUT_OID.has(canonicalKey)) continue;

      // Collapse the pre-canonical memory_total row before upserting ram_total.
      // This keeps the database unique by metric and makes re-running diagnosis
      // idempotent for devices created by older versions.
      if (canonicalKey === 'ram_total') {
        const legacy = existing.find((b) => b.metricKey === 'memory_total');
        const canonical = existing.find((b) => b.metricKey === 'ram_total');
        if (legacy && !canonical) {
          await this.prisma.deviceMetricBinding.update({
            where: { id: legacy.id },
            data: { metricKey: 'ram_total' },
          });
          existingByMetric.set('ram_total', { ...legacy, metricKey: 'ram_total' });
        } else if (legacy && canonical && legacy.id !== canonical.id) {
          await this.prisma.deviceMetricBinding.delete({ where: { id: legacy.id } });
        }
      }

      // Abrir o diagnóstico jamais muda uma escolha de coleta existente:
      // bindings `source=point` são legados/confirmados pelo operador e podem
      // ter confidence `exact`; bindings manuais recentes usam confidence
      // `manual`. Ambos só podem ser alterados por persistBinding após Apply.
      const existingBinding = existingByMetric.get(canonicalKey);
      if (
        existingBinding?.confidenceLabel === 'manual' ||
        existingBinding?.source === 'point'
      ) {
        continue;
      }
      if (onlyIfMissing && existingBinding) continue;


      const memberOidsJson = r.memberOids && r.memberOids.length > 0 ? r.memberOids : [];
      const labelsJson = r.memberLabels && Object.keys(r.memberLabels).length > 0 ? r.memberLabels : {};
      const confidenceLabel = r.confidence ?? 'exact';

      await this.prisma.deviceMetricBinding.upsert({
        where: { deviceId_metricKey: { deviceId, metricKey: canonicalKey } },
        create: {
          tenantId,
          deviceId,
          metricKey: canonicalKey,
          oid: r.oid,
          confidence: confidenceLabel === 'exact' ? 1 : 0.8,
          confidenceLabel,
          source: 'diagnose',
          sysObjectId: sysObjectId ?? undefined,
          firmwareFamily: firmwareFamily ?? undefined,
          memberOids: memberOidsJson,
          labels: labelsJson,
        },
        update: {
          oid: r.oid,
          confidence: confidenceLabel === 'exact' ? 1 : 0.8,
          confidenceLabel,
          source: 'diagnose',
          sysObjectId: sysObjectId ?? undefined,
          firmwareFamily: firmwareFamily ?? undefined,
          broken: false,
          brokenReason: null,
          memberOids: memberOidsJson,
          labels: labelsJson,
        },
      });
      count++;
    }

    this.logger.log(
      `Bindings auto-resolvidos: device=${deviceId} sysObjectId=${sysObjectId ?? '?'} count=${count}`,
    );
    return count;
  }

  /**
   * Persiste binding manual (confidence='manual') via apply-snmp-oids.
   * O binding manual NUNCA é sobrescrito por auto-resolve ou herança.
   * Recebe metricConfidence do cliente: se não for 'manual' preserva 'exact'.
   */
  async persistBinding(params: {
    tenantId: string;
    deviceId: string;
    metricKey: string;
    oid: string;
    scale: number;
    unit: string;
    confidence?: BindingConfidence;
    sysObjectId?: string | null;
    firmwareFamily?: string | null;
  }): Promise<void> {
    const { tenantId, deviceId, oid, scale, unit, sysObjectId, firmwareFamily } = params;
    const metricKey = normalizeMetricKey(params.metricKey);

    if (METRICS_WITHOUT_OID.has(metricKey)) return;

    const currentRows = await this.prisma.deviceMetricBinding.findMany({
      where: { deviceId, metricKey },
      select: { id: true, oid: true, metricKey: true, confidenceLabel: true },
    });
    let current = currentRows[0];
    if (metricKey === 'ram_total') {
      const legacyRows = await this.prisma.deviceMetricBinding.findMany({
        where: { deviceId, metricKey: 'memory_total' },
        select: { id: true, confidenceLabel: true },
      });
      for (const legacy of legacyRows) {
        if (current) {
          await this.prisma.deviceMetricBinding.delete({ where: { id: legacy.id } });
        } else {
          await this.prisma.deviceMetricBinding.update({
            where: { id: legacy.id },
            data: { metricKey: 'ram_total' },
          });
          current = {
            id: legacy.id,
            oid,
            metricKey: 'ram_total',
            confidenceLabel: legacy.confidenceLabel,
          };
        }
      }
    }
    const existingConfidence = current?.confidenceLabel;
    const confidence: BindingConfidence =
      params.confidence === 'manual'
        ? 'manual'
        : existingConfidence === 'manual' ||
            existingConfidence === 'exact' ||
            existingConfidence === 'inferred'
          ? existingConfidence
          : (params.confidence ?? 'exact');

    await this.prisma.deviceMetricBinding.upsert({
      where: { deviceId_metricKey: { deviceId, metricKey } },
      create: {
        tenantId,
        deviceId,
        metricKey,
        oid,
        confidence: confidence === 'manual' ? 1 : 0.9,
        confidenceLabel: confidence,
        source: 'diagnose',
        sysObjectId: sysObjectId ?? undefined,
        firmwareFamily: firmwareFamily ?? undefined,
        broken: false,
      },
      update: {
        oid,
        confidenceLabel: confidence,
        source: 'diagnose',
        sysObjectId: sysObjectId ?? undefined,
        firmwareFamily: firmwareFamily ?? undefined,
        broken: false,
        brokenReason: null,
        // Ao trocar manualmente a fonte, metadados do agregado antigo não
        // podem continuar forçando GETs/derivações sobre OIDs já descartados.
        ...(params.confidence === 'manual' && current?.oid !== oid
          ? { memberOids: [], labels: {} }
          : {}),
      },
    });

    this.logger.log(
      `Binding persistido: device=${deviceId} metric=${metricKey} oid=${oid} scale=${scale} unit=${unit} confidence=${confidence}`,
    );
  }

  /** @deprecated Use persistBinding com confidence='manual' */
  async persistManualBinding(params: {
    tenantId: string;
    deviceId: string;
    metricKey: string;
    oid: string;
    scale: number;
    unit: string;
    sysObjectId?: string | null;
    firmwareFamily?: string | null;
  }): Promise<void> {
    return this.persistBinding({ ...params, confidence: 'manual' });
  }

  /**
   * Herda bindings de outro device do mesmo tenant com mesmo sysObjectID
   * e família de firmware compatível (confidence='inferred').
   * Só herda quando o device destino ainda não tem binding (ou tem 'inferred').
   * Preserva memberOids/labels dos donors.
   *
   * @returns Número de bindings herdados.
   */
  async inheritBindingsFromSameModel(params: {
    tenantId: string;
    deviceId: string;
    sysObjectId: string;
    firmwareFamily?: string | null;
  }): Promise<number> {
    const { tenantId, deviceId, sysObjectId, firmwareFamily } = params;

    // Busca donors com exact/manual, mesmo sysObjectID, mesmo tenant.
    const donors = await this.prisma.deviceMetricBinding.findMany({
      where: {
        tenantId,
        sysObjectId,
        deviceId: { not: deviceId },
        confidenceLabel: { in: ['exact', 'manual'] },
        broken: false,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (donors.length === 0) return 0;

    // Carrega bindings existentes do device destino.
    const existing = await this.prisma.deviceMetricBinding.findMany({
      where: { deviceId },
      select: { metricKey: true, confidenceLabel: true },
    });
    const existingByMetric = new Map(existing.map((b) => [b.metricKey, b.confidenceLabel]));

    // Deduplica por metricKey (melhor donor = mais recente primeiro).
    const bestDonorByMetric = new Map<string, typeof donors[0]>();
    for (const d of donors) {
      if (!bestDonorByMetric.has(d.metricKey)) {
        bestDonorByMetric.set(d.metricKey, d);
      }
    }

    let count = 0;
    for (const [metricKey, donor] of bestDonorByMetric) {
      // Não herdar sobre exact ou manual.
      if (existingByMetric.get(metricKey) === 'exact' || existingByMetric.get(metricKey) === 'manual') continue;
      // Verifica compatibilidade de firmware.
      if (!areFirmwareFamiliesCompatible(firmwareFamily, donor.firmwareFamily)) continue;

      // Preserva memberOids/labels do donor.
      const memberOids = (donor.memberOids ?? []) as string[];
      const labels = (donor.labels ?? {}) as Record<string, string>;

      await this.prisma.deviceMetricBinding.upsert({
        where: { deviceId_metricKey: { deviceId, metricKey } },
        create: {
          tenantId,
          deviceId,
          metricKey,
          oid: donor.oid,
          confidence: 0.8,
          confidenceLabel: 'inferred',
          source: 'inherited',
          sysObjectId,
          firmwareFamily: firmwareFamily ?? donor.firmwareFamily ?? undefined,
          memberOids,
          labels,
        },
        update: {
          oid: donor.oid,
          confidence: 0.8,
          confidenceLabel: 'inferred',
          source: 'inherited',
          sysObjectId,
          firmwareFamily: firmwareFamily ?? donor.firmwareFamily ?? undefined,
          broken: false,
          brokenReason: null,
          memberOids,
          labels,
        },
      });
      count++;
    }

    if (count > 0) {
      this.logger.log(
        `Bindings herdados: device=${deviceId} sysObjectId=${sysObjectId} count=${count}`,
      );
    }
    return count;
  }

  /**
   * Carrega bindings herdados/existentes do device para incluir nas propostas.
   */
  async getBindingsForProposals(deviceId: string): Promise<Array<{
    metricKey: string;
    oid: string;
    confidenceLabel: string;
    unit?: string | null;
    memberOids: unknown;
    labels: unknown;
  }>> {
    return this.prisma.deviceMetricBinding.findMany({
      where: { deviceId, broken: false },
      select: {
        metricKey: true,
        oid: true,
        confidenceLabel: true,
        memberOids: true,
        labels: true,
      },
      orderBy: { metricKey: 'asc' },
    });
  }

  /**
   * Materializa os volumes de hrStorageTable a partir do binding canônico.
   * Cada plano contém somente os OIDs da mesma linha da tabela, permitindo
   * polling GET-only e um card separado por hrStorageDescr.
   */
  async getStorageVolumeBindings(deviceId: string): Promise<Array<{
    index: string;
    label: string;
    oid: string;
    memberOids: string[];
  }>> {
    const binding = await this.prisma.deviceMetricBinding.findUnique({
      where: {
        deviceId_metricKey: {
          deviceId,
          metricKey: 'storage_used_percent',
        },
      },
      select: { memberOids: true, labels: true },
    });
    if (!binding) return [];

    const members = Array.isArray(binding.memberOids)
      ? binding.memberOids.filter((oid): oid is string => typeof oid === 'string')
      : [];
    const labels =
      binding.labels && typeof binding.labels === 'object' && !Array.isArray(binding.labels)
        ? binding.labels as Record<string, unknown>
        : {};
    const usedPrefix = '1.3.6.1.2.1.25.2.3.1.6.';

    return Object.entries(labels)
      .filter(([oid, label]) => oid.startsWith(usedPrefix) && typeof label === 'string')
      .map(([oid, label]) => {
        const index = oid.slice(usedPrefix.length);
        return {
          index,
          label: label as string,
          oid,
          memberOids: members.filter((member) => member.endsWith(`.${index}`)),
        };
      })
      .filter((volume) => volume.memberOids.length >= 2)
      .sort((a, b) => a.index.localeCompare(b.index, undefined, { numeric: true }));
  }

  /**
   * Materializa o pico de CPU como ponto técnico secundário quando o binding
   * cpu_usage contém múltiplos hrProcessorLoad. O ponto principal continua
   * publicando a média; este ponto reutiliza os mesmos GETs e publica o máximo
   * para o card mostrar como detalhe, sem reintroduzir um card por núcleo.
   */
  async syncCpuPeakPoint(deviceId: string): Promise<void> {
    const binding = await this.prisma.deviceMetricBinding.findUnique({
      where: {
        deviceId_metricKey: {
          deviceId,
          metricKey: 'cpu_usage',
        },
      },
      select: { oid: true, memberOids: true },
    });
    const members = Array.isArray(binding?.memberOids)
      ? binding.memberOids.filter((oid): oid is string => typeof oid === 'string')
      : [];
    const existing = await this.prisma.devicePoint.findFirst({
      where: { deviceId, tag: 'CPU_USAGE_PEAK' },
    });

    if (!binding || members.length < 2) {
      if (existing) {
        await this.prisma.devicePoint.delete({ where: { id: existing.id } });
      }
      return;
    }

    const pointBinding = {
      metric: 'cpu_usage_peak',
      oid: binding.oid,
      scale: 1,
      memberOids: members,
      unsupported: false,
    };
    if (existing) {
      await this.prisma.devicePoint.update({
        where: { id: existing.id },
        data: {
          objectName: 'Pico de CPU',
          unit: '%',
          binding: pointBinding,
        },
      });
      return;
    }

    const highest = await this.prisma.devicePoint.aggregate({
      where: { deviceId },
      _max: { instance: true },
    });
    await this.prisma.devicePoint.create({
      data: {
        deviceId,
        tag: 'CPU_USAGE_PEAK',
        objectName: 'Pico de CPU',
        objectType: 'snmp',
        instance: (highest._max.instance ?? -1) + 1,
        unit: '%',
        binding: pointBinding,
      },
    });
  }

  // ── Propostas metric-first ──────────────────────────────────────────────────

  /**
   * Gera propostas metric-first no shape esperado pelo frontend:
   *   { metricKey, friendlyName, unit, exampleValue, confidence,
   *     candidates:[{oid,label,exampleValue,unit,isDefault}], selectedOid }
   *
   * Prioridade das fontes:
   *   1. canonicalMetrics do gateway (resolvidas pelo catálogo interno do gateway)
   *   2. OIDs respondidos no walk com semântica canônica confirmada
   *   3. Catálogo estático de candidatos (probes testados)
   *   4. Bindings herdados/persistidos (inferred)
   *
   * Para cada métrica canônica, lista TODOS os candidatos testados (responded
   * ou não) para que o frontend possa mostrar opções ao usuário.
   */
  buildProposals(params: {
    tenantId: string;
    deviceId: string;
    sysObjectId: string | null;
    diagnoseResult: DiagnoseResultForBinding;
    catalogCandidates: CatalogCandidate[];
    discovered: DiscoveredSnmpObjectView[];
    existingBindings?: Array<{ metricKey: string; oid: string; confidenceLabel: string }>;
    currentOidsByMetric?: Record<string, string>;
  }): MetricProposal[] {
    const {
      diagnoseResult,
      catalogCandidates,
      discovered,
      existingBindings,
      currentOidsByMetric,
    } = params;

    // Mapa metricKey → proposta em construção
    const proposalMap = new Map<string, {
      confidence: BindingConfidence;
      selectedOid: string | null;
      unit: string;
      exampleValue: string | null;
      candidates: Map<string, MetricProposalCandidate>;
    }>();

    const ensureProposal = (
      metricKey: string,
      unit = '',
      confidence: BindingConfidence = 'inferred',
    ) => {
      if (!proposalMap.has(metricKey)) {
        proposalMap.set(metricKey, {
          confidence,
          selectedOid: null,
          unit,
          exampleValue: null,
          candidates: new Map(),
        });
      }
      return proposalMap.get(metricKey)!;
    };

    // 1. canonicalMetrics do gateway (maior prioridade)
    for (const cm of canonicalMetricValues(diagnoseResult.canonicalMetrics)) {
      const canonicalKey = normalizeMetricKey(cm.canonicalKey);
      const p = ensureProposal(
        canonicalKey,
        cm.unit,
        cm.confidence,
      );
      const representativeOid =
        cm.selectedOid ?? cm.memberOids?.[0] ?? cm.dependencyOids?.[0] ?? null;
      // Atualiza a proposta mesmo sem OID: métricas derivadas continuam
      // visíveis, mas não são enviadas para o endpoint de apply.
      if (cm.value !== null || p.selectedOid === null) {
        p.selectedOid = METRICS_WITHOUT_OID.has(canonicalKey) ? null : representativeOid;
        p.unit = cm.unit;
        p.exampleValue = cm.value != null ? String(cm.value) : null;
        if (p.confidence !== 'manual') {
          p.confidence = cm.confidence;
        }
      }
      // Adiciona como candidato somente quando há um OID representativo.
      if (representativeOid && !METRICS_WITHOUT_OID.has(canonicalKey)) {
        const existing = p.candidates.get(representativeOid);
        if (!existing || cm.confidence === 'exact') {
          p.candidates.set(representativeOid, {
          oid: representativeOid,
          label: cm.source ?? CANONICAL_METRIC_LABELS[canonicalKey] ?? canonicalKey,
          exampleValue: cm.value != null ? String(cm.value) : null,
          unit: cm.unit,
          scale: canonicalScaleForOid(representativeOid),
          seedValue: cm.value != null ? cm.value : null,
          isDefault: currentOidsByMetric?.[canonicalKey] === representativeOid,
          isActive: currentOidsByMetric?.[canonicalKey] === representativeOid,
        });
        }
      }
    }

    // 2. Walk com semântica canônica confirmada
    for (const obj of discovered) {
      if (!obj.known?.confirmed || !obj.known.metricKey) continue;
      const canonicalKey =
        normalizeMetricKey(
          SEMANTIC_TO_CANONICAL_METRIC[obj.known.metricKey] ?? obj.known.metricKey,
        );
      if (METRICS_WITHOUT_OID.has(canonicalKey)) continue;
      const result = diagnoseResult.oidResults[obj.oid];
      const responded = Boolean(result?.responded);
      const p = ensureProposal(canonicalKey, obj.known.unit ?? '');
      // Promove a selectedOid se respondeu e ainda não temos um selecionado
      if (responded && p.selectedOid === null) {
        p.selectedOid = obj.oid;
        p.unit = obj.known.unit ?? '';
        p.exampleValue = result?.value != null
          ? String(Math.round(result.value * (obj.known.scale ?? 1) * 100) / 100)
          : null;
        if (p.confidence !== 'exact' && p.confidence !== 'manual') {
          p.confidence = 'exact';
        }
      }
      if (!p.candidates.has(obj.oid)) {
        p.candidates.set(obj.oid, {
          oid: obj.oid,
          label: obj.known.name,
          exampleValue: result?.value != null
            ? String(Math.round(result.value * (obj.known.scale ?? 1) * 100) / 100)
            : null,
          unit: obj.known.unit ?? '',
          scale: obj.known.scale ?? 1,
          seedValue: result?.value != null
            ? result.value * (obj.known.scale ?? 1)
            : null,
          isDefault: currentOidsByMetric?.[canonicalKey] === obj.oid,
          isActive: currentOidsByMetric?.[canonicalKey] === obj.oid,
        });
      }
    }

    // 3. Catálogo estático de candidatos
    for (const c of catalogCandidates) {
      const rawKey = c.metricKey ?? c.metric ?? '';
      const canonicalKey = normalizeMetricKey(
        SEMANTIC_TO_CANONICAL_METRIC[rawKey] ?? rawKey,
      );
      if (METRICS_WITHOUT_OID.has(canonicalKey)) continue;
      const result = diagnoseResult.oidResults[c.oid];
      const responded = Boolean(result?.responded);
      const p = ensureProposal(canonicalKey, c.unit);
      // Promove se respondeu e não temos selecionado ainda
      if (responded && p.selectedOid === null) {
        p.selectedOid = c.oid;
        p.unit = c.unit;
        p.exampleValue = result?.value != null
          ? String(Math.round(result.value * c.scale * 100) / 100)
          : null;
        if (p.confidence !== 'exact' && p.confidence !== 'manual') {
          p.confidence = 'exact';
        }
      }
      if (!p.candidates.has(c.oid)) {
        p.candidates.set(c.oid, {
          oid: c.oid,
          label: c.profileLabel,
          exampleValue: result?.value != null
            ? String(Math.round(result.value * c.scale * 100) / 100)
            : null,
          unit: c.unit,
          scale: c.scale,
          seedValue: result?.value != null ? result.value * c.scale : null,
          isDefault: currentOidsByMetric?.[canonicalKey] === c.oid,
          isActive: currentOidsByMetric?.[canonicalKey] === c.oid,
        });
      }
    }

    // 4. Bindings herdados/persistidos — preenche lacunas
    for (const b of (existingBindings ?? [])) {
      const canonicalKey = normalizeMetricKey(b.metricKey);
      if (METRICS_WITHOUT_OID.has(canonicalKey)) continue;
      const p = ensureProposal(canonicalKey, CANONICAL_METRIC_UNITS[canonicalKey] ?? '');
      if (p.selectedOid === null) {
        p.selectedOid = b.oid;
        p.confidence = b.confidenceLabel as BindingConfidence;
      }
      if (!p.candidates.has(b.oid)) {
        p.candidates.set(b.oid, {
          oid: b.oid,
          label: CANONICAL_METRIC_LABELS[canonicalKey] ?? canonicalKey,
          exampleValue: null,
          unit: CANONICAL_METRIC_UNITS[canonicalKey] ?? '',
          scale: 1,
          seedValue: null,
          isDefault: currentOidsByMetric?.[canonicalKey] === b.oid,
          isActive: currentOidsByMetric?.[canonicalKey] === b.oid,
        });
      }
    }

    // 5. Adiciona proposta sintética para reachability (sem OID)
    if (!proposalMap.has('reachability')) {
      proposalMap.set('reachability', {
        confidence: 'exact',
        selectedOid: null,
        unit: '',
        exampleValue: diagnoseResult.reachable ? '100' : '0',
        candidates: new Map(),
      });
    }

    // Monta lista final ordenada por prioridade
    const result: MetricProposal[] = [];
    const ordered = [
      ...CANONICAL_METRICS_PRIORITY,
      ...[...proposalMap.keys()].filter((k) => !CANONICAL_METRICS_PRIORITY.includes(k)),
    ];

    for (const metricKey of ordered) {
      const p = proposalMap.get(metricKey);
      if (!p) continue;
      result.push({
        metricKey,
        friendlyName: CANONICAL_METRIC_LABELS[metricKey] ?? metricKey,
        unit: p.unit,
        exampleValue: p.exampleValue,
        confidence: p.confidence,
        candidates: [...p.candidates.values()],
        selectedOid: p.selectedOid,
        activeOid: currentOidsByMetric?.[metricKey] ?? null,
        suggestedOid:
          (currentOidsByMetric?.[metricKey] &&
            !diagnoseResult.oidResults[currentOidsByMetric[metricKey]]?.responded)
            ? [...p.candidates.values()].find(
                (c) => c.oid !== currentOidsByMetric![metricKey] && c.exampleValue !== null,
              )?.oid ?? null
            : null,
        state: (() => {
          const activeOid = currentOidsByMetric?.[metricKey] ?? null;
          if (activeOid) {
            return diagnoseResult.oidResults[activeOid]?.responded ? 'active' : 'broken';
          }
          return p.selectedOid ? 'suggested' : 'unavailable';
        })(),
      });
    }

    return result.slice(0, 12);
  }

  /**
   * @deprecated Use buildProposals (retorna proposals não metricProposals).
   * Mantido para compatibilidade com testes existentes.
   */
  buildMetricProposals = this.buildProposals.bind(this);

  // ── Consulta ────────────────────────────────────────────────────────────────

  /**
   * Recupera os bindings existentes de um device formatados para exibição.
   */
  async getBindings(deviceId: string) {
    return this.prisma.deviceMetricBinding.findMany({
      where: { deviceId },
      orderBy: { metricKey: 'asc' },
    });
  }
}

/** Escala raw→display dos candidatos padrão quando o gateway já devolveu o valor transformado. */
function canonicalScaleForOid(oid: string): number {
  if (oid === '1.3.6.1.2.1.1.3.0') return 0.01;
  if (oid.startsWith('1.3.6.1.4.1.2021.13.16.2.1.3.')) return 0.001;
  if (oid === '1.3.6.1.4.1.2021.4.5.0') return 1 / 1024;
  return 1;
}

/** Normaliza o mapa atual e o array legado para o contrato canônico interno. */
function canonicalMetricValues(
  input: DiagnoseResultForBinding['canonicalMetrics'],
): GatewayCanonicalMetricResult[] {
  if (!input) return [];
  if (!Array.isArray(input)) return Object.values(input);
  return input.map((metric) => ({
    canonicalKey: metric.metricKey,
    label: metric.metricKey,
    selectedOid: metric.oid || null,
    value: metric.value,
    unit: metric.unit,
    source: null,
    confidence: metric.verified === false ? 'inferred' : 'exact',
    memberOids: metric.memberOids,
    detail: Object.entries(metric.memberLabels ?? {}).map(([oid, descr]) => ({
      oid,
      descr,
    })),
  }));
}
