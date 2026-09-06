/**
 * SnmpDriver — coleta SNMP para dispositivos monitorados.
 *
 * A descoberta usa perfis declarativos para decidir e persistir OIDs. O ciclo
 * contínuo recebe esse plano pronto e faz exclusivamente GET nos bindings:
 *
 *   1. OIDs escalares persistidos.
 *   2. Membros persistidos de agregados (CPU, memória, storage, contadores).
 *   3. Pontos de tabela persistidos como coluna.índice.
 *
 * Para switches (SWITCH), adiciona camada de coleta de tabela IF-MIB:
 *   - Pontos com collectionType='table' e ifIndex definido são lidos por GET no
 *     OID completo coluna.índice.
 *   - Métricas de contador (if_in_octets, if_out_octets) são convertidas em taxa
 *     (B/s) usando amostras anteriores; wraps de Counter32 e reboots (uptime
 *     diminuiu) descartam a amostra sem gerar pico falso.
 *
 * Regras preservadas do engine:
 *   - OID do ponto vence o OID do perfil para a mesma métrica.
 *   - Ponto `unsupported` → publicado como null, excluído do GET.
 *   - Sentinelas de bug → `unreliable: true`, não omite o ponto.
 *   - Falha de um campo nunca derruba os demais (por-campo).
 *   - STATUS é sempre derivado da alcançabilidade, nunca de OID.
 *
 * IO é injetado via construtor — completamente testável sem rede.
 */

import type { SnmpTarget, SnmpTableEntry } from '../snmp/snmp-read.util';
import type { SubtreeWalkResult } from '../snmp/snmp-walk.util';
import { LAYER1_OIDS } from '../cameras/provider-registry';
import {
  resolveProfile,
  type ResolveProfileInput,
} from '../profiles/profile-registry';
import type { DeviceKind, MetricMapping, ResolvedProfile } from '../profiles/types';
import type { CollectionDriver, CollectOutput, DriverTelemetryPoint } from './collection-driver.interface';

/**
 * Normaliza o campo `profileOverrides` vindo do backend (Device.config) para o
 * formato que `resolveProfile` espera: `Record<string, MetricMapping>`.
 *
 * O backend armazena os overrides como `Record<string, string>` (métrica → OID
 * string) por simplicidade de edição na UI. O gateway precisa converter para
 * MetricMapping antes de passar ao motor de perfis.
 *
 * Formatos aceitos:
 *   - string OID: `{ "cpu": "1.3.6.1.4.1.39165.1.7.0" }`
 *   - objeto parcial já convertido: `{ "cpu": { "oid": "...", "scale": 1 } }`
 */
export function normalizeProfileOverrides(
  overrides: Record<string, unknown> | null | undefined,
): Record<string, MetricMapping> | null {
  if (!overrides || typeof overrides !== 'object') return null;
  const result: Record<string, MetricMapping> = {};
  for (const [metric, value] of Object.entries(overrides)) {
    if (typeof value === 'string' && value) {
      // Backend envia string OID diretamente — converte para MetricMapping mínimo.
      result[metric] = { metricKey: metric, oid: value };
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Já é um objeto MetricMapping-like (forward-compat).
      result[metric] = { metricKey: metric, ...(value as Record<string, unknown>) } as MetricMapping;
    }
    // null/undefined/number/array → ignorado (OID inválido)
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** IO injetável — mesmo padrão do CameraTelemetryEngine para compatibilidade com testes. */
export interface SnmpDriverIo {
  /**
   * `rejectedOids`, quando informado, é preenchido pela implementação (ver
   * `readSnmpOids`) com cada OID que recebeu uma rejeição CONCLUSIVA do
   * agente neste ciclo (varbind de erro / RequestFailedError) — nunca por
   * timeout/silêncio. O SnmpDriver usa isso para detectar, ao longo de vários
   * ciclos, um OID persistentemente inválido e parar de incluí-lo no lote.
   */
  readNumbers(
    target: SnmpTarget,
    oids: string[],
    rejectedOids?: Set<string>,
  ): Promise<Array<number | null> | null>;
  readStrings(target: SnmpTarget, oids: string[]): Promise<Array<string | null> | null>;
  pingLoss(ip: string): Promise<number | null>;
  isapiUptime(creds: {
    ip: string;
    port?: number;
    username: string;
    password: string;
  }): Promise<number | null>;
  /**
   * Walk de uma coluna de tabela SNMP (opcional — só injetado para switches).
   * Retorna null quando o equipamento NÃO responde (timeout).
   * Retorna [] quando a coluna está vazia (UNSUPPORTED para o probe).
   */
  readTable?(target: SnmpTarget, columnOidPrefix: string): Promise<SnmpTableEntry[] | null>;
  /** Walk de recuperação (somente depois de um GET que provou alcançabilidade). */
  readWalk?(target: SnmpTarget, root: string): Promise<SubtreeWalkResult | null>;
}

/** Configuração de um ponto do device (espelho de SnmpPointConfig no serviço). */
export interface SnmpPointConfig {
  tag: string;
  metric: string;
  oid?: string | null;
  scale?: number;
  unit?: string | null;
  unsupported?: boolean;
  /**
   * Para pontos de tabela (switches — IF-MIB): índice da linha da tabela.
   * Ex.: ifIndex=3 → lê a coluna de OID-prefixo no row .3.
   */
  ifIndex?: number;
  /** 'table' identifica coluna+índice persistidos; a coleta continua sendo GET. */
  collectionType?: 'scalar' | 'table';
  /**
   * OIDs membros de uma métrica AGREGADA persistidos no binding
   * (device_metric_binding.memberOids). São sempre lidos por GET em lote —
   * NUNCA por walk/subtree. Semântica por métrica canônica:
   *   - cpu / cpu_usage: cada membro é um hrProcessorLoad de um core; o valor
   *     publicado é a MÉDIA de todos os membros válidos (não o primeiro core).
   *   - memory_used_percent: os membros são as colunas hrStorageUsed e
   *     hrStorageSize do MESMO índice; o percentual = used/size*100 (as
   *     allocation units se cancelam na razão).
   *   - memory_total: hrStorageSize e hrStorageAllocationUnits do mesmo índice;
   *     total (MB) = size*alloc/(1024*1024).
   * Ausente/vazio → comportamento histórico (usa apenas p.oid).
   */
  memberOids?: string[];
  /** Tipo do contador confirmado durante a descoberta. */
  counterType?: 'counter32' | 'counter64';
}

/** Prefixos das colunas hrStorage (HOST-RESOURCES-MIB) — usados na derivação
 *  de memória a partir dos memberOids do binding agregado. */
const HR_STORAGE_ALLOC_PREFIX = '1.3.6.1.2.1.25.2.3.1.4';
const HR_STORAGE_SIZE_PREFIX = '1.3.6.1.2.1.25.2.3.1.5';
const HR_STORAGE_USED_PREFIX = '1.3.6.1.2.1.25.2.3.1.6';
const HR_PROCESSOR_LOAD_PREFIX = '1.3.6.1.2.1.25.3.3.1.2';
const UCD_MEM_TOTAL = '1.3.6.1.4.1.2021.4.5.0';
const UCD_MEM_AVAILABLE = '1.3.6.1.4.1.2021.4.6.0';
const UCD_MEM_BUFFER = '1.3.6.1.4.1.2021.4.14.0';
const UCD_MEM_CACHED = '1.3.6.1.4.1.2021.4.15.0';
const HR_MEMORY_SIZE = '1.3.6.1.2.1.25.2.2.0';
const HIKVISION_RAM_TOTAL_OIDS = new Set([
  '1.3.6.1.4.1.39165.1.10.0',
  '1.3.6.1.4.1.50001.1.220.0',
]);
const LM_SENSOR_VALUE_PREFIX = '1.3.6.1.4.1.2021.13.16.2.1.3';
const ENTITY_SENSOR_VALUE_PREFIX = '1.3.6.1.2.1.99.1.1.1.4';
const IF_TYPE_PREFIX = '1.3.6.1.2.1.2.2.1.3';
const IF_IN_ERRORS_PREFIX = '1.3.6.1.2.1.2.2.1.14';
const IF_IN_DISCARDS_PREFIX = '1.3.6.1.2.1.2.2.1.13';

/**
 * Aplica a escala persistida ao valor escalar. Planos atuais já carregam a
 * escala de origem para bytes; o fallback abaixo migra planos publicados antes
 * desse contrato para os dois OIDs conhecidos de RAM total, sem tocar em fontes
 * cujo valor cru já é bytes.
 */
function scaleScalarValue(point: SnmpPointConfig, rawValue: number): number {
  const scale = point.scale ?? 1;
  const canonicalMemory =
    point.metric === 'ram_total' || point.metric === 'memory_total';
  const unit = point.unit?.trim().toLowerCase();

  if (canonicalMemory && unit === 'bytes' && scale === 1) {
    if (point.oid && HIKVISION_RAM_TOTAL_OIDS.has(point.oid)) {
      return rawValue * 1024 * 1024;
    }
    if (point.oid === HR_MEMORY_SIZE || point.oid === UCD_MEM_TOTAL) {
      return rawValue * 1024;
    }
  }

  return rawValue * scale;
}

/**
 * Classifica um OID membro de hrStorage por coluna e extrai o índice da linha.
 * Retorna null quando o OID não pertence a nenhuma coluna hrStorage esperada.
 */
function classifyHrStorageMember(
  oid: string,
): { column: 'alloc' | 'size' | 'used'; index: string } | null {
  const cols: Array<['alloc' | 'size' | 'used', string]> = [
    ['alloc', HR_STORAGE_ALLOC_PREFIX],
    ['size', HR_STORAGE_SIZE_PREFIX],
    ['used', HR_STORAGE_USED_PREFIX],
  ];
  for (const [column, prefix] of cols) {
    if (oid.startsWith(`${prefix}.`)) {
      return { column, index: oid.slice(prefix.length + 1) };
    }
  }
  return null;
}

/** Configuração do device SNMP passada ao driver por ciclo. */
export interface SnmpDeviceConfig {
  deviceId: string;
  ip: string;
  snmp: SnmpTarget;
  /** Fabricante manual (Device.config.manufacturer) — auto-detect quando null. */
  manufacturer?: string | null;
  /** Tipo de dispositivo monitorado ('CAMERA', 'SWITCH', …). */
  monitoredDeviceType?: string | null;
  /** ID de perfil forçado (Device.config.profileId). */
  profileId?: string | null;
  /** Overrides de mapeamento por métrica (Device.config.profileOverrides). */
  profileOverrides?: Record<string, unknown> | null;
  /** Credenciais HTTP p/ fallback proprietário (ex.: ISAPI Hikvision). */
  http?: { username: string; password: string; port?: number } | null;
  /**
   * Coleta restrita ao binding (fase 2 da descoberta SNMP): o batch escalar
   * usa APENAS os OIDs resolvidos dos pontos (device_metric_binding) — nenhum
   * OID fora dos bindings, sem identificação de perfil, sem pré-busca de OIDs
   * de perfil nem extras de camada 1. Walk nunca roda na coleta.
   */
  restrictToBindings?: boolean;
  points: SnmpPointConfig[];
}

const TICKS_TO_SECONDS = 0.01;

const PROVIDER_METRICS = new Set([
  'cpu',
  'memory',
  'memory_available',
  'ram_total',
  'storage',
  'temperature',
  'packet_loss',
  'uptime',
]);

/**
 * Métricas de tabela que são contadores (publicadas como TAXA após derivação
 * Δvalue/Δt — nunca como acumulador bruto). O gateway mantém a amostra
 * anterior e calcula a taxa via computeRate (wrap Counter32 + reset/reboot).
 */
const COUNTER_TABLE_METRICS = new Set([
  'if_in_octets',
  'if_out_octets',
  'if_in_errors',
  'if_out_errors',
  'if_in_discards',
  'if_out_discards',
]);

/**
 * Unidade publicada para cada métrica-contador de tabela:
 * octets → bytes/s; errors/discards → pacotes/s.
 * Exportada para os testes garantirem que nenhuma métrica nova publique
 * acumulador bruto ou unidade errada.
 */
export function counterTableUnit(metric: string): string | null {
  if (!COUNTER_TABLE_METRICS.has(metric)) return null;
  return metric === 'if_in_octets' || metric === 'if_out_octets' ? 'B/s' : 'pkt/s';
}

/**
 * Memória Linux que pode ser entregue a processos, em kB UCD.
 *
 * Alguns agentes Net-SNMP expõem memAvailReal sem contabilizar buffers/cache
 * recuperáveis. Esses campos são opcionais: a ausência de qualquer um deles
 * conserva o valor histórico de memAvailReal.
 */
export function computeLinuxAvailableMemory(
  memAvailReal: number | null,
  memBuffer: number | null,
  memCached: number | null,
  memTotalReal: number | null = null,
): number | null {
  if (memAvailReal === null) return null;
  const hasReclaimable = memBuffer !== null && memCached !== null;
  const available = hasReclaimable
    ? memAvailReal + memBuffer + memCached
    : memAvailReal;
  if (memTotalReal === null || !Number.isFinite(memTotalReal) || memTotalReal <= 0) {
    return Math.max(0, available);
  }
  return Math.min(Math.max(0, available), memTotalReal);
}

/** Unidade canônica do payload; tráfego de octetos é publicado em bits/s. */
export function canonicalCounterTableUnit(metric: string): string | null {
  if (!COUNTER_TABLE_METRICS.has(metric)) return null;
  return metric === 'if_in_octets' || metric === 'if_out_octets' ? 'bit/s' : 'pkt/s';
}

function canonicalCounterRate(metric: string, rate: number): number {
  return metric === 'if_in_octets' || metric === 'if_out_octets' ? rate * 8 : rate;
}

function counterRateForPoint(metric: string, rate: number, unit?: string | null): number {
  // Payloads antigos declaravam B/s. Mantemos essa compatibilidade explícita;
  // bindings novos usam bit/s e passam pela unidade canônica.
  return unit === 'B/s' ? rate : canonicalCounterRate(metric, rate);
}

/** Exposto para testes de regressão (Bug 4 — error/discard sem taxa). */
export function isCounterTableMetric(metric: string): boolean {
  return COUNTER_TABLE_METRICS.has(metric);
}

/** Máximo de um contador Counter32 (4 bytes não-sinalizados). */
const COUNTER32_MAX = 4_294_967_295;

/** Amostra anterior de um contador para cálculo de taxa. */
export interface CounterSample {
  value: number;
  ts: number;          // wall-clock ms
  uptimeTicks: number; // sysUpTime ticks na leitura
}

/**
 * Calcula a taxa de variação de um contador SNMP entre dois ciclos.
 *
 * Exportada como função pura para ser testável sem construir um SnmpDriver.
 * O chamador é responsável por persistir `prev` e atualizar a linha de base.
 *
 * Regras de descarte (retornam null em vez de gerar pico falso):
 *   - Primeira amostra: `prev` é undefined — sem delta possível.
 *   - Reboot detectado: uptimeTicks atual < anterior (uptime decrementou).
 *   - Elapsed zero ou negativo: clock instável.
 *   - Counter64 ou tipo desconhecido com valor menor que anterior:
 *       qualquer diminuição é tratada como reset e descartada. NÃO aplica
 *       a fórmula de wrap de Counter32 — isso evita spikes de ~4 GB/s falsos
 *       (Counter64 roda até 2^64 e dificilmente dá a volta em campo).
 *
 * Counter32 wrap: valor atual < anterior → assume wrap em COUNTER32_MAX e
 * computa o delta correto. Só aplicado quando counterType === 'counter32'.
 *
 * Precisão com Counter64: valores acima de 2^53 (~9 PB por amostragem)
 * perdem precisão ao passar por Number. Na prática, portas de até 100 Gbps
 * com polling de 30s acumulam no máximo ~45 GB/intervalo — muito abaixo do
 * limite seguro. Documentado como bound aceitável sem conversão a BigInt.
 *
 * @returns bytes/s — a UI converte para KB/s, Mbps, etc.
 */
export function computeRate(
  prev: CounterSample | undefined,
  rawValue: number,
  nowMs: number,
  uptimeTicks: number,
  counterType: 'counter32' | 'counter64' | undefined,
): number | null {
  if (!prev) return null; // primeira amostra — sem delta

  // Reboot: uptime diminuiu → descarta (o delta não tem sentido).
  if (uptimeTicks < prev.uptimeTicks) return null;

  const elapsedMs = nowMs - prev.ts;
  if (elapsedMs <= 0) return null;

  if (rawValue < prev.value) {
    if (counterType === 'counter32') {
      // Counter32 deu a volta em 2^32: delta = distância até o teto + valor atual.
      const delta = COUNTER32_MAX - prev.value + rawValue + 1;
      return delta / (elapsedMs / 1000);
    }
    // Counter64 ou tipo desconhecido: qualquer diminuição = reset.
    // Descarta esta amostra; o chamador já salvou rawValue como nova linha de base.
    return null;
  }

  return (rawValue - prev.value) / (elapsedMs / 1000);
}

/**
 * SnmpDriver (uma instância por device).
 *
 * A identificação do fabricante é feita uma vez (com retry enquanto a câmera
 * não responde) e cacheada — mesma política do CameraTelemetryEngine.
 */
export class SnmpDriver implements CollectionDriver {
  readonly protocol = 'snmp';

  /** Perfil resolvido — cache entre ciclos. null = ainda não identificado. */
  private profile: ResolvedProfile | null = null;
  /** true após a identificação ser concluída (com ou sem match de fabricante). */
  private identified = false;
  private disposed = false;

  /**
   * Amostras anteriores de contadores por chave "{metricKey}:{ifIndex}".
   * Preservadas entre ciclos para calcular taxas (B/s).
   */
  private readonly counterSamples = new Map<string, CounterSample>();
  /** OIDs descobertos positivamente, reutilizados por GET nos ciclos seguintes. */
  private readonly recoveredOids = new Map<string, string[]>();
  /** Métricas sem resultado: não repete walk antes desta janela. */
  private readonly recoveryNegativeUntil = new Map<string, number>();
  private static readonly RECOVERY_RETRY_MS = 10 * 60 * 1000;

  /**
   * OIDs persistidos que nunca respondem (todas as rejeições foram
   * conclusivas — agent_error, nunca silêncio) e por isso deixam de ser
   * incluídos no lote normal: o ponto passa a ser tratado como `unsupported`
   * nos ciclos seguintes, o que evita derrubar o batch inteiro e cair no
   * caminho lento de releitura individual por causa de um único OID morto.
   */
  private readonly confirmedUnsupportedOids = new Set<string>();
  /** OID → nº de rejeições conclusivas consecutivas (reseta a 0 em qualquer sucesso). */
  private readonly oidRejectionStreak = new Map<string, number>();
  /**
   * Nº de rejeições consecutivas exigido antes de confirmar um OID como
   * permanentemente inválido — evita marcar por uma falha isolada.
   */
  private static readonly OID_REJECTION_CONFIRM_THRESHOLD = 2;

  constructor(private readonly io: SnmpDriverIo) {}

  /** ID do perfil atual (diagnóstico/log). null quando ainda não identificado. */
  get profileId(): string | null {
    return this.profile?.id ?? null;
  }

  dispose(): void {
    this.disposed = true;
    this.counterSamples.clear();
    this.recoveredOids.clear();
    this.recoveryNegativeUntil.clear();
    this.confirmedUnsupportedOids.clear();
    this.oidRejectionStreak.clear();
  }

  /** Exposto para testes: OIDs atualmente confirmados como permanentemente inválidos. */
  get unsupportedOidsSnapshot(): string[] {
    return [...this.confirmedUnsupportedOids];
  }

  /**
   * Atualiza o streak de rejeição de cada OID do lote a partir do resultado
   * do ciclo. `rejectedThisCycle` contém os OIDs que tiveram uma rejeição
   * CONCLUSIVA do agente neste ciclo (nunca silêncio/timeout). Um OID do lote
   * que não foi rejeitado (respondeu com valor válido) reseta seu streak —
   * só uma sequência ININTERRUPTA de rejeições confirma o OID como inválido.
   *
   * Quando o device inteiro ficou em silêncio (`deviceReachable === false`),
   * nenhum streak é alterado: não há como distinguir "OID morto" de "rede
   * fora do ar" quando nada respondeu, e penalizar os OIDs aqui poderia
   * confirmar um OID bom só porque houve uma queda de rede pontual.
   */
  private updateOidRejectionState(batch: string[], rejectedThisCycle: Set<string>, deviceReachable: boolean): void {
    if (!deviceReachable) return;
    for (const oid of batch) {
      if (rejectedThisCycle.has(oid)) {
        const streak = (this.oidRejectionStreak.get(oid) ?? 0) + 1;
        this.oidRejectionStreak.set(oid, streak);
        if (streak >= SnmpDriver.OID_REJECTION_CONFIRM_THRESHOLD) {
          this.confirmedUnsupportedOids.add(oid);
        }
      } else {
        this.oidRejectionStreak.delete(oid);
      }
    }
  }

  /**
   * Clona os pontos do device aplicando o conhecimento acumulado de OIDs
   * permanentemente inválidos: um ponto cujo OID escalar foi confirmado
   * inválido vira `unsupported: true` (mesmo tratamento que o diagnóstico já
   * daria); um ponto agregado (`memberOids`) tem apenas os membros ruins
   * removidos, preservando os demais no GET em lote normal.
   */
  private applyConfirmedUnsupported(points: SnmpPointConfig[]): SnmpPointConfig[] {
    if (this.confirmedUnsupportedOids.size === 0) return points;
    return points.map((p) => {
      const oidBad = Boolean(p.oid && this.confirmedUnsupportedOids.has(p.oid));
      const filteredMembers = Array.isArray(p.memberOids)
        ? p.memberOids.filter((o) => !this.confirmedUnsupportedOids.has(o))
        : p.memberOids;
      if (!oidBad && filteredMembers === p.memberOids) return p;
      return {
        ...p,
        ...(oidBad ? { unsupported: true } : {}),
        ...(Array.isArray(p.memberOids) ? { memberOids: filteredMembers } : {}),
      };
    });
  }

  private effectiveProfile(device: SnmpDeviceConfig): ResolvedProfile {
    if (this.profile) return this.profile;
    const resolved = resolveProfile({
      deviceType: (device.monitoredDeviceType ?? 'CAMERA') as DeviceKind,
      manufacturer: device.manufacturer ?? null,
      profileIdOverride: device.profileId ?? null,
      metricOverrides: normalizeProfileOverrides(device.profileOverrides),
    });
    this.profile = resolved;
    this.identified = true;
    return resolved;
  }

  private sourceOids(device: SnmpDeviceConfig, p: SnmpPointConfig): string[] {
    // A coleta contínua em modo restrito é governada exclusivamente pelos
    // bindings persistidos. Não anexar OIDs do perfil/MIB: em SNMPv1 um único
    // OID inválido pode invalidar o GET inteiro e esconder leituras válidas.
    // Walks de recuperação continuam pertencendo somente ao modo legado/
    // diagnóstico, nunca ao plano efetivo persistido.
    if (device.restrictToBindings) {
      return p.unsupported || !p.oid ? [] : [p.oid];
    }

    const mapping = this.effectiveProfile(device).mappings.get(p.metric);
    const universal: Record<string, string[]> = {
      uptime: [LAYER1_OIDS.sysUpTime],
      ram_total: [UCD_MEM_TOTAL, HR_MEMORY_SIZE],
      // Legacy point configs are normalized by the backend, but keep this
      // fallback for gateways receiving an older retained config.
      memory_total: [UCD_MEM_TOTAL, HR_MEMORY_SIZE],
      memory: [UCD_MEM_TOTAL, HR_MEMORY_SIZE],
      memory_available: [UCD_MEM_AVAILABLE, UCD_MEM_BUFFER, UCD_MEM_CACHED, UCD_MEM_TOTAL],
      temperature: [`${LM_SENSOR_VALUE_PREFIX}.1`, `${ENTITY_SENSOR_VALUE_PREFIX}.1`],
      packet_loss: [`${IF_IN_ERRORS_PREFIX}.1`, `${IF_IN_DISCARDS_PREFIX}.1`],
    };
    return [...new Set([
      ...(p.unsupported || !p.oid ? [] : [p.oid]),
      ...(mapping?.oid ? [mapping.oid] : []),
      ...(universal[p.metric] ?? []),
      ...(this.recoveredOids.get(p.metric) ?? []),
    ])];
  }

  private async recoverMetric(
    device: SnmpDeviceConfig,
    metric: string,
    now: number,
  ): Promise<Map<string, number>> {
    const values = new Map<string, number>();
    if (this.recoveredOids.has(metric)) return values;
    if (!this.io.readWalk || this.recoveryNegativeUntil.get(metric)! > now) return values;
    const roots = metric === 'packet_loss'
      ? [IF_TYPE_PREFIX, IF_IN_ERRORS_PREFIX, IF_IN_DISCARDS_PREFIX]
      : metric === 'temperature'
        ? [LM_SENSOR_VALUE_PREFIX, ENTITY_SENSOR_VALUE_PREFIX]
        : metric === 'cpu'
          ? [HR_PROCESSOR_LOAD_PREFIX]
          : ['1.3.6.1.2.1.25', '1.3.6.1.4.1.2021'];
    const walks = await Promise.all(roots.map((root) => this.io.readWalk!(device.snmp, root).catch(() => null)));
    const entries = walks.flatMap((w) => w?.entries ?? []);
    if (metric === 'cpu') {
      const members = entries
        .filter((e) => e.oid.startsWith(`${HR_PROCESSOR_LOAD_PREFIX}.`) && e.numeric !== null)
        .sort((a, b) => a.oid.localeCompare(b.oid));
      for (const e of members) values.set(e.oid, e.numeric!);
      if (members.length) this.recoveredOids.set(metric, members.map((e) => e.oid));
    } else if (metric === 'memory' || metric === 'memory_total' || metric === 'ram_total' || metric === 'memory_available') {
      const candidates = entries.filter((e) => e.numeric !== null && (
        metric === 'memory_total' || metric === 'ram_total'
          ? e.oid === UCD_MEM_TOTAL || e.oid === HR_MEMORY_SIZE
             : metric === 'memory_available'
             ? e.oid === UCD_MEM_AVAILABLE ||
               e.oid === UCD_MEM_BUFFER ||
               e.oid === UCD_MEM_CACHED ||
               e.oid === UCD_MEM_TOTAL
            : e.oid === UCD_MEM_TOTAL || e.oid === UCD_MEM_AVAILABLE
      ));
      for (const e of candidates) values.set(e.oid, e.numeric!);
      if (candidates.length) this.recoveredOids.set(metric, candidates.map((e) => e.oid));
    } else if (metric === 'temperature') {
      const candidates = entries.filter((e) => e.numeric !== null && e.numeric! > -100 && e.numeric! < 200000);
      for (const e of candidates) values.set(e.oid, e.numeric!);
      if (candidates.length) this.recoveredOids.set(metric, [candidates[0].oid]);
    } else if (metric === 'packet_loss') {
      const physical = new Set(entries
        .filter((e) => e.oid.startsWith(`${IF_TYPE_PREFIX}.`) && e.numeric === 6)
        .map((e) => e.oid.slice(IF_TYPE_PREFIX.length + 1)));
      const counters = entries.filter((e) =>
        (e.oid.startsWith(`${IF_IN_ERRORS_PREFIX}.`) || e.oid.startsWith(`${IF_IN_DISCARDS_PREFIX}.`)) &&
        e.numeric !== null && physical.has(e.oid.slice(e.oid.lastIndexOf('.') + 1)));
      for (const e of counters) values.set(e.oid, e.numeric!);
      if (counters.length) this.recoveredOids.set(metric, counters.map((e) => e.oid));
    }
    if (!values.size) this.recoveryNegativeUntil.set(metric, now + SnmpDriver.RECOVERY_RETRY_MS);
    return values;
  }

  // ─── Identificação ───────────────────────────────────────────────────────────

  /**
   * Identifica o fabricante/perfil do device (chamado no início de cada ciclo
   * mas executa de fato apenas na primeira vez, com retry se a câmera não
   * responde). Idêntico ao `identify()` do CameraTelemetryEngine.
   */
  private async identify(device: SnmpDeviceConfig): Promise<void> {
    if (this.identified) return;

    const input: ResolveProfileInput = {
      deviceType: (device.monitoredDeviceType ?? 'CAMERA') as DeviceKind,
      manufacturer: device.manufacturer ?? null,
      profileIdOverride: device.profileId ?? null,
      // Normaliza: backend envia Record<string, string> (OID directo), gateway espera MetricMapping.
      metricOverrides: normalizeProfileOverrides(device.profileOverrides),
    };

    // Tenta resolver com os dados disponíveis (sem SNMP ainda).
    const manual = resolveProfile(input);

    // Ids dos perfis base por tipo de device (priority === 0).
    // Um perfil base retornado significa que não houve match de fabricante —
    // pode valer a pena tentar sysDescr/sysObjectId para auto-detecção.
    const BASE_PROFILE_IDS = new Set(['base-camera', 'base-access-controller', 'base-switch', 'base-nvr']);
    const isBaseFallback = BASE_PROFILE_IDS.has(manual.id);

    if (!isBaseFallback) {
      // Perfil vendor identificado explicitamente (por profileIdOverride ou
      // por manufacturer manual que casou com um perfil vendor).
      this.profile = manual;
      this.identified = true;
      return;
    }

    if (device.manufacturer) {
      // Fabricante declarado, mas nenhum perfil vendor correspondente
      // (marca desconhecida). Usa o perfil base correto para o deviceType —
      // não faz sentido tentar sysDescr quando o operador já informou o fabricante.
      this.profile = manual;
      this.identified = true;
      return;
    }

    // Auto-detecção por sysDescr/sysObjectId.
    const strings = await this.io.readStrings(device.snmp, [
      LAYER1_OIDS.sysDescr,
      LAYER1_OIDS.sysObjectId,
    ]);
    if (strings === null) {
      // Câmera não respondeu — tenta de novo no próximo ciclo.
      return;
    }
    const [sysDescr, sysObjectId] = strings;

    this.profile = resolveProfile({
      ...input,
      sysDescr,
      sysObjectId,
      pointOids: device.points.map((p) => p.oid),
    });
    this.identified = true;
  }

  // ─── Cálculo de taxa a partir de contador ────────────────────────────────────

  /**
   * Armazena nova linha de base e delega à função pura `computeRate`.
   * O histórico fica na instância; a lógica de decisão é totalmente testável
   * sem construir um SnmpDriver completo.
   */
  private getRate(
    key: string,
    rawValue: number,
    nowMs: number,
    uptimeTicks: number,
    counterType: 'counter32' | 'counter64' | undefined,
  ): number | null {
    const prev = this.counterSamples.get(key);
    this.counterSamples.set(key, { value: rawValue, ts: nowMs, uptimeTicks });
    return computeRate(prev, rawValue, nowMs, uptimeTicks, counterType);
  }

  // ─── Derivação de métricas agregadas (memberOids) ─────────────────────────────

  /**
   * Deriva o valor de uma métrica agregada a partir dos OIDs membros lidos no
   * GET em lote (nunca walk). Retorna:
   *   - number       → valor derivado com sucesso;
   *   - null         → membros presentes mas sem valor válido (publica null);
   *   - undefined    → esta métrica não é tratada como agregada aqui (o chamador
   *                    segue para a resolução histórica por OID/perfil).
   *
   * Regras por métrica canônica (aceita também os aliases legados):
   *   - cpu / cpu_usage: MÉDIA de todos os membros com valor numérico válido
   *     (cada membro é um core hrProcessorLoad). Nunca o primeiro core.
   *   - memory_used_percent / memory: used/size*100 do MESMO índice hrStorage
   *     (allocation units se cancelam na razão).
   *   - memory_total / ram_total: size*allocationUnits → bytes, apenas
   *     quando as colunas de dependência (size e alloc) estão presentes.
   */
  private deriveAggregate(
    p: SnmpPointConfig,
    valueOf: (oid: string | null | undefined) => number | null,
  ): number | null | undefined {
    const members = (p.memberOids ?? []).filter(
      (o): o is string => typeof o === 'string' && o.length > 0,
    );
    if (members.length === 0) return undefined;

    // CPU: média no ponto principal; máximo no ponto de detalhe.
    if (
      p.metric === 'cpu' ||
      p.metric === 'cpu_usage' ||
      p.metric === 'cpu_usage_peak'
    ) {
      const values = members
        .map((oid) => valueOf(oid))
        .filter((v): v is number => v !== null);
      if (values.length === 0) return null;
      const aggregate =
        p.metric === 'cpu_usage_peak'
          ? Math.max(...values)
          : values.reduce((a, b) => a + b, 0) / values.length;
      return aggregate * (p.scale ?? 1);
    }

    // Memória: derivada das colunas hrStorage do mesmo índice.
    if (
      p.metric === 'memory' ||
      p.metric === 'memory_used_percent' ||
      p.metric === 'storage' ||
      p.metric === 'storage_used_percent' ||
      p.metric === 'memory_total' ||
      p.metric === 'ram_total'
    ) {
      // Agrupa os membros por índice de linha hrStorage.
      const byIndex = new Map<
        string,
        { size?: number | null; used?: number | null; alloc?: number | null }
      >();
      for (const oid of members) {
        const classified = classifyHrStorageMember(oid);
        if (!classified) continue;
        const row = byIndex.get(classified.index) ?? {};
        const v = valueOf(oid);
        if (classified.column === 'size') row.size = v;
        else if (classified.column === 'used') row.used = v;
        else if (classified.column === 'alloc') row.alloc = v;
        byIndex.set(classified.index, row);
      }
      if (byIndex.size === 0) return undefined; // membros não são hrStorage

      // Percentual: MÉDIA entre TODAS as linhas (volumes/entradas) com leitura
      // válida neste ciclo — mesma semântica do diagnóstico
      // (resolveStorageFromHrStorage/resolveMemoryFromHrStorage calculam a
      // média entre os volumes válidos, nunca "o primeiro"). Usar apenas o
      // primeiro índice válido é o bug raiz do card saltar entre percentuais
      // muito diferentes: qual linha responde no GET varia ciclo a ciclo por
      // falha pontual de UM volume, então "primeiro válido" muda de volume a
      // cada leitura. Excluir da média apenas as linhas sem leitura válida
      // neste ciclo preserva estabilidade sem depender de qual volume falhou.
      if (
        p.metric === 'memory' ||
        p.metric === 'memory_used_percent' ||
        p.metric === 'storage' ||
        p.metric === 'storage_used_percent'
      ) {
        const percents: number[] = [];
        for (const row of byIndex.values()) {
          if (
            row.size !== null && row.size !== undefined && row.size > 0 &&
            row.used !== null && row.used !== undefined
          ) {
            percents.push((row.used / row.size) * 100);
          }
        }
        // Nenhuma linha válida neste ciclo (equipamento acessível, leitura
        // pontual ausente) → null aciona a preservação do último valor bom
        // no chamador, nunca um percentual de outro volume.
        if (percents.length === 0) return null;
        return percents.reduce((a, b) => a + b, 0) / percents.length;
      }

      // Total em bytes: entre as linhas com size/alloc válidos neste ciclo,
      // usa a de maior `size` — escolha determinística que não depende de
      // qual linha respondeu primeiro no GET, preservando o comportamento
      // atual quando só existe uma entrada relevante (RAM única).
      let best: { size: number; alloc: number } | null = null;
      for (const row of byIndex.values()) {
        if (
          row.size !== null && row.size !== undefined && row.size > 0 &&
          row.alloc !== null && row.alloc !== undefined
        ) {
          if (best === null || row.size > best.size) {
            best = { size: row.size, alloc: row.alloc };
          }
        }
      }
      return best !== null ? best.size * best.alloc : null;
    }

    // Métrica não-agregada → deixa o chamador seguir a resolução histórica.
    return undefined;
  }

  // ─── Ciclo de coleta ─────────────────────────────────────────────────────────

  /**
   * Executa um ciclo completo de coleta para o device.
   * Aceita o config do device para permitir polling sem recriar o driver.
   */
  async runCycle(device: SnmpDeviceConfig): Promise<CollectOutput> {
    if (this.disposed) {
      return { reachable: false, points: device.points.map((p) => ({ tag: p.tag, value: null, unit: p.unit ?? null })) };
    }

    // Fase 3: TODO polling SNMP é governado exclusivamente pelos OIDs completos
    // persistidos nos bindings. Identificação de perfil e subtree/walk pertencem
    // somente ao diagnóstico/descoberta, nunca ao ciclo contínuo.
    // Aplica o conhecimento acumulado de OIDs permanentemente inválidos ANTES
    // de separar escalar/tabela: um OID confirmado morto vira `unsupported`
    // (ou é removido de memberOids) e some do batch normal deste e dos
    // próximos ciclos — evita cair no fallback lento por causa dele.
    const effectivePoints = this.applyConfirmedUnsupported(device.points);
    // Separa pontos escalares de pontos de tabela
    const scalarPoints = effectivePoints.filter((p) => p.collectionType !== 'table');
    const tablePoints = effectivePoints.filter((p) => p.collectionType === 'table');

    // ── Camada 3 (ping) em paralelo ────────────────────────────────────────
    const wantsPing = scalarPoints.some((p) => p.metric === 'ping_loss');
    const pingPromise = wantsPing ? this.io.pingLoss(device.ip).catch(() => null) : Promise.resolve(null);

    // ── Batch SNMP escalar: Layer1 + OIDs vendor + OIDs dos pontos escalares ─
    // Coleta restrita ao binding: NENHUM OID fora dos bindings publicados —
    // nem sysUpTime (ACLs podem liberar só os OIDs mapeados e, em SNMPv1, um
    // OID extra inválido degrada o batch). Se uptime for um binding explícito,
    // o OID do próprio ponto entra no batch normalmente. Sem sysUpTime, a
    // detecção de reboot por uptime fica inativa (uptimeTicks=0) e o
    // computeRate segue seguro: decréscimo sem tipo confirmado = descarte.
    const layer1Oids: string[] = [];

    const pointOids = scalarPoints
      .filter((p) => p.oid && !p.unsupported)
      .map((p) => p.oid as string);

    // OIDs membros de métricas agregadas (cpu média / memória percentual):
    // sempre lidos por GET em lote, NUNCA por walk. Pontos unsupported ficam
    // de fora (mesma regra dos OIDs escalares). Preserva o comportamento
    // histórico quando nenhum ponto declara memberOids (lista vazia).
    const memberOids = scalarPoints
      .filter((p) => !p.unsupported && Array.isArray(p.memberOids))
      .flatMap((p) => p.memberOids as string[])
      .filter((o) => typeof o === 'string' && o.length > 0);

    const plannedOids = scalarPoints
      .filter((p) => !p.unsupported && PROVIDER_METRICS.has(p.metric))
      .flatMap((p) => this.sourceOids(device, p));

    // Coleta restrita: pontos de TABELA viram GET do OID completo
    // (coluna.índice) dentro do mesmo batch — subtree/walk NUNCA roda no
    // ciclo de coleta em modo restrito.
    const tableGetOids = tablePoints
      .filter((p) => p.oid && p.ifIndex !== undefined && !p.unsupported)
      .map((p) => `${p.oid}.${p.ifIndex}`);

    const batch = [
      ...new Set([...layer1Oids, ...pointOids, ...memberOids, ...plannedOids, ...tableGetOids]),
    ];

    let snmpValues: Map<string, number | null> | null = null;
    let snmpReachable = false;

    const rejectedThisCycle = new Set<string>();
    const raw = await this.io.readNumbers(device.snmp, batch, rejectedThisCycle);
    if (raw !== null) {
      snmpReachable = true;
      snmpValues = new Map(batch.map((oid, i) => [oid, raw[i] ?? null]));
    }
    this.updateOidRejectionState(batch, rejectedThisCycle, snmpReachable);

    const pingLoss = await pingPromise;
    const reachable = snmpReachable;

    const valueOf = (oid: string | null | undefined): number | null =>
      oid && snmpValues ? (snmpValues.get(oid) ?? null) : null;

    // ── Tabela SNMP (switches e NVRs) ──────────────────────────────────────
    // Só lê tabelas quando o dispositivo respondeu ao scalar batch e há pontos
    // de tabela para coletar. Cada prefixo único é lido uma vez.
    //
    // NVR — dependências implícitas:
    //   Hikvision usa disk_free (col 3 = espaço livre) para derivar disk_used
    //   = disk_capacity - disk_free. O perfil hikvision-nvr mapeia disk_free
    //   com tableOidPrefix; disk_used não tem OID próprio nessa MIB.
    //   Para que a derivação funcione, disk_capacity e disk_free precisam ser
    //   lidos mesmo que o device só tenha pontos disk_used cadastrados.
    const nowMs = Date.now();
    const uptimeTicks = valueOf(LAYER1_OIDS.sysUpTime) ??
      valueOf(scalarPoints.find((p) => p.metric === 'uptime')?.oid) ?? 0;

    const recoveryValues = new Map<string, number>();
    if (reachable && !device.restrictToBindings) {
      const metrics = [...new Set(scalarPoints
        .filter((p) => PROVIDER_METRICS.has(p.metric) && p.metric !== 'uptime')
        .map((p) => p.metric))];
      await Promise.all(metrics.map(async (metric) => {
        const points = scalarPoints.filter((p) => p.metric === metric && !p.unsupported);
        const hasValue = metric !== 'packet_loss' && points.some((p) =>
          this.sourceOids(device, p).some((oid) => valueOf(oid) !== null),
        );
        if (!hasValue) {
          for (const [oid, value] of await this.recoverMetric(device, metric, nowMs)) {
            recoveryValues.set(oid, value);
          }
        }
      }));
    }
    const recoveredValueOf = (oid: string | null | undefined): number | null =>
      oid && recoveryValues.has(oid) ? recoveryValues.get(oid)! : valueOf(oid);

    /**
     * tableValues: metricKey → ifIndex → { value, counterType }
     * counterType vem do campo type do varbind (65=Counter32, 70=Counter64).
     */
    type TableCell = { value: number | null; counterType: 'counter32' | 'counter64' | undefined };
    const tableValues = new Map<string, Map<number, TableCell>>();

    if (tablePoints.length > 0 && reachable) {
      // Os valores de tabela vieram do GET em lote (coluna.índice) —
      // nenhuma resolução por perfil e nenhum subtree/walk.
      for (const p of tablePoints) {
        if (!p.oid || p.ifIndex === undefined || p.unsupported) continue;
        const value = valueOf(`${p.oid}.${p.ifIndex}`);
        let byIndex = tableValues.get(p.metric);
        if (!byIndex) {
          byIndex = new Map();
          tableValues.set(p.metric, byIndex);
        }
        // counterType desconhecido no GET numérico → computeRate trata
        // decréscimo como reset (descarta a amostra) — nunca aplica wrap
        // Counter32 sem confirmação do tipo do varbind (comportamento seguro).
        byIndex.set(p.ifIndex, { value, counterType: p.counterType });
      }
    }

    // ── Construção dos pontos escalares ────────────────────────────────────
    // omittedTags: tags cuja leitura deste ciclo específico não teve sucesso
    // (equipamento acessível, mas o valor não veio — ex.: falha passageira
    // absorvida pelo retry do fallback, ou ainda sem dado suficiente) MAS que
    // não são um estado "não suportado"/"sem leitura estimada" já tratado.
    // Esses pontos são removidos do payload publicado ao final: omitir em vez
    // de publicar null preserva o último valor bom conhecido (backend/
    // frontend só atualizam o que está presente no payload) e o card volta a
    // atualizar sozinho no próximo ciclo bem-sucedido, sem exigir diagnóstico.
    // Só se aplica quando o EQUIPAMENTO está acessível — se `reachable` for
    // false, o ponto publica null normalmente (equipamento offline não deve
    // manter valor antigo como se fosse atual).
    const omittedTags = new Set<string>();
    const scalarResults: DriverTelemetryPoint[] = scalarPoints.map((p) => {
      const unit = p.unit ?? null;

      if (p.metric === 'status') {
        return { tag: p.tag, value: reachable ? 1 : 0, unit };
      }

      if (p.metric === 'ping_loss') {
        return {
          tag: p.tag,
          value: pingLoss,
          unit,
          ...(pingLoss !== null ? { state: 'estimated' as const, source: 'ping' } : {}),
        };
      }

      // Uptime: somente o OID persistido (normalmente MIB-II sysUpTime).
      if (p.metric === 'uptime') {
        const own = recoveredValueOf(p.oid);
        if (own !== null) {
          return { tag: p.tag, value: own * (p.scale ?? 1), unit, source: 'oid' };
        }
        return { tag: p.tag, value: null, unit, state: 'estimated' };
      }

      // ── Métrica AGREGADA (memberOids do binding) ─────────────────────────
      // Deriva o valor a partir dos OIDs membros lidos no GET em lote — nunca
      // do OID escalar único (que seria só o primeiro core / uma coluna).
      // Preserva o comportamento histórico quando não há memberOids.
      if (Array.isArray(p.memberOids) && p.memberOids.length > 0 && !p.unsupported) {
        const derived = this.deriveAggregate(p, recoveredValueOf);
        if (derived !== undefined) {
          // Membros presentes mas nenhum valor válido neste ciclo, com o
          // equipamento acessível: ausência pontual, não estado permanente —
          // omite para preservar o último valor bom em vez de publicar null.
          if (derived === null && reachable) {
            omittedTags.add(p.tag);
          }
          return {
            tag: p.tag,
            value: derived,
            unit,
            ...(derived !== null ? { source: 'aggregate' as const } : {}),
          };
        }
      }

      // Contadores canônicos de rede: a descoberta fixa os OIDs vencedores;
      // o polling converte cada acumulador Counter32 em taxa por segundo.
      // Para erros/descartes (in+out), calcula a taxa por membro antes de somar
      // para tratar wrap/reset de cada contador de forma independente.
      if (
        p.metric === 'net_in_rate' ||
        p.metric === 'net_out_rate' ||
        p.metric === 'net_error_rate' ||
        p.metric === 'net_discard_rate'
      ) {
        const counterOids =
          Array.isArray(p.memberOids) && p.memberOids.length > 0
            ? p.memberOids
            : p.oid
              ? [p.oid]
              : [];
        const rates = counterOids
          .map((oid) => {
            const rawValue = recoveredValueOf(oid);
            return rawValue === null
              ? null
              : this.getRate(
                  `${p.metric}:${oid}`,
                  rawValue,
                  nowMs,
                  uptimeTicks,
                  p.counterType ?? 'counter32',
                );
          })
          .filter((rate): rate is number => rate !== null);
        const rate = rates.length > 0
          ? rates.reduce((sum, value) => sum + value, 0)
          : null;
        return {
          tag: p.tag,
          value: rate === null ? null : counterRateForPoint(p.metric, rate, p.unit),
          unit: p.unit ?? (
            p.metric === 'net_in_rate' || p.metric === 'net_out_rate'
              ? 'bit/s'
              : 'pkt/s'
          ),
          ...(rate === null ? { state: 'estimated' as const } : {}),
          ...(rate !== null ? { source: 'counter-rate' } : {}),
        };
      }

      // Demais métricas: OID do ponto > OID do perfil > MIB-II packet_loss.
      if (PROVIDER_METRICS.has(p.metric)) {
        let value: number | null = null;
        let source: string | undefined;

        const own = p.metric === 'memory_available'
          ? null
          : p.unsupported ? null : recoveredValueOf(p.oid);
        if (own !== null) {
          value = scaleScalarValue(p, own);
          source = 'oid';
        } else if (p.metric === 'cpu' && this.recoveredOids.has('cpu')) {
          const members = this.recoveredOids.get('cpu') ?? [];
          const valid = members
            .map((oid) => recoveredValueOf(oid))
            .filter((v): v is number => v !== null);
          if (valid.length > 0) {
            value = valid.reduce((sum, v) => sum + v, 0) / valid.length;
            source = 'discovery';
          }
        } else if (p.metric === 'packet_loss' && this.recoveredOids.has('packet_loss')) {
          const counters = (this.recoveredOids.get('packet_loss') ?? [])
            .map((oid) => recoveredValueOf(oid))
            .filter((v): v is number => v !== null);
          if (counters.length > 0) {
            value = counters.reduce((sum, v) => sum + v, 0);
            source = 'discovery';
          }
        } else if (p.metric === 'memory_available') {
          // Linux/UCD only: proprietary percentage sources must never receive
          // this formula merely because they use the same metric label.
          const mapping = this.effectiveProfile(device).mappings.get(p.metric);
          const selected = this.sourceOids(device, p)
            .map((oid) => ({ oid, value: recoveredValueOf(oid) }))
            .find((candidate) => candidate.value !== null);
          const availableOid = selected?.oid === UCD_MEM_AVAILABLE
            ? selected.oid
            : null;
          const rawAvailable = availableOid ? selected?.value ?? null : null;
          if (availableOid && rawAvailable !== null) {
            const composed = computeLinuxAvailableMemory(
              rawAvailable,
              recoveredValueOf(UCD_MEM_BUFFER),
              recoveredValueOf(UCD_MEM_CACHED),
              recoveredValueOf(UCD_MEM_TOTAL),
            );
            if (composed !== null) {
              value = composed * (
                availableOid === mapping?.oid
                  ? (mapping?.scale ?? 1)
                  : (p.scale ?? 1)
              );
              source = 'linux-memory';
            }
          } else if (selected) {
            // A non-UCD mapping (for example a vendor-specific value) keeps
            // its own source and scale.
            value = selected.value! * (
              selected.oid === mapping?.oid
                ? (mapping?.scale ?? 1)
                : (p.scale ?? 1)
            );
            source = selected.oid === mapping?.oid ? 'profile' : 'oid';
          }
        } else if (p.metric === 'memory' && this.recoveredOids.has('memory')) {
          const total = recoveredValueOf(UCD_MEM_TOTAL);
          const available = recoveredValueOf(UCD_MEM_AVAILABLE);
          if (total !== null && total > 0 && available !== null) {
            value = ((total - available) / total) * 100;
            source = 'discovery';
          }
        } else {
          const mapping = this.effectiveProfile(device).mappings.get(p.metric);
          for (const oid of this.sourceOids(device, p)) {
            const candidate = recoveredValueOf(oid);
            if (candidate === null) continue;
            value = candidate * (oid === mapping?.oid ? (mapping?.scale ?? 1) : 1);
            source = oid === mapping?.oid ? 'profile' : 'mib';
            break;
          }
        }
        if (
          value !== null &&
          p.metric === 'temperature' &&
          source !== 'oid' &&
          Math.abs(value) > 200
        ) {
          value *= 0.001;
        }
        // Sem valor neste ciclo, equipamento acessível, ponto TEM um OID
        // persistido (havia algo real para tentar — não é um binding vazio
        // que nunca teria dado), e não é um estado "não suportado"/estimativa
        // já tratado explicitamente: ausência pontual — omite para preservar
        // o último valor bom conhecido em vez de publicar null.
        if (
          value === null &&
          reachable &&
          Boolean(p.oid) &&
          !p.unsupported &&
          !(p.metric === 'temperature' && this.recoveryNegativeUntil.has(p.metric))
        ) {
          omittedTags.add(p.tag);
        }
        return {
          tag: p.tag,
          value,
          unit,
          ...(source ? { source } : {}),
          ...(value === null && (
            p.unsupported ||
            (p.metric === 'temperature' && this.recoveryNegativeUntil.has(p.metric))
          ) ? { state: 'unsupported' as const } : {}),
        };
      }

      // Métricas fora do catálogo de provider: OID do ponto ou null.
      const own = p.unsupported ? null : valueOf(p.oid);
      if (own !== null) {
        return { tag: p.tag, value: scaleScalarValue(p, own), unit, source: 'oid' };
      }
      // Sem valor neste ciclo, equipamento acessível, ponto TEM um OID
      // persistido e é suportado: ausência pontual — omite para preservar o
      // último valor bom conhecido em vez de sobrescrever com null.
      if (reachable && Boolean(p.oid) && !p.unsupported) {
        omittedTags.add(p.tag);
      }
      return {
        tag: p.tag,
        value: null,
        unit,
        ...(p.unsupported ? { state: 'unsupported' as const } : {}),
      };
    });

    // ── Construção dos pontos de tabela ────────────────────────────────────
    const tableResults: DriverTelemetryPoint[] = tablePoints.map((p) => {
      const unit = p.unit ?? null;

      if (p.ifIndex === undefined) {
        // Ponto mal configurado (sem ifIndex) — publica null silenciosamente.
        return { tag: p.tag, value: null, unit };
      }

      // ── NVR disk_used: normalização Hikvision capacity − free ───────────
      // Hikvision não expõe espaço usado diretamente — col 3 = disk_free.
      // Quando disk_used não tem tableOidPrefix no perfil mas disk_free e
      // disk_capacity foram lidas como dependências implícitas, calcula:
      //   disk_used = disk_capacity − disk_free (por slot).
      if (p.metric === 'disk_used') {
        // Se o perfil não tem tableOidPrefix para disk_used E não há leitura
        // direta da célula (ex.: GET restrito do OID do binding) → tenta derivar.
        const directCell = tableValues.get('disk_used')?.get(p.ifIndex);
        if (directCell === undefined) {
          const capByIndex  = tableValues.get('disk_capacity');
          const freeByIndex = tableValues.get('disk_free');
          const capCell  = capByIndex?.get(p.ifIndex);
          const freeCell = freeByIndex?.get(p.ifIndex);
          if (
            capCell?.value !== null && capCell?.value !== undefined &&
            freeCell?.value !== null && freeCell?.value !== undefined
          ) {
            const usedRaw = capCell.value - freeCell.value;
            return { tag: p.tag, value: Math.max(0, usedRaw), unit };
          }
          // disk_free não disponível (NVR não respondeu) → publica null.
          return { tag: p.tag, value: null, unit };
        }
      }

      const byIndex = tableValues.get(p.metric);
      if (byIndex === undefined) {
        // Métrica não foi lida (sem prefixo no perfil ou host não respondeu).
        return { tag: p.tag, value: null, unit };
      }

      const cell = byIndex.get(p.ifIndex);

      if (cell === undefined) {
        // Porta não reportou este índice (UNSUPPORTED para este ifIndex).
        return {
          tag: p.tag,
          value: null,
          unit,
          ...(p.unsupported ? { state: 'unsupported' as const } : {}),
        };
      }

      const { value: rawValue, counterType } = cell;

      if (rawValue === null) {
        // Porta respondeu mas sem valor (ex.: OID presente, valor null).
        return {
          tag: p.tag,
          value: null,
          unit,
          ...(p.unsupported ? { state: 'unsupported' as const } : {}),
        };
      }

      // ── if_oper_status: normaliza 1=up→1, 2=down→0, demais→null ─────────
      if (p.metric === 'if_oper_status') {
        const normalized = rawValue === 1 ? 1 : rawValue === 2 ? 0 : null;
        return { tag: p.tag, value: normalized, unit };
      }

      // ── Contadores → taxa (B/s para octets, pkt/s para errors/discards) ──
      // counterType vem do varbind: 'counter32' aplica wrap 2^32;
      // 'counter64' ou undefined trata qualquer decréscimo como reset (→ null).
      if (COUNTER_TABLE_METRICS.has(p.metric)) {
        const key = `${p.metric}:${p.ifIndex}`;
        const rate = this.getRate(
          key,
          rawValue,
          nowMs,
          uptimeTicks,
          p.counterType ?? counterType,
        );
        return {
          tag: p.tag,
          value: rate === null ? null : counterRateForPoint(p.metric, rate, p.unit),
          unit: canonicalCounterTableUnit(p.metric) ?? unit,
          // null na primeira amostra, reboot ou reset — estado normal
          ...(rate === null ? { state: 'estimated' as const } : {}),
        };
      }

      // Outros pontos de tabela aplicam somente a transformação persistida.
      const scale = p.scale ?? 1;
      return { tag: p.tag, value: rawValue * scale, unit };
    });

    // Remove do payload publicado os pontos com ausência pontual detectada
    // acima — nada é enviado ao MQTT para eles neste ciclo, então backend e
    // frontend simplesmente preservam o último valor/timestamp já conhecidos
    // (ambos só atualizam o que está presente no payload recebido).
    const filteredScalarResults = omittedTags.size > 0
      ? scalarResults.filter((r) => !omittedTags.has(r.tag))
      : scalarResults;

    return { reachable, points: [...filteredScalarResults, ...tableResults] };
  }

  /**
   * Implementação de CollectionDriver.collect() — wrapper stateless para
   * compatibilidade com o DriverRegistry. Em uso direto pelo SnmpPollingService
   * prefira chamar runCycle(device) passando a config.
   */
  collect(): Promise<CollectOutput> {
    // Não utilizado diretamente em fase 1 (o serviço chama runCycle).
    return Promise.resolve({ reachable: false, points: [] });
  }
}
