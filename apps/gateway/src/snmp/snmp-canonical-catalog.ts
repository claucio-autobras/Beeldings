/**
 * Catálogo canônico de métricas para resolução de diagnóstico SNMP.
 *
 * Cada entrada define a métrica canônica com candidatos OIDs em ordem de
 * prioridade, função de transformação, scale e estratégia de agregação.
 *
 * Candidatos são tentados em ordem; o primeiro com valor numérico válido vence.
 * Candidatos do tipo 'walk' usam entradas já coletadas do walk de diagnóstico.
 *
 * Estrutura:
 *   canonicalKey      – chave de métrica canônica publicada no resultado
 *   label             – nome amigável para diagnóstico/UI
 *   candidates        – lista ordenada de sondas, com source/oid/transform/scale
 *   aggregation       – 'first' | 'avg' | 'max' | 'sum' | 'table'
 *   unit              – unidade do valor final
 *   isCounter         – true para contadores cumulativos (IF-MIB octets/errors/discards)
 *                       → o valor bruto do diagnóstico é acumulador; a persistência/
 *                         polling deve aplicar computeRate para obter taxa
 */

// ─── HOST-RESOURCES-MIB OIDs ─────────────────────────────────────────────────

/** hrProcessorTable — hrProcessorLoad: 1.3.6.1.2.1.25.3.3.1.2.<index> */
export const HR_PROCESSOR_LOAD_PREFIX = '1.3.6.1.2.1.25.3.3.1.2';
/** @deprecated compatibilidade de fixtures antigas; descoberta não usa índice fixo. */
export const HR_PROCESSOR_LOAD_1 = `${HR_PROCESSOR_LOAD_PREFIX}.1`;
/** hrMemorySize (KBytes), convertido para bytes na resolução canônica. */
export const HR_MEMORY_SIZE_OID = '1.3.6.1.2.1.25.2.2.0';

/**
 * hrStorageTable OIDs:
 *   hrStorageType  : 1.3.6.1.2.1.25.2.3.1.2.<index>
 *   hrStorageDescr : 1.3.6.1.2.1.25.2.3.1.3.<index>
 *   hrStorageAllocationUnits: 1.3.6.1.2.1.25.2.3.1.4.<index>
 *   hrStorageSize  : 1.3.6.1.2.1.25.2.3.1.5.<index>
 *   hrStorageUsed  : 1.3.6.1.2.1.25.2.3.1.6.<index>
 */
export const HR_STORAGE_TYPE_PREFIX  = '1.3.6.1.2.1.25.2.3.1.2';
export const HR_STORAGE_DESCR_PREFIX = '1.3.6.1.2.1.25.2.3.1.3';
export const HR_STORAGE_ALLOC_PREFIX = '1.3.6.1.2.1.25.2.3.1.4';
export const HR_STORAGE_SIZE_PREFIX  = '1.3.6.1.2.1.25.2.3.1.5';
export const HR_STORAGE_USED_PREFIX  = '1.3.6.1.2.1.25.2.3.1.6';

/**
 * OIDs de tipo de storage HOST-RESOURCES-MIB (hrStorageTypes).
 * Valores sem ponto inicial — canonical form.
 *
 * SNMP agents may return these values with a leading dot (".1.3.6.1…") or
 * as symbolic names ("hrStorageRam"). normalizeStorageTypeOid() handles both.
 *
 *   hrStorageOther       : 1.3.6.1.2.1.25.2.1.1
 *   hrStorageRam         : 1.3.6.1.2.1.25.2.1.2   ← physical RAM
 *   hrStorageVirtualMemory: 1.3.6.1.2.1.25.2.1.3  ← swap/virtual — lower priority
 *   hrStorageFixedDisk   : 1.3.6.1.2.1.25.2.1.4
 *   hrStorageRemovableDisk: 1.3.6.1.2.1.25.2.1.5
 *   hrStorageFloppyDisk  : 1.3.6.1.2.1.25.2.1.6
 *   hrStorageCompactDisc : 1.3.6.1.2.1.25.2.1.7
 *   hrStorageRamDisk     : 1.3.6.1.2.1.25.2.1.8
 *   hrStorageFlashMemory : 1.3.6.1.2.1.25.2.1.9
 *   hrStorageNetworkDisk : 1.3.6.1.2.1.25.2.1.10
 */
export const STORAGE_TYPE_OTHER          = '1.3.6.1.2.1.25.2.1.1';
export const STORAGE_TYPE_RAM            = '1.3.6.1.2.1.25.2.1.2';
export const STORAGE_TYPE_VIRTUAL_MEMORY = '1.3.6.1.2.1.25.2.1.3';
export const STORAGE_TYPE_FIXED_DISK     = '1.3.6.1.2.1.25.2.1.4';
export const STORAGE_TYPE_REMOVABLE_DISK = '1.3.6.1.2.1.25.2.1.5';
export const STORAGE_TYPE_FLOPPY_DISK    = '1.3.6.1.2.1.25.2.1.6';
export const STORAGE_TYPE_COMPACT_DISC   = '1.3.6.1.2.1.25.2.1.7';
export const STORAGE_TYPE_RAM_DISK       = '1.3.6.1.2.1.25.2.1.8';
export const STORAGE_TYPE_FLASH_MEMORY   = '1.3.6.1.2.1.25.2.1.9';
export const STORAGE_TYPE_NETWORK_DISK   = '1.3.6.1.2.1.25.2.1.10';

/**
 * Symbolic-name → canonical OID mapping for hrStorageType values.
 * SNMP agents (especially UCD/Net-SNMP) may return the symbolic form.
 */
export const STORAGE_TYPE_SYMBOLIC: Record<string, string> = {
  hrStorageOther:        STORAGE_TYPE_OTHER,
  hrStorageRam:          STORAGE_TYPE_RAM,
  hrStorageVirtualMemory: STORAGE_TYPE_VIRTUAL_MEMORY,
  hrStorageFixedDisk:    STORAGE_TYPE_FIXED_DISK,
  hrStorageRemovableDisk: STORAGE_TYPE_REMOVABLE_DISK,
  hrStorageFloppyDisk:   STORAGE_TYPE_FLOPPY_DISK,
  hrStorageCompactDisc:  STORAGE_TYPE_COMPACT_DISC,
  hrStorageRamDisk:      STORAGE_TYPE_RAM_DISK,
  hrStorageFlashMemory:  STORAGE_TYPE_FLASH_MEMORY,
  hrStorageNetworkDisk:  STORAGE_TYPE_NETWORK_DISK,
};

/**
 * Normalizes an hrStorageType OID value to canonical form (no leading dot).
 *
 * Accepts:
 *   - Numeric OID with leading dot: ".1.3.6.1.2.1.25.2.1.2" → "1.3.6.1.2.1.25.2.1.2"
 *   - Numeric OID without dot: "1.3.6.1.2.1.25.2.1.2" → unchanged
 *   - Symbolic name: "hrStorageRam" → "1.3.6.1.2.1.25.2.1.2"
 *   - Null/empty → null
 */
export function normalizeStorageTypeOid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Symbolic name lookup.
  if (Object.prototype.hasOwnProperty.call(STORAGE_TYPE_SYMBOLIC, trimmed)) {
    return STORAGE_TYPE_SYMBOLIC[trimmed];
  }
  // Remove leading dot.
  return trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
}

/**
 * Physical RAM types (strict: only hrStorageRam).
 * hrStorageVirtualMemory (swap) is kept separate to allow priority ordering.
 */
export const PHYSICAL_RAM_TYPES = new Set([STORAGE_TYPE_RAM]);

/**
 * Virtual/swap memory types — treated as RAM but lower priority than physical.
 */
export const VIRTUAL_RAM_TYPES = new Set([STORAGE_TYPE_VIRTUAL_MEMORY]);

/** All RAM-like types (physical + virtual). */
export const RAM_STORAGE_TYPES = new Set([
  STORAGE_TYPE_RAM,
  STORAGE_TYPE_VIRTUAL_MEMORY,
]);

/** Types recognized as storage volumes/disks. */
export const VOLUME_STORAGE_TYPES = new Set([
  STORAGE_TYPE_FIXED_DISK,
  STORAGE_TYPE_REMOVABLE_DISK,
  STORAGE_TYPE_FLOPPY_DISK,
  STORAGE_TYPE_COMPACT_DISC,
  STORAGE_TYPE_RAM_DISK,
  STORAGE_TYPE_FLASH_MEMORY,
  STORAGE_TYPE_NETWORK_DISK,
]);

// ─── IF-MIB OIDs ──────────────────────────────────────────────────────────────

export const IF_TABLE_PREFIX          = '1.3.6.1.2.1.2.2.1';
export const IF_OPER_STATUS_PREFIX    = '1.3.6.1.2.1.2.2.1.8';
export const IF_IN_OCTETS_PREFIX      = '1.3.6.1.2.1.2.2.1.10';
export const IF_OUT_OCTETS_PREFIX     = '1.3.6.1.2.1.2.2.1.16';
export const IF_HC_IN_OCTETS_PREFIX   = '1.3.6.1.2.1.31.1.1.1.6';
export const IF_HC_OUT_OCTETS_PREFIX  = '1.3.6.1.2.1.31.1.1.1.10';
export const IF_NAME_PREFIX           = '1.3.6.1.2.1.31.1.1.1.1';
export const IF_IN_ERRORS_PREFIX      = '1.3.6.1.2.1.2.2.1.14';
export const IF_OUT_ERRORS_PREFIX     = '1.3.6.1.2.1.2.2.1.20';
export const IF_IN_DISCARDS_PREFIX    = '1.3.6.1.2.1.2.2.1.13';
export const IF_OUT_DISCARDS_PREFIX   = '1.3.6.1.2.1.2.2.1.19';

// ─── MIB-II system OIDs ───────────────────────────────────────────────────────

export const SYS_UPTIME_OID = '1.3.6.1.2.1.1.3.0';

// ─── Enterprise (Hikvision / Dahua / UCD) ────────────────────────────────────

// Hikvision
export const HIK_CPU_OID         = '1.3.6.1.4.1.39165.1.7.0';
export const HIK_MEM_USED_OID    = '1.3.6.1.4.1.39165.1.11.0';
export const HIK_MEM_TOTAL_OID   = '1.3.6.1.4.1.39165.1.10.0';
export const HIK_STORAGE_OID     = '1.3.6.1.4.1.39165.1.9.0';

// Dahua/Intelbras enterprise
export const DAHUA_CPU_OID       = '1.3.6.1.4.1.1004849.2.1.3.0';
export const DAHUA_MEM_OID       = '1.3.6.1.4.1.1004849.2.1.9.2.0';

// UCD-SNMP
export const UCD_MEM_AVAIL_OID   = '1.3.6.1.4.1.2021.4.6.0';   // kB livre
export const UCD_MEM_TOTAL_OID   = '1.3.6.1.4.1.2021.4.5.0';   // kB total
export const UCD_TEMP_OID        = '1.3.6.1.4.1.2021.13.16.2.1.3.1'; // milli-°C

// ─── Tipos de sondagem ────────────────────────────────────────────────────────

/**
 * Tipo de sondagem de um candidato:
 *   'get'  → OID escalar (GET — resultado oidResults do diagnóstico)
 *   'walk' → OID prefixo de tabela (resultado walk do diagnóstico)
 */
export type CandidateSource = 'get' | 'walk';

/**
 * Estratégia de agregação quando múltiplas entradas de walk são encontradas:
 *   'first' → primeiro valor válido encontrado
 *   'avg'   → média de todos os valores válidos
 *   'max'   → máximo dos valores válidos
 *   'sum'   → soma dos valores válidos
 *   'table' → retorna todas as entradas (array — processado pela camada semântica)
 */
export type AggregationStrategy = 'first' | 'avg' | 'max' | 'sum' | 'table';

/** Definição de um candidato OID no catálogo. */
export interface MetricCandidate {
  /** Fonte de dados. */
  source: CandidateSource;
  /**
   * OID escalar (source='get') ou prefixo de coluna de tabela (source='walk').
   * Para 'walk', o walk deve cobrir esse prefixo.
   */
  oid: string;
  /**
   * Transformação aplicada ao valor cru antes do scale:
   *   'none'        → valor bruto numérico
   *   'timeticks'   → ÷100 (já feito pelo normalizador de walk; mantido para GET)
   *   'milli'       → ÷1000 (milli-°C → °C)
   *   'kb_to_mb'    → ÷1024
   */
  transform?: 'none' | 'timeticks' | 'milli' | 'kb_to_mb' | 'kb_to_bytes' | 'mb_to_bytes';
  /** Fator multiplicativo aplicado após a transform. */
  scale?: number;
  /** Rótulo legível desta fonte (ex.: 'Hikvision Enterprise', 'MIB-II sysUpTime'). */
  label: string;
  /**
   * Tipo de contador SNMP quando o candidato é um acumulador cumulativo.
   * Ausente → valor direto (gauge/percentual).
   * 'counter32' | 'counter64' → valor bruto; persistência/polling deve aplicar
   * computeRate(prev, curr, elapsedMs) para obter taxa.
   */
  counterType?: 'counter32' | 'counter64';
}

/** Entrada do catálogo canônico. */
export interface CanonicalMetricEntry {
  /** Chave canônica (usada no resultado do diagnóstico). */
  canonicalKey: string;
  /** Nome amigável. */
  label: string;
  /** Unidade do valor final (para gauge/percentual). */
  unit: string;
  /**
   * Unidade do valor bruto quando isCounter=true.
   * Ex.: 'octets' para ifInOctets — a taxa publicada fica em B/s.
   */
  rawUnit?: string;
  /** Candidatos em ordem de prioridade (primeiro válido vence, exceto table/avg/max/sum). */
  candidates: MetricCandidate[];
  /** Estratégia de agregação (padrão: 'first'). */
  aggregation?: AggregationStrategy;
  /**
   * true quando a métrica é um contador cumulativo SNMP.
   * O valor no diagnóstico é o acumulador bruto no momento da leitura.
   * Para obter taxa, o polling usa computeRate(prev, curr, elapsed).
   * Afeta como a persistência interpreta o valor sugerido.
   */
  isCounter?: boolean;
}

/**
 * Catálogo canônico de métricas SNMP para resolução de diagnóstico.
 *
 * Ordem de candidatos:
 *   1. OIDs enterprise (mais específicos — Hikvision/Dahua)
 *   2. HOST-RESOURCES-MIB (padrão embarcado — mais rico que UCD)
 *   3. UCD-SNMP (Linux embarcado — fallback amplamente suportado)
 *   4. MIB-II (universal — mínimo garantido)
 *
 * Nota: candidatos de walk requerem que as entradas do walk cubram o prefixo.
 * Se o walk não foi executado ou não cobriu o prefixo, o candidato é ignorado.
 */
export const CANONICAL_METRIC_CATALOG: CanonicalMetricEntry[] = [
  // ── Alcançabilidade ──────────────────────────────────────────────────────────
  {
    canonicalKey: 'reachability',
    label: 'Alcançabilidade SNMP (sucesso %)',
    unit: '%',
    candidates: [
      // Derivada da alcançabilidade do diagnóstico — sem OID de binding.
      // oid=null é representado como string vazia aqui; o resolver trata como virtual.
      { source: 'get', oid: SYS_UPTIME_OID, label: 'MIB-II sysUpTime (probe de alcançabilidade)' },
    ],
    aggregation: 'first',
  },

  // Perda consolidada é uma métrica operacional opcional. Fontes específicas
  // (ping/gateway ou binding legado) podem preenchê-la; não inventamos OID.
  {
    canonicalKey: 'packet_loss',
    label: 'Perda de pacotes (%)',
    unit: '%',
    candidates: [],
    aggregation: 'first',
  },

  // ── Uptime ───────────────────────────────────────────────────────────────────
  {
    canonicalKey: 'uptime',
    label: 'Tempo ligado (s)',
    unit: 's',
    candidates: [
      // MIB-II sysUpTime (TimeTicks ÷100 → segundos).
      { source: 'get', oid: SYS_UPTIME_OID, transform: 'timeticks', label: 'MIB-II sysUpTime' },
      // Walk: TimeTicks já chega em segundos no walk (normalizado em fronteira).
      { source: 'walk', oid: SYS_UPTIME_OID, label: 'MIB-II sysUpTime (walk)' },
    ],
    aggregation: 'first',
  },

  // ── CPU ──────────────────────────────────────────────────────────────────────
  {
    canonicalKey: 'cpu_usage',
    label: 'Uso de CPU (%)',
    unit: '%',
    candidates: [
      // Enterprise Hikvision — mais específico.
      { source: 'get', oid: HIK_CPU_OID, label: 'Hikvision hikDeviceCPUUsageRate' },
      // Enterprise Dahua/Intelbras.
      { source: 'get', oid: DAHUA_CPU_OID, label: 'Dahua/Intelbras cpuUsage' },
      // HOST-RESOURCES-MIB hrProcessorLoad via walk (média de todas as CPUs).
      { source: 'walk', oid: HR_PROCESSOR_LOAD_PREFIX, label: 'HOST-RESOURCES hrProcessorLoad (tabela)' },
    ],
    // hrProcessorLoad da tabela colapsa para avg com detalhe de membros.
    aggregation: 'avg',
  },

  // ── Temperatura ──────────────────────────────────────────────────────────────
  {
    canonicalKey: 'cpu_temperature',
    label: 'Temperatura da CPU (°C)',
    unit: '°C',
    candidates: [
      // UCD lm-sensors — milli-°C → °C.
      { source: 'get', oid: UCD_TEMP_OID, transform: 'milli', label: 'UCD lm-sensors lsTemperature' },
      // Walk de toda a lm-sensors sensor table (primeiro sensor).
      { source: 'walk', oid: '1.3.6.1.4.1.2021.13.16.2.1.3', label: 'UCD lm-sensors (tabela)' },
    ],
    aggregation: 'first',
  },

  // ── Memória usada % ──────────────────────────────────────────────────────────
  {
    canonicalKey: 'memory_used_percent',
    label: 'Memória RAM usada (%)',
    unit: '%',
    candidates: [
      // Enterprise Hikvision — percentual direto.
      { source: 'get', oid: HIK_MEM_USED_OID, label: 'Hikvision hikDeviceMemUsedRate' },
      // Enterprise Dahua/Intelbras — percentual direto.
      { source: 'get', oid: DAHUA_MEM_OID, label: 'Dahua/Intelbras memoryUsage' },
      // HOST-RESOURCES-MIB hrStorageTable — RAM: usado/tamanho.
      // Candidato especial: fonte='walk' com prefixo da tabela — processado pelo resolver.
      { source: 'walk', oid: HR_STORAGE_SIZE_PREFIX, label: 'HOST-RESOURCES hrStorageTable (RAM)' },
    ],
    aggregation: 'first',
  },

  // ── Memória total ─────────────────────────────────────────────────────────────
  {
    canonicalKey: 'ram_total',
    label: 'Memória RAM total (bytes)',
    unit: 'bytes',
    candidates: [
      // HOST-RESOURCES-MIB hrMemorySize é KBytes por definição da MIB.
      { source: 'get', oid: HR_MEMORY_SIZE_OID, transform: 'kb_to_bytes', label: 'HOST-RESOURCES hrMemorySize (KBytes→bytes)' },
      // Enterprise Hikvision — MB diretamente (compatibilidade de perfil).
      { source: 'get', oid: HIK_MEM_TOTAL_OID, transform: 'mb_to_bytes', label: 'Hikvision hikDeviceMemTotalSize (MB→bytes)' },
      // UCD memTotalReal — kB → bytes.
      { source: 'get', oid: UCD_MEM_TOTAL_OID, transform: 'kb_to_bytes', label: 'UCD memTotalReal (kB→bytes)' },
      // HOST-RESOURCES-MIB hrStorageTable — tamanho da entrada RAM.
      { source: 'walk', oid: HR_STORAGE_SIZE_PREFIX, label: 'HOST-RESOURCES hrStorageTable (RAM total)' },
    ],
    aggregation: 'first',
  },

  // ── Storage usado % ───────────────────────────────────────────────────────────
  {
    canonicalKey: 'storage_used_percent',
    label: 'Armazenamento usado (%)',
    unit: '%',
    candidates: [
      // Enterprise Hikvision — percentual direto.
      { source: 'get', oid: HIK_STORAGE_OID, label: 'Hikvision hikDeviceHdUsageRate' },
      // HOST-RESOURCES-MIB hrStorageTable — volumes: usado/tamanho.
      { source: 'walk', oid: HR_STORAGE_SIZE_PREFIX, label: 'HOST-RESOURCES hrStorageTable (volumes)' },
    ],
    aggregation: 'first',
  },

  // ── Rede — taxa de entrada ────────────────────────────────────────────────────
  // COUNTER: valor bruto em octets (acumulador Counter32). A taxa B/s é calculada
  // por computeRate no polling. No diagnóstico o valor é o acumulador no momento.
  {
    canonicalKey: 'net_in_rate',
    label: 'Taxa de entrada de rede (B/s via Counter32)',
    unit: 'B/s',
    rawUnit: 'octets',
    isCounter: true,
    candidates: [
      { source: 'walk', oid: IF_HC_IN_OCTETS_PREFIX, label: 'IF-MIB ifHCInOctets (Counter64)', counterType: 'counter64' },
      { source: 'walk', oid: IF_IN_OCTETS_PREFIX, label: 'IF-MIB ifInOctets (Counter32 fallback)', counterType: 'counter32' },
    ],
    aggregation: 'first',
  },

  // ── Rede — taxa de saída ──────────────────────────────────────────────────────
  {
    canonicalKey: 'net_out_rate',
    label: 'Taxa de saída de rede (B/s via Counter32)',
    unit: 'B/s',
    rawUnit: 'octets',
    isCounter: true,
    candidates: [
      { source: 'walk', oid: IF_HC_OUT_OCTETS_PREFIX, label: 'IF-MIB ifHCOutOctets (Counter64)', counterType: 'counter64' },
      { source: 'walk', oid: IF_OUT_OCTETS_PREFIX, label: 'IF-MIB ifOutOctets (Counter32 fallback)', counterType: 'counter32' },
    ],
    aggregation: 'first',
  },

  // ── Rede — erros ─────────────────────────────────────────────────────────────
  // COUNTER: soma ifInErrors + ifOutErrors. Valor bruto = contador acumulado.
  {
    canonicalKey: 'net_error_rate',
    label: 'Erros de rede (pkt/s via Counter32)',
    unit: 'pkt/s',
    rawUnit: 'packets',
    isCounter: true,
    candidates: [
      // IF-MIB ifInErrors — index .1.
      { source: 'get', oid: `${IF_IN_ERRORS_PREFIX}.1`, label: 'IF-MIB ifInErrors.1', counterType: 'counter32' },
      // IF-MIB ifOutErrors — index .1.
      { source: 'get', oid: `${IF_OUT_ERRORS_PREFIX}.1`, label: 'IF-MIB ifOutErrors.1', counterType: 'counter32' },
      { source: 'walk', oid: IF_IN_ERRORS_PREFIX, label: 'IF-MIB ifInErrors (tabela)', counterType: 'counter32' },
    ],
    aggregation: 'sum',
  },

  // ── Rede — descartes ─────────────────────────────────────────────────────────
  {
    canonicalKey: 'net_discard_rate',
    label: 'Descartes de rede (pkt/s via Counter32)',
    unit: 'pkt/s',
    rawUnit: 'packets',
    isCounter: true,
    candidates: [
      // IF-MIB ifInDiscards — index .1.
      { source: 'get', oid: `${IF_IN_DISCARDS_PREFIX}.1`, label: 'IF-MIB ifInDiscards.1', counterType: 'counter32' },
      // IF-MIB ifOutDiscards — index .1.
      { source: 'get', oid: `${IF_OUT_DISCARDS_PREFIX}.1`, label: 'IF-MIB ifOutDiscards.1', counterType: 'counter32' },
      { source: 'walk', oid: IF_IN_DISCARDS_PREFIX, label: 'IF-MIB ifInDiscards (tabela)', counterType: 'counter32' },
    ],
    aggregation: 'sum',
  },

  // ── Interface status ──────────────────────────────────────────────────────────
  {
    canonicalKey: 'interface_status',
    label: 'Status da interface de rede',
    unit: '',
    candidates: [
      // IF-MIB ifOperStatus — index .1 (1=up, 2=down).
      { source: 'get', oid: `${IF_OPER_STATUS_PREFIX}.1`, label: 'IF-MIB ifOperStatus.1' },
      { source: 'walk', oid: IF_OPER_STATUS_PREFIX, label: 'IF-MIB ifOperStatus (tabela)' },
    ],
    aggregation: 'first',
  },
];

/** Indexado por chave canônica para lookup rápido. */
export const CANONICAL_METRIC_MAP: ReadonlyMap<string, CanonicalMetricEntry> =
  new Map(CANONICAL_METRIC_CATALOG.map((e) => [e.canonicalKey, e]));
