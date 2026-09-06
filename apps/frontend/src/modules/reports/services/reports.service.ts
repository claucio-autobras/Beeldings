// Serviço do módulo de Relatórios. A geração (CSV/PDF) é feita no backend; aqui
// apenas montamos a query, enviamos o token salvo e disparamos o download do
// arquivo retornado (mesmo padrão do export de Trends).

import { apiGet } from '@/lib/api-client';

export type ReportFormat = 'PDF' | 'CSV';
export type AlarmReportStatus = 'all' | 'active' | 'ack' | 'closed';

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

/** Baixa um relatório do backend, respeitando o filename do Content-Disposition. */
async function downloadReport(path: string): Promise<void> {
  // Autenticação via cookie de sessão HttpOnly (enviado pelo browser).
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    let message = `Falha ao gerar relatório (HTTP ${res.status})`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'relatorio';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface AlarmReportParams {
  format: ReportFormat;
  status: AlarmReportStatus;
  from?: Date;
  to?: Date;
  tenantId?: string;
  siteId?: string;
}

export async function downloadAlarmsReport(p: AlarmReportParams): Promise<void> {
  const params = new URLSearchParams();
  params.set('format', p.format);
  params.set('status', p.status);
  if (p.from) params.set('from', p.from.toISOString());
  if (p.to) params.set('to', p.to.toISOString());
  if (p.tenantId) params.set('tenantId', p.tenantId);
  if (p.siteId) params.set('siteId', p.siteId);
  await downloadReport(`/reports/alarms?${params.toString()}`);
}

export interface TrendReportParams {
  format: ReportFormat;
  ids: string[];
  from?: Date;
  to?: Date;
  tenantId?: string;
  siteId?: string;
}

export async function downloadTrendsReport(p: TrendReportParams): Promise<void> {
  const params = new URLSearchParams();
  params.set('format', p.format);
  params.set('ids', p.ids.join(','));
  if (p.from) params.set('from', p.from.toISOString());
  if (p.to) params.set('to', p.to.toISOString());
  if (p.tenantId) params.set('tenantId', p.tenantId);
  if (p.siteId) params.set('siteId', p.siteId);
  await downloadReport(`/reports/trends?${params.toString()}`);
}

export interface AuditReportParams {
  format: ReportFormat;
  from?: Date;
  to?: Date;
  tenantId?: string;
}

export async function downloadAuditReport(p: AuditReportParams): Promise<void> {
  const params = new URLSearchParams();
  params.set('format', p.format);
  if (p.from) params.set('from', p.from.toISOString());
  if (p.to) params.set('to', p.to.toISOString());
  if (p.tenantId) params.set('tenantId', p.tenantId);
  await downloadReport(`/reports/audit?${params.toString()}`);
}

// ─── Disponibilidade ──────────────────────────────────────────────────────────

export interface AvailabilityReportParams {
  format: ReportFormat;
  from?: Date;
  to?: Date;
  tenantId?: string;
  siteId?: string;
}

export async function downloadAvailabilityReport(p: AvailabilityReportParams): Promise<void> {
  const params = new URLSearchParams();
  params.set('format', p.format);
  if (p.from) params.set('from', p.from.toISOString());
  if (p.to) params.set('to', p.to.toISOString());
  if (p.tenantId) params.set('tenantId', p.tenantId);
  if (p.siteId) params.set('siteId', p.siteId);
  await downloadReport(`/reports/availability?${params.toString()}`);
}

export interface AvailabilityRow {
  id: string;
  name: string;
  kind: 'gateway' | 'device' | 'camera';
  siteName: string;
  tenantName: string;
  uptimePct: number | null;
  drops: number;
  offlineMs: number;
  longestOfflineMs: number;
  coverageMs: number;
  coverageFrom: string | null;
  noData: boolean;
}

export interface AvailabilityData {
  from: string | null;
  to: string;
  summary: {
    entityCount: number;
    withDataCount: number;
    avgUptimePct: number | null;
    totalDrops: number;
    totalOfflineMs: number;
    worst: { id: string; name: string; uptimePct: number }[];
  };
  rows: AvailabilityRow[];
}

export interface AvailabilityPreviewParams {
  from?: Date;
  to?: Date;
  tenantId?: string;
  siteId?: string;
}

/** Prévia da disponibilidade (mesma fonte do PDF/CSV do backend). */
export async function getAvailabilityPreview(p: AvailabilityPreviewParams): Promise<AvailabilityData> {
  const params = new URLSearchParams();
  if (p.from) params.set('from', p.from.toISOString());
  if (p.to) params.set('to', p.to.toISOString());
  if (p.tenantId) params.set('tenantId', p.tenantId);
  if (p.siteId) params.set('siteId', p.siteId);
  const qs = params.toString();
  return apiGet<AvailabilityData>(`/reports/availability/preview${qs ? `?${qs}` : ''}`);
}

// ─── Prévia da Auditoria (JSON, não download) ─────────────────────────────────

export interface AuditPreviewEntry {
  id: string;
  createdAt: string;
  user: string;
  userRole: string;
  /** Ação em rótulo legível (ex.: "Exclusão"). */
  action: string;
  /** Código bruto da ação (LOGIN, DELETE, COMMAND…) para coloração. */
  actionCode: string;
  /** Nome do cliente (tenant) ou '' para ações globais/admin. */
  client: string;
  /** Entidade afetada (rótulo + nome). */
  entity: string;
  /** Resumo legível da alteração (before→after) quando disponível. */
  change: string;
  entityId: string;
  /** Origem (IP) já mascarada para exibição; '' quando ausente. */
  origin: string;
  /** Resultado: 'SUCCESS' | 'FAILURE' | '' (registros antigos). */
  result: string;
}

export interface AuditPreviewData {
  total: number;
  rows: AuditPreviewEntry[];
}

export interface AuditPreviewParams {
  from?: Date;
  to?: Date;
  tenantId?: string;
}

/**
 * Busca a prévia da auditoria (mesmos parâmetros do download). O backend aplica
 * o recorte de cliente conforme o perfil do usuário.
 */
export async function getAuditPreview(p: AuditPreviewParams): Promise<AuditPreviewData> {
  const params = new URLSearchParams();
  if (p.from) params.set('from', p.from.toISOString());
  if (p.to) params.set('to', p.to.toISOString());
  if (p.tenantId) params.set('tenantId', p.tenantId);
  const qs = params.toString();
  return apiGet<AuditPreviewData>(`/reports/audit/preview${qs ? `?${qs}` : ''}`);
}
