import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

/**
 * Cliente do backend de Trends (modelo por-ponto, EBO). Substitui o contrato mock
 * antigo. Usado pela tela da controladora (criar) e pela tela de Trends (consumir).
 */

export type TrendMode = 'ON_CHANGE' | 'INTERVAL';

export interface TrendPointRef {
  id: string;
  tag: string;
  objectName: string;
  objectType: string;
  instance: number;
  unit: string | null;
  deviceId: string;
}

export interface TrendItem {
  id: string;
  tenantId: string;
  pointId: string;
  name: string;
  mode: TrendMode;
  intervalSeconds: number | null;
  /** ON_CHANGE: deadband analógico (null/0 = qualquer mudança). */
  covThreshold: number | null;
  /** ON_CHANGE: heartbeat em segundos (null = desligado). */
  maxIntervalSeconds: number | null;
  retentionDays: number;
  enabled: boolean;
  point?: TrendPointRef;
  _count?: { records: number };
}

export interface TrendChartPoint {
  t: string;
  value: number;
  min: number;
  max: number;
}

export interface TrendDataResponse {
  trend: TrendItem;
  summary: {
    totalRecords: number;
    minValue: number | null;
    maxValue: number | null;
    avgValue: number | null;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };
  chartPoints: TrendChartPoint[];
  page: {
    records: { id: string; timestamp: string; value: number; quality: string }[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface CreateTrendInput {
  pointId: string;
  name: string;
  mode: TrendMode;
  intervalSeconds?: number;
  covThreshold?: number | null;
  maxIntervalSeconds?: number | null;
  retentionDays: number;
}

export interface UpdateTrendInput {
  name?: string;
  mode?: TrendMode;
  intervalSeconds?: number | null;
  covThreshold?: number | null;
  maxIntervalSeconds?: number | null;
  retentionDays?: number;
  enabled?: boolean;
}

export interface TrendListFilters {
  deviceId?: string;
  pointId?: string;
  tenantId?: string;
}

export async function getTrends(filters: TrendListFilters = {}): Promise<TrendItem[]> {
  const params = new URLSearchParams();
  if (filters.deviceId) params.set('deviceId', filters.deviceId);
  if (filters.pointId) params.set('pointId', filters.pointId);
  if (filters.tenantId) params.set('tenantId', filters.tenantId);
  const qs = params.toString();
  return apiGet<TrendItem[]>(`/trends${qs ? `?${qs}` : ''}`);
}

export async function createTrend(input: CreateTrendInput): Promise<TrendItem> {
  return apiPost<TrendItem>('/trends', input);
}

export async function updateTrend(id: string, input: UpdateTrendInput): Promise<TrendItem> {
  return apiPatch<TrendItem>(`/trends/${id}`, input);
}

export async function deleteTrend(id: string): Promise<void> {
  await apiDelete(`/trends/${id}`);
}

export interface TrendSummary {
  totalRecords: number;
  minValue: number | null;
  maxValue: number | null;
  avgValue: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
}

/** Uma série (gráfico + resumo) de uma trend, no contrato batch. */
export interface TrendSeries {
  trend: TrendItem;
  summary: TrendSummary;
  chartPoints: TrendChartPoint[];
}

export interface TrendBatchResponse {
  from: string;
  to: string;
  bucket: 'minute' | 'hour' | 'day';
  trends: TrendSeries[];
}

/** Linha do histórico mesclado (várias trends). */
export interface TrendHistoryRow {
  id: string;
  timestamp: string;
  trendId: string;
  trendName: string;
  value: number;
  quality: string;
  unit: string | null;
  objectType: string | null;
}

export interface TrendHistoryResponse {
  records: TrendHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TrendDataQuery {
  from?: Date;
  to?: Date;
  bucket?: 'minute' | 'hour' | 'day';
  page?: number;
  pageSize?: number;
}

export interface TrendBatchQuery {
  from?: Date;
  to?: Date;
  bucket?: 'minute' | 'hour' | 'day';
}

export interface TrendHistoryQuery {
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function getTrendData(id: string, q: TrendDataQuery = {}): Promise<TrendDataResponse> {
  const params = new URLSearchParams();
  if (q.from) params.set('from', q.from.toISOString());
  if (q.to) params.set('to', q.to.toISOString());
  if (q.bucket) params.set('bucket', q.bucket);
  params.set('page', String(q.page ?? 1));
  params.set('pageSize', String(q.pageSize ?? 50));
  return apiGet<TrendDataResponse>(`/trends/${id}/data?${params.toString()}`);
}

/** Séries (gráfico + resumo) de várias trends numa única janela. */
export async function getTrendDataBatch(ids: string[], q: TrendBatchQuery = {}): Promise<TrendBatchResponse> {
  return apiPost<TrendBatchResponse>('/trends/data/batch', {
    ids,
    from: q.from?.toISOString(),
    to: q.to?.toISOString(),
    bucket: q.bucket,
  });
}

/** Histórico mesclado (todas as trends), ordenado por timestamp desc e paginado. */
export async function getTrendHistory(ids: string[], q: TrendHistoryQuery = {}): Promise<TrendHistoryResponse> {
  const params = new URLSearchParams();
  params.set('ids', ids.join(','));
  if (q.from) params.set('from', q.from.toISOString());
  if (q.to) params.set('to', q.to.toISOString());
  params.set('page', String(q.page ?? 1));
  params.set('pageSize', String(q.pageSize ?? 50));
  return apiGet<TrendHistoryResponse>(`/trends/history?${params.toString()}`);
}

/** Baixa o CSV de uma Trend (autenticado pelo cookie de sessão HttpOnly). */
export async function exportTrendCsv(id: string, from?: Date, to?: Date): Promise<string> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const params = new URLSearchParams();
  if (from) params.set('from', from.toISOString());
  if (to) params.set('to', to.toISOString());
  const res = await fetch(`${API_URL}/trends/${id}/export.csv?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Baixa o CSV mesclado de várias Trends. */
export async function exportTrendsCsv(ids: string[], from?: Date, to?: Date): Promise<string> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const params = new URLSearchParams();
  params.set('ids', ids.join(','));
  if (from) params.set('from', from.toISOString());
  if (to) params.set('to', to.toISOString());
  const res = await fetch(`${API_URL}/trends/export.csv?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
