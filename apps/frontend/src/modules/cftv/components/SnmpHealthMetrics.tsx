'use client';

/**
 * SnmpHealthMetrics — seção de métricas SNMP dos cards de CFTV e SCA.
 *
 * Renderização 100% orientada ao payload (`point.display` derivado por dados
 * no backend): destaques por importância, agrupamento por categoria, seção de
 * informações estáticas (firmware, serial, NTP…) e "ver mais" para o
 * restante. Nenhuma lógica por fabricante e nenhum grid fixo — o card mostra
 * o que o equipamento realmente expõe:
 *  - ponto com OID mas sem leitura → "sem leitura" (neutro);
 *  - OID comprovadamente inexistente → resumido em "Este equipamento não
 *    expõe: …" (nunca ocupa célula);
 *  - métrica fora do catálogo (custom/semântica) → aparece do mesmo jeito.
 */

import { createElement, useState } from 'react';
import { useT } from '@/lib/i18n';
import {
  AppWindow,
  Box,
  ChevronDown,
  ChevronRight,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Shield,
  Tag,
  Thermometer,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  CameraPoint,
  SnmpCardCategory,
  SnmpInfoEntry,
  SnmpPointDisplay,
} from '../services/cftv.service';
import { formatUptime } from '../utils/telemetry-format';
import {
  buildIfNameIndex,
  getIfLabelSuffix,
  IF_DESCR_OID_PREFIX,
} from '../utils/snmp-interface-labels';
import {
  canonicalHealthKey,
  displayForHealth,
  formatHealthValue,
  healthRank,
  normalizeHealthReading,
  selectOperationalPoints,
} from '../utils/snmp-health';
import { isUnsupportedHealthPoint } from '@/components/health-metrics';

// ─── Fallbacks p/ payloads antigos (backend sem `display`) ───────────────────

const FALLBACK_DISPLAY: Record<string, Omit<SnmpPointDisplay, 'unit'>> = {
  cpu: { category: 'performance', categoryLabel: 'Desempenho', label: 'Uso de CPU', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  cpu_usage: { category: 'performance', categoryLabel: 'Desempenho', label: 'Uso de CPU', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  cpu_usage_peak: { category: 'performance', categoryLabel: 'Desempenho', label: 'Pico de CPU', importance: 'secondary', origin: 'canonical', valueKind: 'number' },
  cpu_temperature: { category: 'hardware', categoryLabel: 'Hardware', label: 'Temperatura da CPU', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  memory: { category: 'performance', categoryLabel: 'Desempenho', label: 'Memória', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  memory_used_percent: { category: 'performance', categoryLabel: 'Desempenho', label: 'Memória usada', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  memory_total: { category: 'performance', categoryLabel: 'Desempenho', label: 'Memória total', importance: 'secondary', origin: 'canonical', valueKind: 'number' },
  ram_total: { category: 'performance', categoryLabel: 'Desempenho', label: 'Memória RAM total', importance: 'secondary', origin: 'canonical', valueKind: 'number' },
  storage: { category: 'storage', categoryLabel: 'Armazenamento', label: 'Armazenamento', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  storage_used_percent: { category: 'storage', categoryLabel: 'Armazenamento', label: 'Uso do volume', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  temperature: { category: 'hardware', categoryLabel: 'Hardware', label: 'Temperatura', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  packet_loss: { category: 'network', categoryLabel: 'Rede', label: 'Pacotes perdidos', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  ping_loss: { category: 'network', categoryLabel: 'Rede', label: 'Perda de ping', importance: 'secondary', origin: 'canonical', valueKind: 'number' },
  reachability: { category: 'system', categoryLabel: 'Sistema', label: 'Alcançabilidade', importance: 'primary', origin: 'canonical', valueKind: 'number' },
  reachability_latency: { category: 'system', categoryLabel: 'Sistema', label: 'Latência SNMP', importance: 'secondary', origin: 'canonical', valueKind: 'number' },
  reachability_failure_rate: { category: 'system', categoryLabel: 'Sistema', label: 'Taxa de falha', importance: 'secondary', origin: 'canonical', valueKind: 'number' },
};

/** Ordem de exibição das categorias no "ver mais". */
const CATEGORY_ORDER: SnmpCardCategory[] = [
  'performance',
  'hardware',
  'storage',
  'network',
  'system',
  'application',
  'security',
  'identification',
  'other',
];

const HEALTH_METRICS_FOR_SUMMARY = new Set([
  'reachability',
  'status',
  'packet_loss',
  'ping_loss',
  'net_error_rate',
  'net_discard_rate',
]);

function displayOf(p: CameraPoint): SnmpPointDisplay {
  if (p.display) return p.display;
  const fb = FALLBACK_DISPLAY[p.metric];
  if (fb) return { ...fb, unit: p.unit || null };
  return {
    category: 'other',
    categoryLabel: 'Outras métricas',
    label: p.objectName || p.tag,
    importance: 'secondary',
    origin: 'custom',
    valueKind: 'number',
    unit: p.unit || null,
  };
}

/** Formata um valor numérico com a unidade do ponto. */
export function formatSnmpValue(
  value: number,
  display: SnmpPointDisplay,
  metric?: string,
): string {
  const shared = formatHealthValue(metric ?? '', value, display.unit);
  if (shared !== null) return shared;
  if (metric === 'uptime') return formatUptime(value);
  // Convenção SNMP TruthValue: 1=true, 2=false (0 também falso) — nunca >=1.
  if (display.valueKind === 'boolean') return value === 1 ? 'Sim' : 'Não';
  const unit = (display.unit ?? '').trim();
  const isTemp = unit.startsWith('°') || metric === 'temperature';
  const v = isTemp
    ? value.toFixed(1)
    : Number.isInteger(value)
      ? String(value)
      : Math.abs(value) < 100
        ? String(Math.round(value * 10) / 10)
        : String(Math.round(value));
  if (!unit) return v;
  return unit.startsWith('°') || unit === '%' ? `${v}${unit}` : `${v} ${unit}`;
}

// ─── Tiles (variante "tiles" — SCA) ──────────────────────────────────────────

/** Ícone por métrica (canônicas primeiro) com fallback por categoria. */
const METRIC_ICON: Record<string, LucideIcon> = {
  cpu: Cpu,
  cpu_usage: Cpu,
  cpu_usage_peak: Cpu,
  cpu_temperature: Thermometer,
  memory: MemoryStick,
  memory_used_percent: MemoryStick,
  memory_total: MemoryStick,
  ram_total: MemoryStick,
  storage: HardDrive,
  storage_used_percent: HardDrive,
  temperature: Thermometer,
  packet_loss: Box,
  ping_loss: Box,
  reachability: Network,
  reachability_latency: Network,
  reachability_failure_rate: Network,
};

const CATEGORY_ICON: Record<SnmpCardCategory, LucideIcon> = {
  performance: Gauge,
  hardware: Thermometer,
  storage: HardDrive,
  network: Network,
  system: Gauge,
  application: AppWindow,
  security: Shield,
  identification: Tag,
  other: Gauge,
};

function tileIcon(row: Row): LucideIcon {
  return METRIC_ICON[row.point.metric] ?? CATEGORY_ICON[row.display.category] ?? Gauge;
}

/** Paleta cíclica dos tiles (ícone colorido + barra), como no mockup. */
const TILE_PALETTE = [
  {
    icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    bar: 'bg-emerald-500',
    label: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400',
    bar: 'bg-sky-500',
    label: 'text-sky-600 dark:text-sky-400',
  },
  {
    icon: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    bar: 'bg-amber-500',
    label: 'text-amber-600 dark:text-amber-400',
  },
  {
    icon: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
    bar: 'bg-violet-500',
    label: 'text-violet-600 dark:text-violet-400',
  },
  {
    icon: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
    bar: 'bg-rose-500',
    label: 'text-rose-600 dark:text-rose-400',
  },
  {
    icon: 'bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400',
    bar: 'bg-teal-500',
    label: 'text-teal-600 dark:text-teal-400',
  },
] as const;

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Escala conhecida de uma métrica → barra de progresso + rótulo qualitativo.
 * Retorna null quando não há faixa conhecida (ex.: memória em kB sem total) —
 * nesses casos o tile mostra só o valor, sem barra fake.
 */
function tileScale(row: Row, t: (s: string) => string): { pct: number; label: string } | null {
  if (row.value === null || row.display.valueKind === 'boolean') return null;
  const v = row.value;
  const unit = (row.display.unit ?? '').trim();
  // Percentuais: escala 0–100 direta.
  if (unit === '%') return { pct: clampPct(v), label: `${Math.round(v)}%` };
  // Temperatura: faixa operacional típica de eletrônica embarcada.
  if (row.point.metric === 'temperature') {
    const label = v < 50 ? t('Normal') : v < 70 ? t('Elevada') : t('Alta');
    return { pct: clampPct((v / 90) * 100), label };
  }
  // Qualidade de pacotes: menos perdas = melhor (barra cheia = excelente).
  if (row.point.metric === 'packet_loss' || row.point.metric === 'ping_loss') {
    if (v <= 0) return { pct: 100, label: t('Excelente') };
    if (v <= 2) return { pct: 75, label: t('Boa') };
    if (v <= 10) return { pct: 45, label: t('Regular') };
    return { pct: 20, label: t('Ruim') };
  }
  return null;
}

function MetricTile({
  row,
  index,
  label,
  t,
  onRemove,
}: {
  row: Row;
  index: number;
  label: string;
  t: (s: string) => string;
  onRemove?: () => void;
}) {
  const palette = TILE_PALETTE[index % TILE_PALETTE.length];
  const scale = tileScale(row, t);
  const has = row.value !== null;
  return (
      <div className="group relative min-w-0 rounded-lg border border-border/70 bg-muted/30 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${palette.icon}`}
        >
          {createElement(tileIcon(row), { className: 'h-4 w-4' })}
        </span>
        <p
          className="min-w-0 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80"
          title={label}
        >
          {label}
        </p>
      </div>
      <p
        className={
          row.unreliable
            ? 'text-sm font-semibold text-amber-600 dark:text-amber-400'
            : has
              ? 'text-sm font-semibold text-foreground'
              : 'text-xs text-muted-foreground'
        }
        title={
          row.unreliable
            ? t('Dado não confiável — o firmware responde um valor fixo neste OID.')
            : !has
              ? t('OID configurado — aguardando leitura do gateway.')
              : undefined
        }
      >
        {has
          ? `${formatSnmpValue(row.value as number, row.display, row.point.metric)}${row.unreliable ? ' ⚠' : ''}`
          : t('sem leitura')}
      </p>
      {scale && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${palette.bar}`}
              style={{ width: `${scale.pct}%` }}
            />
          </div>
          <span className={`shrink-0 text-[10px] font-medium ${palette.label}`}>
            {scale.label}
          </span>
        </div>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 group-hover:block dark:hover:bg-red-500/10"
          title={t('Remover ponto de monitoramento')}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

/** Leitura ao vivo (ou seed) de um ponto — shape mínimo de liveOrSeed. */
export interface SnmpMetricEntry {
  value: unknown;
  unreliable?: boolean;
}

interface Props {
  points: CameraPoint[];
  /** Informações estáticas do último diagnóstico (Device.config.snmpInfo). */
  snmpInfo?: SnmpInfoEntry[];
  /** Resolve a leitura atual de um ponto pela tag (liveOrSeed). */
  getEntry: (tag: string) => SnmpMetricEntry | undefined;
  /** "câmera" | "controladora" — usado nos textos. */
  deviceLabel?: string;
  /**
   * Se true, exibe o botão de remoção individual por ponto (restrito a
   * ADMIN/CCO — o pai decide se deve passar true).
   */
  canRemove?: boolean;
  /**
   * Callback chamado quando o operador confirma a remoção de um ponto.
   * O pai é responsável por chamar o endpoint e refazer o fetch.
   */
  onRemovePoint?: (pointId: string, pointName: string) => void;
  /**
   * Estilo dos destaques primários: 'compact' (padrão — CFTV) mantém a grade
   * enxuta; 'tiles' (SCA) renderiza tiles com ícone colorido e barra de
   * progresso quando a métrica tem escala conhecida.
   */
  variant?: 'compact' | 'tiles' | 'sca';
  /**
   * Exibe as métricas secundárias e informações estáticas atrás do expansor.
   * Pode ser desligado por um card que já tenha um caminho próprio para o
   * diagnóstico completo, sem alterar os cards compartilhados.
   */
  showDetails?: boolean;
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface Row {
  point: CameraPoint;
  display: SnmpPointDisplay;
  value: number | null;
  unreliable: boolean;
  healthState?: CameraPoint['healthState'];
}

function MetricValue({ row, t }: { row: Row; t: (s: string) => string }) {
  const { point, display, value, unreliable } = row;
  const pending = point.healthState === 'pending' && value === null;
  const broken = point.healthState === 'broken';
  const has = value !== null && !broken;
  return (
    <p
      className={
        unreliable
          ? 'font-medium text-amber-600 dark:text-amber-400'
          : has
            ? 'font-medium text-foreground'
            : 'text-muted-foreground'
      }
      title={
        unreliable
          ? t('Dado não confiável — o firmware responde um valor fixo neste OID.')
          : broken
            ? t('A fonte configurada não respondeu — corrija o OID no diagnóstico.')
            : pending
              ? t('Fonte alterada — aguardando a primeira leitura do gateway.')
              : !has
            ? t('OID configurado — aguardando leitura do gateway.')
            : undefined
      }
    >
      {has
        ? `${formatSnmpValue(value, display, point.metric)}${unreliable ? ' ⚠' : ''}`
        : broken
          ? t('fonte quebrada')
          : pending
            ? t('atualização pendente')
            : t('sem leitura')}
    </p>
  );
}

/**
 * Agrupa pontos de cpu/cpu_usage em um único "Uso de CPU" exibindo a média
 * como valor principal e os núcleos individuais acessíveis via tooltip/detail.
 * Retorna null quando não há pontos de CPU para agrupar (passthrough normal).
 */
interface CpuAggregate {
  /** Linha sintética para exibição (valor = média). */
  synthetic: Row;
  /** Linhas originais (núcleos individuais). */
  originals: Row[];
  /** Máximo entre os núcleos. */
  max: number | null;
}

function buildCpuAggregate(rows: Row[]): { cpuRow: CpuAggregate | null; rest: Row[] } {
  const cpuRows = rows.filter(
    (r) => r.point.metric === 'cpu' || r.point.metric === 'cpu_usage',
  );
  const peakRow = rows.find((r) => r.point.metric === 'cpu_usage_peak') ?? null;
  const rest = rows.filter(
    (r) =>
      r.point.metric !== 'cpu' &&
      r.point.metric !== 'cpu_usage' &&
      r.point.metric !== 'cpu_usage_peak',
  );
  if (cpuRows.length === 0) return { cpuRow: null, rest };
  if (cpuRows.length === 1 && !peakRow) return { cpuRow: null, rest: rows };

  const withValues = cpuRows.filter((r) => r.value !== null);
  const avg =
    withValues.length > 0
      ? withValues.reduce((s, r) => s + (r.value as number), 0) / withValues.length
      : null;
  const max = peakRow?.value ??
    (withValues.length > 0
      ? Math.max(...withValues.map((r) => r.value as number))
      : null);

  // Use the first row as a template for display metadata
  const template = cpuRows[0];
  const synthetic: Row = {
    point: template.point,
    display: {
      ...template.display,
      label: 'Uso de CPU',
    },
    value: avg,
    unreliable: cpuRows.some((r) => r.unreliable),
  };

  return { cpuRow: { synthetic, originals: cpuRows, max }, rest };
}

/**
 * Retorna um label distinto por ponto de memória:
 * - memory_used_percent / memory com % → "Memória usada (%)"
 * - memory_total / ram_total → "Memória total"
 * - memory com kB/MB/GB → "Memória (kB)" etc.
 * - outros → label original.
 */
function memoryLabel(row: Row): string {
  const metric = row.point.metric;
  if (metric === 'memory_used_percent') return 'Memória usada (%)';
  if (metric === 'memory_total' || metric === 'ram_total') return 'Memória total';
  const unit = (row.display.unit ?? '').trim();
  if (unit === '%') return 'Memória (%)';
  if (unit) return `Memória (${unit})`;
  return row.display.label;
}

/**
 * Retorna um label distinto por ponto de storage:
 * usa o objectName ou display.label que inclui o volume se disponível,
 * ou o índice extraído da OID como sufixo.
 * Reconhece 'storage' e 'storage_used_percent'.
 */
function storageLabel(row: Row): string {
  const metric = row.point.metric;
  // storage_used_percent: add "(%) " prefix to distinguish from raw bytes
  const base = row.point.objectName || row.display.label;
  const genericLabels = ['Armazenamento', 'storage', 'storage_used_percent'];
  if (base && !genericLabels.includes(base)) {
    if (metric === 'storage_used_percent') return `${base} (%)`;
    return base;
  }
  // Tenta extrair índice do OID para diferenciar volumes.
  const oid = row.point.oid ?? '';
  const match = oid.match(/\.(\d+)$/);
  const prefix = metric === 'storage_used_percent' ? 'Armazenamento (%)' : 'Armazenamento';
  if (match) return `${prefix} vol. ${match[1]}`;
  return metric === 'storage_used_percent' ? 'Armazenamento (%)' : row.display.label;
}

export function SnmpHealthMetrics({
  points,
  snmpInfo,
  getEntry,
  deviceLabel = 'equipamento',
  canRemove = false,
  onRemovePoint,
  variant = 'compact',
  showDetails = true,
}: Props) {
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);
  const [cpuDetailOpen, setCpuDetailOpen] = useState(false);

  /** True se o botão de remoção deve aparecer para este ponto. */
  const showRemove = (p: CameraPoint) =>
    canRemove && Boolean(onRemovePoint) && p.removable !== false && p.tag !== 'STATUS' && p.metric !== 'status';

  // STATUS vai no badge do card e uptime no cabeçalho — fora da grade.
  const metricPoints = selectOperationalPoints(points).filter(
    (p) => p.tag !== 'STATUS' && p.metric !== 'STATUS',
  );

  /** OIDs comprovadamente inexistentes — nunca ocupam célula. */
  const notExposed: Row[] = [];
  const rows: Row[] = [];
  for (const point of metricPoints) {
    const display = displayForHealth(point, displayOf(point));
    const entry = getEntry(point.tag);
    const unsupported = isUnsupportedHealthPoint(point);
    const n = unsupported
      ? null
      : normalizeHealthReading(point.metric, entry?.value, display.unit || point.unit);
    const has = n !== null && point.healthState !== 'broken' && !unsupported;
    const row: Row = {
      point,
      display,
      value: has ? n : null,
      unreliable: has && entry?.unreliable === true,
      healthState: point.healthState,
    };
    if (!has && unsupported) notExposed.push(row);
    else rows.push(row);
  }

  const catRank = (c: SnmpCardCategory) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };

  /**
   * Prioridade de exibição: reachability/status primeiro, depois por categoria
   * e importância, depois alfabético.
   */
  const metricPriority = (r: Row): number => {
    const m = r.point.metric;
    if (m === 'reachability' || m === 'status') return -2;
    if (canonicalHealthKey(m)) return -1 + healthRank(m) / 100;
    if (r.display.importance === 'primary') return -1;
    return catRank(r.display.category);
  };

  rows.sort(
    (a, b) =>
      metricPriority(a) - metricPriority(b) ||
      a.display.label.localeCompare(b.display.label, 'pt-BR'),
  );

  // ── CPU aggregation ────────────────────────────────────────────────────────
  const { cpuRow, rest: rowsAfterCpu } = buildCpuAggregate(rows);

  // ── Effective rows list (replace multiple CPU with aggregate) ─────────────
  const effectiveRows: Row[] = cpuRow
    ? [cpuRow.synthetic, ...rowsAfterCpu]
    : rows;

  /**
   * SCA tem um resumo fixo e legível, sem transformar métricas extras em uma
   * grade imprevisível. A seleção continua orientada ao payload: só entram
   * pontos realmente configurados; as demais métricas permanecem no diagnóstico.
   */
  const scaRows = (() => {
    if (variant !== 'sca') return [];
    const preferred = [
      'cpu_usage',
      'cpu',
      'memory_used_percent',
      'memory_usage',
      'memory',
      'ram_total',
      'memory_total',
      'temperature',
      'cpu_temperature',
      'packet_loss',
      'ping_loss',
    ];
    const selected: Row[] = [];
    for (const metric of preferred) {
      const row = effectiveRows.find(
        (candidate) => candidate.point.metric === metric && !selected.includes(candidate),
      );
      if (row) selected.push(row);
      if (selected.length === 6) break;
    }
    if (selected.length < 6) {
      for (const row of effectiveRows) {
        if (!selected.includes(row) && !HEALTH_METRICS_FOR_SUMMARY.has(row.point.metric)) {
          selected.push(row);
        }
        if (selected.length === 6) break;
      }
    }
    return selected;
  })();

  const primary = effectiveRows.filter((r) => r.display.importance === 'primary');
  const secondary = effectiveRows.filter((r) => r.display.importance !== 'primary');
  const info = snmpInfo ?? [];

  // ── Interface labeling ─────────────────────────────────────────────────────
  const ifNameByIndex = buildIfNameIndex(info);

  /** Retorna " — eth0" quando o ponto é uma métrica de interface identificável. */
  const ifSuffix = (row: Row) =>
    getIfLabelSuffix(row.point.oid, row.display.category, ifNameByIndex);

  /** Resolve o rótulo de exibição de uma row, com lógica especial para memória e storage. */
  const resolveLabel = (row: Row): string => {
    const metric = row.point.metric;
    if (
      metric === 'memory' ||
      metric === 'memory_usage' ||
      metric === 'ram_total' ||
      metric === 'memory_used_percent' ||
      metric === 'memory_total'
    ) {
      return memoryLabel(row);
    }
    if (metric === 'storage' || metric === 'storage_used_percent') {
      return storageLabel(row);
    }
    return row.display.label + ifSuffix(row);
  };

  // Entradas de snmpInfo visíveis no "Ver mais":
  // • ifDescr cruas viram rótulo de interface e somem como itens soltos;
  // • entradas com label "OID …" ou "Unknown OID …" ficam num subgrupo
  //   recolhido separado e exibidas como "OID desconhecido" em vez de
  //   expor o OID bruto ao operador.
  const isUnknownInfoEntry = (e: { oid: string; label: string }) =>
    e.label.startsWith('OID ') || e.label.startsWith('Unknown OID ');
  const namedInfo = info.filter(
    (e) => !e.oid.startsWith(IF_DESCR_OID_PREFIX) && !isUnknownInfoEntry(e),
  );
  const unknownOidInfo = info.filter(
    (e) => !e.oid.startsWith(IF_DESCR_OID_PREFIX) && isUnknownInfoEntry(e),
  );

  // Sem nada para mostrar: estado vazio explícito (nunca grade em branco).
  if (rows.length === 0 && notExposed.length === 0 && info.length === 0) {
    return (
      <div className="border-t border-border pt-2 text-xs text-muted-foreground">
        {t('Nenhuma métrica SNMP configurada — use o diagnóstico para descobrir o que este')}{' '}
        {deviceLabel} {t('expõe.')}
      </div>
    );
  }

  /** Agrupa linhas secundárias + informações por categoria (ordem fixa). */
  const moreGroups: Array<{
    category: SnmpCardCategory;
    label: string;
    rows: Row[];
    info: SnmpInfoEntry[];
  }> = [];
  const groupFor = (category: SnmpCardCategory, label: string) => {
    let g = moreGroups.find((x) => x.category === category);
    if (!g) {
      g = { category, label, rows: [], info: [] };
      moreGroups.push(g);
    }
    return g;
  };
  for (const r of secondary) groupFor(r.display.category, r.display.categoryLabel).rows.push(r);
  for (const e of namedInfo) {
    const label =
      moreGroups.find((g) => g.category === e.category)?.label ??
      CATEGORY_LABEL_FALLBACK[e.category] ??
      e.category;
    groupFor(e.category, label).info.push(e);
  }
  moreGroups.sort((a, b) => catRank(a.category) - catRank(b.category));

  const moreCount = secondary.length + namedInfo.length + unknownOidInfo.length;

  // Destaques da grade: primárias, ou as primeiras secundárias promovidas.
  const highlights = primary.length > 0 ? primary : secondary.slice(0, 4);

  // ── Health block: reachability + latency + failure-rate metrics ───────────
  // Extract reachability-related rows to render as a first-class "saúde" block
  // before the primary grid, regardless of variant.
  const HEALTH_METRICS = new Set([
    'reachability',
    'status',
    'packet_loss',
    'ping_loss',
    'net_error_rate',
    'net_discard_rate',
  ]);
  const healthRows = effectiveRows.filter((r) => HEALTH_METRICS.has(r.point.metric));
  const nonHealthPrimary = primary.filter((r) => !HEALTH_METRICS.has(r.point.metric));
  const nonHealthHighlights = highlights.filter((r) => !HEALTH_METRICS.has(r.point.metric));

  return (
    <div className="border-t border-border pt-2 text-xs space-y-1.5">

      {/* ── Health block: reachability, latency, packet loss ─────────────── */}
      {variant !== 'sca' && healthRows.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            {t('Saúde da conexão')}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {healthRows.map((r) => {
              const rowLabel = resolveLabel(r);
              return (
                <div key={r.point.id} className="group relative flex items-center gap-1.5 min-w-0">
                  <span className="text-muted-foreground shrink-0">{rowLabel}:</span>
                  <MetricValue row={r} t={t} />
                  {showRemove(r.point) && (
                    <button
                      type="button"
                      onClick={() => setPendingRemove({ id: r.point.id, name: rowLabel })}
                      className="hidden shrink-0 rounded p-0.5 text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 group-hover:block dark:hover:bg-red-500/10"
                      title={t('Remover ponto de monitoramento')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Destaques em tiles (variante SCA) */}
      {(variant === 'tiles' || variant === 'sca') &&
        (variant === 'sca' ? scaRows : nonHealthHighlights).length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {(variant === 'sca' ? scaRows : nonHealthHighlights).map((r, i) => {
            const rowLabel = resolveLabel(r);
            return (
              <MetricTile
                key={r.point.id}
                row={r}
                index={i}
                label={rowLabel}
                t={t}
                onRemove={
                  showRemove(r.point)
                    ? () => setPendingRemove({ id: r.point.id, name: rowLabel })
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      {/* CPU aggregate detail: máximo canônico ou núcleos legados colapsados. */}
      {variant !== 'sca' && cpuRow && (cpuRow.max !== null || cpuRow.originals.length > 1) && (
        <div className="space-y-0.5">
          {cpuRow.originals.length > 1 ? (
            <button
              type="button"
              onClick={() => setCpuDetailOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {cpuDetailOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {t('CPU por núcleo')} ({cpuRow.originals.length})
              {cpuRow.max !== null && (
                <span className="ml-1 text-muted-foreground/70">
                  {t('máx:')} {formatSnmpValue(cpuRow.max, cpuRow.synthetic.display, 'cpu')}
                </span>
              )}
            </button>
          ) : cpuRow.max !== null ? (
              <p className="text-[10px] text-muted-foreground">
                {t('Pico de CPU:')}{' '}
                {formatSnmpValue(cpuRow.max, cpuRow.synthetic.display, 'cpu_usage_peak')}
              </p>
          ) : null}
          {cpuRow.originals.length > 1 && cpuDetailOpen && (
            <div className="pl-3 space-y-0.5">
              {cpuRow.originals.map((r, i) => (
                <div key={r.point.id} className="flex items-center gap-2">
                  <span className="text-muted-foreground shrink-0">
                    {t('Núcleo')} {i + 1}
                  </span>
                  <MetricValue row={r} t={t} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Destaques (importância primária) — health metrics already shown above */}
      {variant === 'compact' && nonHealthPrimary.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
          {nonHealthPrimary.map((r) => {
            const rowLabel = resolveLabel(r);
            return (
              <div key={r.point.id} className="group relative min-w-0">
                <p
                  className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/70"
                  title={rowLabel}
                >
                  {rowLabel}
                </p>
                <MetricValue row={r} t={t} />
                {showRemove(r.point) && (
                  <button
                    type="button"
                    onClick={() => setPendingRemove({ id: r.point.id, name: rowLabel })}
                    className="absolute -right-0.5 -top-0.5 hidden rounded p-0.5 text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 group-hover:block dark:hover:bg-red-500/10"
                    title={t('Remover ponto de monitoramento')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {variant === 'compact' && nonHealthPrimary.length === 0 && secondary.length > 0 && (
        // Sem destaques: promove as primeiras secundárias para a grade.
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
          {secondary.filter((r) => !HEALTH_METRICS.has(r.point.metric)).slice(0, 4).map((r) => {
            const rowLabel = resolveLabel(r);
            return (
              <div key={r.point.id} className="group relative min-w-0">
                <p
                  className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/70"
                  title={rowLabel}
                >
                  {rowLabel}
                </p>
                <MetricValue row={r} t={t} />
                {showRemove(r.point) && (
                  <button
                    type="button"
                    onClick={() => setPendingRemove({ id: r.point.id, name: rowLabel })}
                    className="absolute -right-0.5 -top-0.5 hidden rounded p-0.5 text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 group-hover:block dark:hover:bg-red-500/10"
                    title={t('Remover ponto de monitoramento')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Equipamento não expõe: resumo, nunca células vazias */}
      {notExposed.length > 0 && (
        <p
          className="text-[10px] text-muted-foreground/70"
          title={t('OIDs testados no último diagnóstico SNMP e inexistentes neste equipamento.')}
        >
          {t('Não expõe:')}{' '}
          {notExposed.map((r) => resolveLabel(r)).join(', ')}
        </p>
      )}

      {/* Ver mais: secundárias por categoria + informações estáticas.
          Alguns cards têm um caminho próprio para o diagnóstico completo. */}
      {showDetails && moreCount > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {moreOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {moreOpen ? t('Ver menos') : t('Ver mais')} ({moreCount})
          </button>
          {moreOpen && (
            <div className="mt-1.5 space-y-2">
              {moreGroups.map((g) => (
                <div key={g.category} className="space-y-0.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                    {t(g.label)}
                  </p>
                  {g.rows.map((r) => {
                    const rowLabel = resolveLabel(r);
                    return (
                      <div key={r.point.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={rowLabel}>
                          {rowLabel}
                        </span>
                        <MetricValue row={r} t={t} />
                        {showRemove(r.point) && (
                          <button
                            type="button"
                            onClick={() => setPendingRemove({ id: r.point.id, name: rowLabel })}
                            className="shrink-0 rounded p-0.5 text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                            title={t('Remover ponto de monitoramento')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {g.info.map((e) => (
                    <div key={e.oid} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-muted-foreground" title={e.label}>
                        {e.label}
                      </span>
                      <span
                        className="max-w-[55%] truncate text-right font-medium text-foreground"
                        title={`${e.value} — ${t('lido no último diagnóstico')}`}
                      >
                        {e.value}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              {/* OIDs sem nome conhecido: subgrupo recolhido ao final
                  Exibidos como "OID desconhecido" em vez do OID bruto */}
              {unknownOidInfo.length > 0 && (
                <UnknownOidGroup entries={unknownOidInfo} t={t} />
              )}
            </div>
          )}
        </div>
      )}
      {/* Diálogo de confirmação de remoção de ponto */}
      {pendingRemove && (
        <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-500/30 dark:bg-amber-500/10 space-y-2">
          <p className="font-medium text-amber-800 dark:text-amber-300">
            {t('Remover')} &ldquo;{pendingRemove.name}&rdquo;?
          </p>
          <p className="text-amber-700 dark:text-amber-400">
            {t('Alarmes e histórico (trends) deste ponto serão apagados permanentemente. Esta ação não pode ser desfeita.')}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onRemovePoint?.(pendingRemove.id, pendingRemove.name);
                setPendingRemove(null);
              }}
              className="rounded-md bg-red-500 px-2.5 py-1 font-medium text-white hover:bg-red-600"
            >
              {t('Remover')}
            </button>
            <button
              type="button"
              onClick={() => setPendingRemove(null)}
              className="rounded-md border border-border px-2.5 py-1 font-medium text-muted-foreground hover:bg-muted"
            >
              {t('Cancelar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Subgrupo recolhido para OIDs sem nome conhecido ─────────────────────────

function UnknownOidGroup({
  entries,
  t,
}: {
  entries: SnmpInfoEntry[];
  t: (s: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50 hover:text-muted-foreground"
      >
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        {t('OIDs personalizados')} ({entries.length})
      </button>
      {open && (
        <div className="space-y-0.5 pl-1">
          {entries.map((e) => (
            <div key={e.oid} className="flex items-baseline justify-between gap-2">
              <span
                className="min-w-0 truncate text-[10px] text-muted-foreground/70"
                title={e.oid}
              >
                {/* Label: friendly "OID desconhecido" instead of bare OID */}
                {t('OID desconhecido')}
              </span>
              <span
                className="max-w-[45%] truncate text-right font-medium text-foreground"
                title={`${e.oid} = ${e.value} — ${t('lido no último diagnóstico')}`}
              >
                {e.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rótulos pt-BR (fallback local quando a categoria só aparece em snmpInfo). */
const CATEGORY_LABEL_FALLBACK: Record<string, string> = {
  identification: 'Identificação',
  performance: 'Desempenho',
  hardware: 'Hardware',
  system: 'Sistema',
  network: 'Rede',
  storage: 'Armazenamento',
  security: 'Segurança',
  application: 'Aplicação',
  other: 'Outras métricas',
};
