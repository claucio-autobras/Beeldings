import type { CameraPoint, SnmpPointDisplay } from '../services/cftv.service';

/** Ordem e semântica da visão operacional de saúde SNMP. */
export const SNMP_HEALTH_ORDER = [
  'memory_total',
  'memory_available',
  'memory_used_percent',
  'cpu_usage',
  'packet_loss',
  'ping_loss',
  'storage_used_percent',
  'temperature',
  'uptime',
] as const;

export type SnmpHealthKey = (typeof SNMP_HEALTH_ORDER)[number];

const ALIASES: Record<string, SnmpHealthKey> = {
  cpu: 'cpu_usage',
  cpu_usage: 'cpu_usage',
  cpu_temperature: 'temperature',
  temperature: 'temperature',
  memory: 'memory_used_percent',
  memory_usage: 'memory_used_percent',
  memory_used_percent: 'memory_used_percent',
  memory_available: 'memory_available',
  memory_total: 'memory_total',
  ram_total: 'memory_total',
  packet_loss: 'packet_loss',
  ping_loss: 'ping_loss',
  storage_used_percent: 'storage_used_percent',
  storage: 'storage_used_percent',
  uptime: 'uptime',
};

export const SNMP_HEALTH_LABELS: Record<SnmpHealthKey, string> = {
  memory_total: 'Memória total',
  memory_available: 'Memória disponível',
  memory_used_percent: 'Memória usada',
  packet_loss: 'Perda de pacotes',
  ping_loss: 'Perda de ping',
  cpu_usage: 'Uso de CPU',
  storage_used_percent: 'Armazenamento usado',
  temperature: 'Temperatura',
  uptime: 'Tempo ligado',
};

/** Unidade canônica de apresentação das métricas operacionais. */
export function healthUnit(metric: string, unit?: string | null): string {
  const key = canonicalHealthKey(metric);
  if (key === 'temperature') return '°C';
  if (key === 'cpu_usage' || key === 'memory_used_percent' || key === 'ping_loss' || key === 'storage_used_percent') return '%';
  if (key === 'packet_loss') return (unit ?? '').trim() || 'pkts';
  if (key === 'uptime') return 's';
  return (unit ?? '').trim();
}

/** Converte uma leitura para a escala exibida pelo contrato de saúde. */
export function normalizeHealthReading(
  metric: string,
  value: unknown,
  unit?: string | null,
  scale = 1,
): number | null {
  const key = canonicalHealthKey(metric);
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw)) return null;
  const normalizedUnit = (unit ?? '').trim().toLowerCase();
  let n = raw * (Number.isFinite(scale) ? scale : 1);

  if (key === 'temperature') {
    if (normalizedUnit.includes('milli')) n /= 1000;
    if (normalizedUnit === 'k' || normalizedUnit === 'kelvin') n -= 273.15;
  }
  return normalizeHealthValue(metric, n, healthUnit(metric, unit));
}

/** Formatação única usada no card, telemetria e diagnóstico. */
export function formatHealthValue(
  metric: string,
  value: number | null | undefined,
  unit?: string | null,
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const key = canonicalHealthKey(metric);
  if (key === 'uptime') {
    const d = Math.floor(value / 86400);
    const h = Math.floor((value % 86400) / 3600);
    const m = Math.floor((value % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  let displayValue = value;
  let u = healthUnit(metric, unit);
  if (key === 'memory_total' || key === 'memory_available') {
    const sourceUnit = (unit ?? '').trim().toLowerCase();
    if (sourceUnit === 'bytes' || sourceUnit === 'b') {
      displayValue = value / (1024 ** 2);
      u = 'MB';
    } else if (sourceUnit === 'kb' || sourceUnit === 'kib') {
      displayValue = value / 1024;
      u = 'MB';
    } else if (sourceUnit === 'gb' || sourceUnit === 'gib') {
      displayValue = value * 1024;
      u = 'MB';
    }
  }
  const digits = key === 'temperature' ? 1 : 0;
  const formatted = displayValue.toFixed(digits);
  return u ? (u === '%' || u.startsWith('°') ? `${formatted}${u}` : `${formatted} ${u}`) : formatted;
}

export function canonicalHealthKey(metric: string | null | undefined): SnmpHealthKey | null {
  return metric ? ALIASES[metric.toLowerCase()] ?? null : null;
}

export function healthRank(metric: string | null | undefined): number {
  const key = canonicalHealthKey(metric);
  const rank = key ? SNMP_HEALTH_ORDER.indexOf(key) : -1;
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

/** Rejeita valores impossíveis antes de qualquer destaque ou formatação. */
export function normalizeHealthValue(
  metric: string,
  value: unknown,
  unit?: string | null,
): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const key = canonicalHealthKey(metric);
  if (!key) return null;
  const normalizedUnit = (unit ?? '').trim().toLowerCase();

  if (key === 'temperature') {
    // Temperatura final deve estar em °C. Não converta memória/contadores em
    // temperatura e não aceite o valor bruto 85827°C de firmwares deslocados.
    const celsius =
      normalizedUnit.includes('milli')
        ? n / 1000
        : normalizedUnit === 'k' || normalizedUnit === 'kelvin'
          ? n - 273.15
          : n;
    return celsius >= -40 && celsius <= 150 ? celsius : null;
  }
  if (key === 'cpu_usage' || key === 'memory_used_percent' || key === 'ping_loss' || key === 'storage_used_percent') {
    // kB/MB/bytes nunca são percentuais, mesmo quando o alias legado é memory.
    if (normalizedUnit && !normalizedUnit.includes('%')) return null;
    return n >= 0 && n <= 100 ? n : null;
  }
  if (key === 'packet_loss') {
    // IF-MIB discards/errors are counters or rates, not ping percentages.
    return n >= 0 ? n : null;
  }
  if (key === 'memory_total') {
    // Unidade explícita de capacidade é aceita; percentual aqui é semântica
    // incorreta e não deve aparecer como "memória total".
    if (normalizedUnit.includes('%')) return null;
    return n >= 0 ? n : null;
  }
  if (key === 'uptime') return n >= 0 ? n : null;
  return null;
}

export function isOperationalHealthPoint(point: CameraPoint): boolean {
  return canonicalHealthKey(point.metric) !== null || point.tag.toUpperCase() === 'STATUS';
}

/** Seleciona a primeira fonte por métrica sem depender da ordem do backend. */
export function selectOperationalPoints(points: CameraPoint[]): CameraPoint[] {
  const selected = new Map<string, CameraPoint>();
  const status = points.find((p) => p.tag.trim().toUpperCase() === 'STATUS' || p.metric === 'status');
  for (const point of [...points]
    .filter(isOperationalHealthPoint)
    .sort((a, b) => healthRank(a.metric) - healthRank(b.metric))) {
    const key = canonicalHealthKey(point.metric);
    if (key && !selected.has(key)) selected.set(key, point);
  }
  return [
    ...(status ? [status] : []),
    ...SNMP_HEALTH_ORDER.map((key) => selected.get(key)).filter(
      (p): p is CameraPoint => Boolean(p),
    ),
  ];
}

export function displayForHealth(
  point: CameraPoint,
  display?: SnmpPointDisplay,
): SnmpPointDisplay {
  const key = canonicalHealthKey(point.metric);
  if (!key || !display) {
    return display ?? {
      category: 'other',
      categoryLabel: 'Saúde',
      label: point.objectName,
      importance: 'primary',
      origin: 'canonical',
      valueKind: 'number',
      unit: point.unit || null,
    };
  }
  return {
    ...display,
    label: SNMP_HEALTH_LABELS[key],
    unit: key === 'temperature'
      ? '°C'
      : key === 'cpu_usage' || key === 'memory_used_percent' || key === 'ping_loss' || key === 'storage_used_percent'
        ? '%'
        : display.unit,
    importance: 'primary',
  };
}