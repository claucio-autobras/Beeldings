/**
 * Resolver canônico de métricas SNMP para o diagnóstico.
 *
 * Recebe os resultados de GETs (oidResults) e walk do diagnóstico e resolve
 * as métricas canônicas do catálogo contra esses dados.
 *
 * Regras especiais:
 *   - hrProcessorLoad: colapsa todas as entradas da tabela à média (avg),
 *     preservando OIDs membros, valor máximo e detalhes por core.
 *   - hrStorageTable:
 *       • Normaliza hrStorageType (leading dot, symbolic names).
 *       • Distingue physical RAM (hrStorageRam) de virtual/swap (hrStorageVirtualMemory).
 *         Quando existem entradas físicas, virtual/swap não é selecionado como RAM primária.
 *       • Volumes preservados individualmente com labels hrStorageDescr.
 *       • memory_used_percent e ram_total derivados da RAM primária.
 *       • storage_used_percent = lista de volumes (não um único avg como conceito único).
 *   - Contadores (net_in/out/error/discard): valor bruto = acumulador Counter32.
 *     isCounter=true + counterType no resultado para que persistência/polling
 *     aplique computeRate. Não expõe como "taxa" pré-calculada.
 *   - OIDs desconhecidos passam inalterados (forward-compat).
 *   - Reachability: oid=null, valor derivado, confidence='exact'.
 *
 * Não emite I/O — função pura testável sem rede.
 */

import {
  CANONICAL_METRIC_CATALOG,
  HR_PROCESSOR_LOAD_PREFIX,
  HR_STORAGE_TYPE_PREFIX,
  HR_STORAGE_DESCR_PREFIX,
  HR_STORAGE_ALLOC_PREFIX,
  HR_STORAGE_SIZE_PREFIX,
  HR_STORAGE_USED_PREFIX,
  IF_HC_IN_OCTETS_PREFIX,
  IF_HC_OUT_OCTETS_PREFIX,
  IF_IN_OCTETS_PREFIX,
  IF_OUT_OCTETS_PREFIX,
  PHYSICAL_RAM_TYPES,
  VIRTUAL_RAM_TYPES,
  RAM_STORAGE_TYPES,
  VOLUME_STORAGE_TYPES,
  SYS_UPTIME_OID,
  IF_IN_ERRORS_PREFIX,
  IF_OUT_ERRORS_PREFIX,
  IF_IN_DISCARDS_PREFIX,
  IF_OUT_DISCARDS_PREFIX,
  normalizeStorageTypeOid,
  type CanonicalMetricEntry,
  type MetricCandidate,
  type AggregationStrategy,
} from './snmp-canonical-catalog';
import type { DiscoveredSnmpObject } from './snmp-walk.util';

// ─── Tipos de resultado ───────────────────────────────────────────────────────

/** Resultado de GET individual do diagnóstico. */
export interface OidReadResult {
  oid: string;
  responded: boolean;
  value: number | null;
  raw: string | null;
}

/** Seção de walk do diagnóstico (shape preservado — compatibilidade). */
export interface DiagWalkSection {
  root: string;
  label: string;
  entries: DiscoveredSnmpObject[];
  truncated: boolean;
  found: number;
  discarded: Record<string, number>;
  error: string | null;
  durationMs: number;
}

/**
 * Detalhe de uma entrada hrProcessorLoad (uma CPU/core).
 */
export interface ProcessorLoadDetail {
  oid: string;
  index: number | null;
  value: number;
}

/**
 * Detalhe de um volume de armazenamento (hrStorageTable).
 * Preservado individualmente por índice com label hrStorageDescr.
 */
export interface StorageVolumeDetail {
  index: number;
  /** Descrição do volume (hrStorageDescr). */
  descr: string | null;
  totalBytes: number | null;
  usedBytes: number | null;
  usedPercent: number | null;
}

/**
 * Confiança na resolução:
 *   'exact'    → valor lido diretamente de OID configurável como binding
 *   'inferred' → valor derivado de tabela/cálculo (ex.: hrStorageTable ratio)
 */
export type ResolutionConfidence = 'exact' | 'inferred';

/**
 * Valor de métrica canônica resolvido — inclui metadados de binding para persistência.
 *
 * Campos de binding:
 *   - `selectedOid`: OID concreto que produziu o valor (null para derivadas).
 *   - `confidence`: 'exact' = OID direto; 'inferred' = calculado/derivado.
 *   - `isCounter`: true → valor bruto cumulativo; persistência aplica computeRate.
 *   - `counterType`: 'counter32' | 'counter64' quando isCounter=true.
 *   - `memberOids`: OIDs membros (hrProcessorLoad, in+out errors, etc.).
 *   - `dependencyOids`: OIDs de colunas dependentes (hrStorage size/used/alloc).
 */
export interface ResolvedCanonicalMetric {
  canonicalKey: string;
  label: string;
  unit: string;
  /** Unidade do valor bruto quando isCounter=true (ex.: 'octets'). */
  rawUnit?: string;
  value: number | null;
  /** Rótulo legível da fonte (ex.: 'Hikvision hikDeviceCPUUsageRate'). */
  source: string | null;
  /** OID concreto selecionado (escalar) ou null para derivadas/tabelas. */
  selectedOid: string | null;
  /** Confiança na resolução. */
  confidence: ResolutionConfidence;
  /**
   * true quando o valor é um acumulador Counter32/64.
   * Persistência/polling deve chamar computeRate para obter taxa.
   */
  isCounter?: boolean;
  /** Tipo de contador SNMP quando isCounter=true. */
  counterType?: 'counter32' | 'counter64';
  /** Entradas individuais (hrProcessorLoad por core, hrStorage por volume). */
  detail?: ProcessorLoadDetail[] | StorageVolumeDetail[];
  /** Valor máximo (hrProcessorLoad — max de todas as CPUs). */
  maxValue?: number | null;
  /**
   * OIDs que contribuíram para o valor (hrProcessorLoad cores, if_in+if_out).
   * Usado pelo backend para persistência e sugestão de bindings.
   */
  memberOids?: string[];
  /**
   * OIDs de colunas dependentes consultadas (hrStorage: size, used, alloc).
   * Necessários para que o polling re-derive o valor em ciclos futuros.
   */
  dependencyOids?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Aplica transform ao valor cru do GET. */
function applyTransform(
  value: number,
  transform: MetricCandidate['transform'],
): number {
  switch (transform) {
    case 'timeticks': return value / 100;
    case 'milli':     return value / 1000;
    case 'kb_to_mb':  return value / 1024;
    case 'kb_to_bytes': return value * 1024;
    case 'mb_to_bytes': return value * 1024 * 1024;
    case 'none':
    default:          return value;
  }
}

/**
 * Coleta todas as entradas de walk cujo OID começa com `prefix`.
 * Retorna em ordem de OID (crescente pelo índice final).
 */
function walkEntriesUnder(
  walk: DiagWalkSection[],
  prefix: string,
): DiscoveredSnmpObject[] {
  const entries: DiscoveredSnmpObject[] = [];
  for (const section of walk) {
    for (const entry of section.entries) {
      if (entry.oid === prefix || entry.oid.startsWith(`${prefix}.`)) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

/**
 * Lê o valor numérico de um OID específico nas entradas de walk.
 * Retorna null quando o OID não foi coletado ou não tem valor numérico.
 */
function walkValueOf(walk: DiagWalkSection[], oid: string): number | null {
  for (const section of walk) {
    for (const entry of section.entries) {
      if (entry.oid === oid) {
        return entry.numeric;
      }
    }
  }
  return null;
}

// ─── hrProcessorLoad collapse ─────────────────────────────────────────────────

/**
 * Colapsa todas as entradas hrProcessorLoad da tabela à média.
 * Retorna o valor médio, o máximo, a lista de membros e os detalhes por core.
 *
 * Se nenhuma entrada for encontrada, retorna null.
 */
export function collapseHrProcessorLoad(
  walk: DiagWalkSection[],
  oidResults: Record<string, OidReadResult>,
): {
  avg: number | null;
  max: number | null;
  memberOids: string[];
  detail: ProcessorLoadDetail[];
} {
  const detail: ProcessorLoadDetail[] = [];
  const memberOids: string[] = [];

  // Tenta via walk primeiro (tabela completa — mais informação).
  const walkEntries = walkEntriesUnder(walk, HR_PROCESSOR_LOAD_PREFIX);
  for (const entry of walkEntries) {
    if (entry.numeric !== null) {
      detail.push({ oid: entry.oid, index: entry.index, value: entry.numeric });
      memberOids.push(entry.oid);
    }
  }

  // Complementa com entradas do oidResults que não vieram do walk.
  const walkOids = new Set(memberOids);
  for (const [oid, result] of Object.entries(oidResults)) {
    if (
      (oid === HR_PROCESSOR_LOAD_PREFIX || oid.startsWith(`${HR_PROCESSOR_LOAD_PREFIX}.`)) &&
      result.responded &&
      result.value !== null &&
      !walkOids.has(oid)
    ) {
      const lastDot = oid.lastIndexOf('.');
      const idx = lastDot >= 0 ? Number(oid.slice(lastDot + 1)) : null;
      detail.push({ oid, index: Number.isFinite(idx as number) ? idx : null, value: result.value });
      memberOids.push(oid);
    }
  }

  if (detail.length === 0) return { avg: null, max: null, memberOids: [], detail: [] };

  const values = detail.map((d) => d.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const max = Math.max(...values);

  return { avg, max, memberOids, detail };
}

// ─── hrStorageTable classification ───────────────────────────────────────────

/**
 * Entrada da hrStorageTable após classificação.
 * `typeOid` está normalizado (sem leading dot, sem símbolo).
 * `isPhysicalRam` distingue RAM física de swap/virtual.
 */
export interface HrStorageEntry {
  index: number;
  /** Canonical type OID (normalized, no leading dot). */
  typeOid: string | null;
  descr: string | null;
  allocationUnits: number | null;
  size: number | null;
  used: number | null;
  /** 'ram' | 'volume' | 'unknown' */
  kind: 'ram' | 'volume' | 'unknown';
  /**
   * true = hrStorageRam (physical).
   * false = hrStorageVirtualMemory (swap).
   * undefined = kind !== 'ram'.
   */
  isPhysicalRam?: boolean;
}

/**
 * Classifica as entradas da hrStorageTable em RAM vs volumes.
 *
 * Estratégia:
 *   1. Coleta todos os índices encontrados nas colunas de walk.
 *   2. Para cada índice, lê type, descr, allocationUnits, size, used.
 *   3. Normaliza hrStorageType (leading dot, symbolic name).
 *   4. Classifica: hrStorageRam → kind='ram', isPhysicalRam=true;
 *      hrStorageVirtualMemory → kind='ram', isPhysicalRam=false;
 *      fixed/removable/flash/etc → kind='volume'.
 *   5. Fallback por descr: 'ram', 'memory' → 'ram'; 'disk', 'partition'... → 'volume'.
 *      Descr contendo 'virtual', 'swap' → ram com isPhysicalRam=false.
 */
export function classifyHrStorageTable(
  walk: DiagWalkSection[],
  oidResults: Record<string, OidReadResult>,
): HrStorageEntry[] {
  // Reúne todos os índices presentes em qualquer coluna da hrStorageTable.
  const allPrefixes = [
    HR_STORAGE_TYPE_PREFIX,
    HR_STORAGE_DESCR_PREFIX,
    HR_STORAGE_ALLOC_PREFIX,
    HR_STORAGE_SIZE_PREFIX,
    HR_STORAGE_USED_PREFIX,
  ];

  const indexSet = new Set<number>();
  for (const prefix of allPrefixes) {
    for (const entry of walkEntriesUnder(walk, prefix)) {
      if (entry.index !== null) indexSet.add(entry.index);
    }
    // Também verifica oidResults.
    for (const oid of Object.keys(oidResults)) {
      if (oid.startsWith(`${prefix}.`)) {
        const suffix = oid.slice(prefix.length + 1);
        const idx = Number(suffix);
        if (Number.isFinite(idx) && idx > 0) indexSet.add(idx);
      }
    }
  }

  const entries: HrStorageEntry[] = [];

  for (const index of [...indexSet].sort((a, b) => a - b)) {
    // typeRaw: raw string value from walk or oidResults
    const typeRaw  = readStringValue(walk, oidResults, `${HR_STORAGE_TYPE_PREFIX}.${index}`);
    const descr    = readStringValue(walk, oidResults, `${HR_STORAGE_DESCR_PREFIX}.${index}`);
    const allocationUnits = readNumericValue(walk, oidResults, `${HR_STORAGE_ALLOC_PREFIX}.${index}`);
    const size     = readNumericValue(walk, oidResults, `${HR_STORAGE_SIZE_PREFIX}.${index}`);
    const used     = readNumericValue(walk, oidResults, `${HR_STORAGE_USED_PREFIX}.${index}`);

    // Normalize the type OID (handles leading dot, symbolic names).
    const typeOid  = normalizeStorageTypeOid(typeRaw);

    let kind: HrStorageEntry['kind'] = 'unknown';
    let isPhysicalRam: boolean | undefined;

    // Classifica por tipo OID normalizado.
    if (typeOid) {
      if (PHYSICAL_RAM_TYPES.has(typeOid)) {
        kind = 'ram';
        isPhysicalRam = true;
      } else if (VIRTUAL_RAM_TYPES.has(typeOid)) {
        kind = 'ram';
        isPhysicalRam = false;
      } else if (VOLUME_STORAGE_TYPES.has(typeOid)) {
        kind = 'volume';
      }
    }

    // Fallback por descr quando tipo não reconhecido.
    if (kind === 'unknown' && descr) {
      const d = descr.toLowerCase();
      if (/\b(virtual|swap)\b/.test(d)) {
        kind = 'ram';
        isPhysicalRam = false;
      } else if (/\b(ram|memory)\b/.test(d)) {
        kind = 'ram';
        isPhysicalRam = true; // assume physical when just "memory"
      } else if (/\b(disk|partition|flash|volume|storage|hdd|ssd|nand|nvme|eeprom)\b/.test(d)) {
        kind = 'volume';
      }
    }

    const entry: HrStorageEntry = {
      index,
      typeOid,
      descr,
      allocationUnits,
      size,
      used,
      kind,
    };
    if (kind === 'ram') {
      entry.isPhysicalRam = isPhysicalRam;
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Lê o valor string de um OID de walk ou oidResults.
 * Prioriza walk (preserva o raw string do agente), depois oidResults.raw.
 */
function readStringValue(
  walk: DiagWalkSection[],
  oidResults: Record<string, OidReadResult>,
  oid: string,
): string | null {
  // Walk: value é a string raw.
  for (const section of walk) {
    for (const entry of section.entries) {
      if (entry.oid === oid) return entry.value || null;
    }
  }
  // oidResults.
  const r = oidResults[oid];
  return r?.raw ?? null;
}

/**
 * Lê o valor numérico de um OID de walk ou oidResults.
 */
function readNumericValue(
  walk: DiagWalkSection[],
  oidResults: Record<string, OidReadResult>,
  oid: string,
): number | null {
  const wv = walkValueOf(walk, oid);
  if (wv !== null) return wv;
  const r = oidResults[oid];
  return r?.value ?? null;
}

// ─── Resolução de memória a partir de hrStorageTable ─────────────────────────

/**
 * Seleciona a entrada RAM primária da hrStorageTable.
 *
 * Prioridade:
 *   1. Entrada física (isPhysicalRam=true) com maior tamanho.
 *   2. Entrada virtual/swap (isPhysicalRam=false) com maior tamanho,
 *      apenas quando não existir entrada física.
 *
 * Nunca mistura física e virtual para o cálculo percentual.
 */
export function selectPrimaryRamEntry(entries: HrStorageEntry[]): HrStorageEntry | null {
  const ramEntries = entries.filter((e) => e.kind === 'ram' && e.size !== null && e.size > 0);
  if (ramEntries.length === 0) return null;

  // Prefere física.
  const physical = ramEntries.filter((e) => e.isPhysicalRam === true);
  const pool = physical.length > 0 ? physical : ramEntries;

  // Maior size dentro do pool selecionado.
  pool.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return pool[0];
}

/**
 * Resolve memory_used_percent e ram_total da hrStorageTable.
 *
 * Para a entrada RAM primária (física > virtual, maior tamanho):
 *   usedPercent = (used / size) * 100
 *   totalMb = size * allocationUnits / (1024 * 1024)
 */
export function resolveMemoryFromHrStorage(
  entries: HrStorageEntry[],
): {
  usedPercent: number | null;
  totalMb: number | null;
  sourceIndex: number | null;
  /** OIDs das colunas utilizadas (dependencyOids para binding). */
  dependencyOids: string[];
} {
  const main = selectPrimaryRamEntry(entries);

  if (!main) {
    return { usedPercent: null, totalMb: null, sourceIndex: null, dependencyOids: [] };
  }

  const usedPercent =
    main.used !== null && main.size !== null && main.size > 0
      ? (main.used / main.size) * 100
      : null;

  const totalMb =
    main.size !== null && main.allocationUnits !== null
      ? main.size * main.allocationUnits
      : null;

  const dependencyOids = [
    `${HR_STORAGE_SIZE_PREFIX}.${main.index}`,
    `${HR_STORAGE_USED_PREFIX}.${main.index}`,
    `${HR_STORAGE_ALLOC_PREFIX}.${main.index}`,
  ];

  return { usedPercent, totalMb, sourceIndex: main.index, dependencyOids };
}

/**
 * Resolve storage volumes da hrStorageTable.
 *
 * Para cada volume (kind='volume'):
 *   usedPercent = (used / size) * 100
 *   totalBytes = size * allocationUnits
 *   usedBytes  = used * allocationUnits
 *
 * Retorna volumes individualmente (não um único avg).
 * O campo `avgUsedPercent` é convenência para um valor escalar representativo.
 */
export function resolveStorageFromHrStorage(
  entries: HrStorageEntry[],
): {
  avgUsedPercent: number | null;
  volumes: StorageVolumeDetail[];
  dependencyOids: string[];
} {
  const volumes: StorageVolumeDetail[] = [];
  const dependencyOids: string[] = [];

  for (const entry of entries.filter((e) => e.kind === 'volume')) {
    const usedPercent =
      entry.used !== null && entry.size !== null && entry.size > 0
        ? (entry.used / entry.size) * 100
        : null;

    const alloc = entry.allocationUnits ?? 1;
    const totalBytes = entry.size !== null ? entry.size * alloc : null;
    const usedBytes  = entry.used !== null ? entry.used * alloc  : null;

    volumes.push({
      index: entry.index,
      descr: entry.descr,
      totalBytes,
      usedBytes,
      usedPercent,
    });

    dependencyOids.push(
      `${HR_STORAGE_SIZE_PREFIX}.${entry.index}`,
      `${HR_STORAGE_USED_PREFIX}.${entry.index}`,
      `${HR_STORAGE_ALLOC_PREFIX}.${entry.index}`,
    );
  }

  const percents = volumes.map((v) => v.usedPercent).filter((v): v is number => v !== null);
  const avgUsedPercent = percents.length > 0
    ? percents.reduce((a, b) => a + b, 0) / percents.length
    : null;

  return { avgUsedPercent, volumes, dependencyOids };
}

// ─── Motor principal de resolução ─────────────────────────────────────────────

/**
 * Resolve as métricas canônicas contra os resultados de diagnóstico SNMP.
 *
 * Entrada:
 *   - `reachable`: resultado do ping SNMP inicial
 *   - `oidResults`: resultados de GET do diagnóstico (keyed por OID)
 *   - `walk`: seções de walk do diagnóstico
 *
 * Saída: mapa de chave canônica → métrica resolvida.
 *
 * Regras:
 *   - OIDs respondidos com valor numérico são usados diretamente.
 *   - hrProcessorLoad colapsa à média com max, memberOids e detail por core.
 *   - hrStorageTable classifica RAM física vs virtual vs volumes;
 *     percentuais derivados; volumes preservados com labels individuais.
 *   - Candidatos 'walk' são tentados das entradas de walk disponíveis.
 *   - isCounter=true: valor bruto cumulativo; computeRate deve ser aplicado.
 *   - Candidatos sem dados são pulados sem erro.
 *   - OIDs desconhecidos não afetam nenhuma métrica canônica.
 */
export function resolveCanonicalMetrics(
  reachable: boolean,
  oidResults: Record<string, OidReadResult>,
  walk: DiagWalkSection[],
): Record<string, ResolvedCanonicalMetric> {
  const result: Record<string, ResolvedCanonicalMetric> = {};

  // Pré-computa hrProcessorLoad e hrStorageTable uma vez.
  const processorLoad = collapseHrProcessorLoad(walk, oidResults);
  const storageEntries = classifyHrStorageTable(walk, oidResults);
  const memFromStorage = resolveMemoryFromHrStorage(storageEntries);
  const storageFromHr  = resolveStorageFromHrStorage(storageEntries);

  for (const entry of CANONICAL_METRIC_CATALOG) {
    const resolved = resolveEntry(
      entry,
      reachable,
      oidResults,
      walk,
      processorLoad,
      storageEntries,
      memFromStorage,
      storageFromHr,
    );
    // Nunca devolva destaque com valor fora da semântica operacional. O
    // diagnóstico ainda preserva o OID/walk em suas seções técnicas.
    if (
      resolved.value !== null &&
      ((entry.canonicalKey === 'cpu_usage' || entry.canonicalKey === 'memory_used_percent' ||
        entry.canonicalKey === 'packet_loss') &&
        (resolved.value < 0 || resolved.value > 100) ||
        entry.canonicalKey === 'cpu_temperature' &&
        (resolved.value < -40 || resolved.value > 150))
    ) {
      result[entry.canonicalKey] = { ...resolved, value: null, confidence: 'inferred' };
    } else {
      result[entry.canonicalKey] = resolved;
    }
  }

  return result;
}

/** Resolve uma entrada do catálogo. */
function resolveEntry(
  entry: CanonicalMetricEntry,
  reachable: boolean,
  oidResults: Record<string, OidReadResult>,
  walk: DiagWalkSection[],
  processorLoad: ReturnType<typeof collapseHrProcessorLoad>,
  storageEntries: HrStorageEntry[],
  memFromStorage: ReturnType<typeof resolveMemoryFromHrStorage>,
  storageFromHr: ReturnType<typeof resolveStorageFromHrStorage>,
): ResolvedCanonicalMetric {
  const base: ResolvedCanonicalMetric = {
    canonicalKey: entry.canonicalKey,
    label: entry.label,
    unit: entry.unit,
    ...(entry.rawUnit ? { rawUnit: entry.rawUnit } : {}),
    value: null,
    source: null,
    selectedOid: null,
    confidence: 'exact',
    ...(entry.isCounter ? { isCounter: true } : {}),
  };

  // ── reachability (derivada, sem OID de binding) ───────────────────────────
  if (entry.canonicalKey === 'reachability') {
    return {
      ...base,
      // Mesma escala usada no polling contínuo: percentual 0–100.
      value: reachable ? 100 : 0,
      source: 'MIB-II sysUpTime (probe de alcançabilidade)',
      selectedOid: null,  // sem binding OID — valor sintético
      confidence: 'exact',
    };
  }

  // ── cpu_usage: colapso hrProcessorLoad ───────────────────────────────────
  if (entry.canonicalKey === 'cpu_usage') {
    // Tenta candidates de GET enterprise primeiro (Hikvision/Dahua).
    for (const candidate of entry.candidates.filter((c) => c.source === 'get')) {
      if (candidate.oid === HR_PROCESSOR_LOAD_PREFIX ||
          candidate.oid.startsWith(`${HR_PROCESSOR_LOAD_PREFIX}.`)) {
        continue; // Tratado abaixo via hrProcessorLoad.
      }
      const v = resolveGetCandidate(candidate, oidResults);
      if (v !== null) {
        return {
          ...base,
          value: v.value,
          source: candidate.label,
          selectedOid: candidate.oid,
          confidence: 'exact',
        };
      }
    }
    // hrProcessorLoad da tabela — colapso avg.
    if (processorLoad.avg !== null) {
      return {
        ...base,
        value: processorLoad.avg,
        source: 'HOST-RESOURCES hrProcessorLoad (avg de todos os cores)',
        selectedOid: null,
        confidence: 'inferred',
        maxValue: processorLoad.max,
        memberOids: processorLoad.memberOids,
        detail: processorLoad.detail,
        dependencyOids: processorLoad.memberOids,
      };
    }
    return base;
  }

  // ── memory_used_percent ───────────────────────────────────────────────────
  if (entry.canonicalKey === 'memory_used_percent') {
    // Tenta enterprise primeiro.
    for (const candidate of entry.candidates.filter((c) => c.source === 'get')) {
      const v = resolveGetCandidate(candidate, oidResults);
      if (v !== null) {
        return {
          ...base,
          value: v.value,
          source: candidate.label,
          selectedOid: candidate.oid,
          confidence: 'exact',
        };
      }
    }
    // hrStorageTable.
    if (memFromStorage.usedPercent !== null) {
      return {
        ...base,
        value: memFromStorage.usedPercent,
        source: 'HOST-RESOURCES hrStorageTable (RAM física preferida sobre virtual)',
        selectedOid: null,
        confidence: 'inferred',
        dependencyOids: memFromStorage.dependencyOids,
      };
    }
    return base;
  }

  // ── ram_total ─────────────────────────────────────────────────────────────
  if (entry.canonicalKey === 'ram_total') {
    // Tenta enterprise/UCD primeiro.
    for (const candidate of entry.candidates.filter((c) => c.source === 'get')) {
      if (candidate.oid === HR_STORAGE_SIZE_PREFIX ||
          candidate.oid.startsWith(`${HR_STORAGE_SIZE_PREFIX}.`)) {
        continue; // Tratado abaixo via hrStorageTable.
      }
      const v = resolveGetCandidate(candidate, oidResults);
      if (v !== null) {
        return {
          ...base,
          value: v.value,
          source: candidate.label,
          selectedOid: candidate.oid,
          confidence: 'exact',
        };
      }
    }
    // hrStorageTable.
    if (memFromStorage.totalMb !== null) {
      return {
        ...base,
        value: memFromStorage.totalMb,
        source: 'HOST-RESOURCES hrStorageTable (RAM física preferida sobre virtual)',
        selectedOid: null,
        confidence: 'inferred',
        dependencyOids: memFromStorage.dependencyOids,
      };
    }
    return base;
  }

  // ── storage_used_percent ──────────────────────────────────────────────────
  if (entry.canonicalKey === 'storage_used_percent') {
    // Tenta enterprise primeiro.
    for (const candidate of entry.candidates.filter((c) => c.source === 'get')) {
      if (candidate.oid === HR_STORAGE_SIZE_PREFIX ||
          candidate.oid.startsWith(`${HR_STORAGE_SIZE_PREFIX}.`)) {
        continue;
      }
      const v = resolveGetCandidate(candidate, oidResults);
      if (v !== null) {
        return {
          ...base,
          value: v.value,
          source: candidate.label,
          selectedOid: candidate.oid,
          confidence: 'exact',
        };
      }
    }
    // hrStorageTable (volumes individuais + avg representativo).
    if (storageFromHr.volumes.length > 0) {
      return {
        ...base,
        // Avg como valor escalar representativo; volumes individuais em detail.
        value: storageFromHr.avgUsedPercent,
        source: 'HOST-RESOURCES hrStorageTable (volumes individuais)',
        selectedOid: null,
        confidence: 'inferred',
        detail: storageFromHr.volumes,
        dependencyOids: storageFromHr.dependencyOids,
      };
    }
    return base;
  }

  // ── net_error_rate e net_discard_rate (soma de in+out, Counter32) ─────────
  if (entry.canonicalKey === 'net_error_rate' || entry.canonicalKey === 'net_discard_rate') {
    const inPrefix  = entry.canonicalKey === 'net_error_rate'   ? IF_IN_ERRORS_PREFIX   : IF_IN_DISCARDS_PREFIX;
    const outPrefix = entry.canonicalKey === 'net_error_rate'   ? IF_OUT_ERRORS_PREFIX  : IF_OUT_DISCARDS_PREFIX;
    const inOid1    = `${inPrefix}.1`;
    const outOid1   = `${outPrefix}.1`;
    const inCand    = entry.candidates.find((c) => c.oid === inOid1);
    const outCand   = entry.candidates.find((c) => c.oid === outOid1);
    const inVal     = inCand  ? resolveGetCandidate(inCand,  oidResults) : null;
    const outVal    = outCand ? resolveGetCandidate(outCand, oidResults) : null;

    if (inVal !== null || outVal !== null) {
      const sum = (inVal?.value ?? 0) + (outVal?.value ?? 0);
      const members = [
        ...(inVal  !== null ? [inOid1]  : []),
        ...(outVal !== null ? [outOid1] : []),
      ];
      const sourceCand = inCand ?? outCand;
      return {
        ...base,
        value: sum,
        source: `IF-MIB ${entry.canonicalKey === 'net_error_rate' ? 'ifInErrors+ifOutErrors' : 'ifInDiscards+ifOutDiscards'} (soma)`,
        selectedOid: null,
        confidence: 'inferred',
        isCounter: true,
        counterType: sourceCand?.counterType ?? 'counter32',
        memberOids: members,
        dependencyOids: members,
      };
    }

    // Fallback walk: correlaciona as colunas in/out pelo ifIndex e persiste
    // cada célula vencedora. O polling recorrente fará GET somente nesses OIDs
    // completos e calculará a taxa por contador antes de somar.
    const inWalkWithVals = walkEntriesUnder(walk, inPrefix).filter((e) => e.numeric !== null);
    const outWalkWithVals = walkEntriesUnder(walk, outPrefix).filter((e) => e.numeric !== null);
    const walkWithVals = [...inWalkWithVals, ...outWalkWithVals];
    if (walkWithVals.length > 0) {
      const sum = walkWithVals.reduce((acc, e) => acc + (e.numeric ?? 0), 0);
      const members = walkWithVals.map((e) => e.oid);
      return {
        ...base,
        value: sum,
        source: `IF-MIB ${entry.canonicalKey === 'net_error_rate' ? 'ifInErrors+ifOutErrors' : 'ifInDiscards+ifOutDiscards'} (walk, todos os índices)`,
        selectedOid: null,
        confidence: 'inferred',
        isCounter: true,
        counterType: 'counter32',
        memberOids: members,
        dependencyOids: members,
      };
    }

    return base;
  }

  // ── Caso geral: candidates em ordem, agregação simples ───────────────────
  return resolveGeneral(entry, oidResults, walk, base);
}

/** Tenta resolver o valor de um candidato GET escalar. */
function resolveGetCandidate(
  candidate: MetricCandidate,
  oidResults: Record<string, OidReadResult>,
): { value: number } | null {
  const r = oidResults[candidate.oid];
  if (!r?.responded || r.value === null) return null;
  const transformed = applyTransform(r.value, candidate.transform);
  const scaled = transformed * (candidate.scale ?? 1);
  return { value: scaled };
}

/** Tenta resolver o valor de um candidato walk. */
function resolveWalkCandidate(
  candidate: MetricCandidate,
  walk: DiagWalkSection[],
  aggregation: AggregationStrategy,
): { value: number; entries: DiscoveredSnmpObject[] } | null {
  const entries = walkEntriesUnder(walk, candidate.oid);
  const validEntries = entries.filter((e) => e.numeric !== null);
  const values = validEntries.map((e) => {
    const v = e.numeric as number;
    const transformed = applyTransform(v, candidate.transform);
    return transformed * (candidate.scale ?? 1);
  });

  if (values.length === 0) return null;

  let value: number;
  switch (aggregation) {
    case 'avg': value = values.reduce((a, b) => a + b, 0) / values.length; break;
    case 'max': value = Math.max(...values); break;
    case 'sum': value = values.reduce((a, b) => a + b, 0); break;
    default:    value = values[0]; break; // 'first'
  }

  return { value, entries: validEntries };
}

/** Resolve uma entrada de catálogo sem tratamento especial. */
function resolveGeneral(
  entry: CanonicalMetricEntry,
  oidResults: Record<string, OidReadResult>,
  walk: DiagWalkSection[],
  base: ResolvedCanonicalMetric,
): ResolvedCanonicalMetric {
  const aggregation = entry.aggregation ?? 'first';

  for (const candidate of entry.candidates) {
    if (candidate.source === 'get') {
      const v = resolveGetCandidate(candidate, oidResults);
      if (v !== null) {
        return {
          ...base,
          value: v.value,
          source: candidate.label,
          selectedOid: candidate.oid,
          confidence: 'exact',
          ...(candidate.counterType ? { isCounter: true, counterType: candidate.counterType } : {}),
        };
      }
    } else {
      // A diagnostic can probe a concrete table instance with GET even when
      // the catalog candidate is a walk prefix. Accept that response before
      // falling back to the walk.
      const instanceOid = `${candidate.oid}.1`;
      const exact = resolveGetCandidate({ ...candidate, oid: instanceOid }, oidResults);
      if (exact !== null) {
        return {
          ...base,
          value: exact.value,
          source: candidate.label,
          selectedOid: instanceOid,
          confidence: 'exact',
          ...(candidate.counterType ? { isCounter: true, counterType: candidate.counterType } : {}),
        };
      }
      const v = resolveWalkCandidate(candidate, walk, aggregation);
      if (v !== null) {
        // aggregation='first' escolhe UMA instância concreta. Persistir todos
        // os OIDs descobertos faria o polling tratar interfaces alternativas
        // como membros de um agregado, contrariando a cadeia de fallback.
        const selectedEntry = v.entries[0];
        const memberOids =
          aggregation === 'first' ? [] : v.entries.map((e) => e.oid);
        return {
          ...base,
          value: v.value,
          source: candidate.label,
          // Em fallback de tabela com 'first', fixa o OID vencedor para que a
          // coleta futura faça GET somente dessa instância.
          selectedOid: aggregation === 'first' ? selectedEntry?.oid ?? null : null,
          confidence: aggregation === 'first' ? 'exact' : 'inferred',
          ...(candidate.counterType ? { isCounter: true, counterType: candidate.counterType } : {}),
          ...(memberOids.length > 1 ? { memberOids, dependencyOids: memberOids } : {}),
        };
      }
    }
  }

  return base;
}
