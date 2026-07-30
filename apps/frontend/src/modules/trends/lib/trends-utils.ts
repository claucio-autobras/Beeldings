import type { TrendItem } from '../services/trends-api.service';

/** Tipos de objeto BACnet/Modbus tratados como digitais (estado ON/OFF). */
const DIGITAL_TYPES = new Set(['BI', 'BO', 'BV', 'MSI', 'MSO', 'MSV', '3', '4', '5', '13', '14', '19']);

export type SeriesType = 'analog' | 'digital';

export function isDigitalPoint(objectType?: string | null): boolean {
  return objectType ? DIGITAL_TYPES.has(objectType) : false;
}

export function trendType(trend: Pick<TrendItem, 'point'>): SeriesType {
  return isDigitalPoint(trend.point?.objectType) ? 'digital' : 'analog';
}

/**
 * Paleta fixa para séries — cores distinguíveis em light mode, alinhadas ao
 * design system (cyan primário primeiro). Atribuída por índice estável.
 */
export const SERIES_PALETTE = [
  '#0e7490', // cyan-700 (primária)
  '#d97706', // amber-600
  '#059669', // emerald-600
  '#7c3aed', // violet-600
  '#e11d48', // rose-600
  '#0284c7', // sky-600
  '#ca8a04', // yellow-600
  '#9333ea', // purple-600
  '#dc2626', // red-600
  '#0891b2', // cyan-600
  '#16a34a', // green-600
  '#db2777', // pink-600
] as const;

export function colorForIndex(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

/** Mapa estável id da trend → cor, na ordem em que aparecem na lista. */
export function buildColorMap(ids: string[]): Map<string, string> {
  return new Map(ids.map((id, i) => [id, colorForIndex(i)]));
}

/** Formata um valor para exibição conforme o tipo da variável. */
export function formatValue(value: number, type: SeriesType, unit?: string | null): string {
  if (type === 'digital') return value >= 0.5 ? 'LIGADO' : 'DESLIGADO';
  const rounded = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

/** Rótulos dos períodos rápidos (1h…30d) → duração em milissegundos. */
export const QUICK_RANGES: { label: string; ms: number }[] = [
  { label: '1h', ms: 3_600_000 },
  { label: '6h', ms: 6 * 3_600_000 },
  { label: '12h', ms: 12 * 3_600_000 },
  { label: '24h', ms: 24 * 3_600_000 },
  { label: '7d', ms: 7 * 24 * 3_600_000 },
  { label: '30d', ms: 30 * 24 * 3_600_000 },
];

/** Converte um Date para o formato aceito por <input type="datetime-local"> (hora local). */
export function toLocalInput(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
