import type { Alarm } from '@/modules/alarms/types/alarm.types';
import type { Device } from '@/modules/devices/types/device.types';
import type { AdminStats, ClientStats, PendingCommand, SystemStatus } from '../types/dashboard.types';

import { apiGet, apiPost } from '@/lib/api-client';

export type { AdminStats, ClientStats, PendingCommand, SystemStatus };

export interface DashboardSummary {
  devices: Device[];
  alarms: Alarm[];
}

// ─── Devices ──────────────────────────────────────────────────────────────────

export async function getDevices(tenantId?: string): Promise<Device[]> {
  const path = tenantId ? `/devices?tenantId=${encodeURIComponent(tenantId)}` : '/devices';
  return apiGet<Device[]>(path);
}

// ─── Alarms ───────────────────────────────────────────────────────────────────

export async function getAlarms(tenantId?: string): Promise<Alarm[]> {
  const path = tenantId ? `/alarms?status=open&tenantId=${encodeURIComponent(tenantId)}` : '/alarms?status=open';
  return apiGet<Alarm[]>(path);
}

// Alarmes que aguardam reconhecimento: apenas normalizados-sem-ACK (NORMAL) —
// alarmes ativos NÃO são reconhecíveis. Alimenta a lista "a reconhecer" do card
// "Prioridade dos alarmes"; a severidade do card usa o feed de ativos (status=open).
// Tenant-scoped; o escopo por site é aplicado no cliente (o `/alarms` legado não
// filtra por site).
export async function getPendingAckAlarms(tenantId?: string): Promise<Alarm[]> {
  const path = tenantId
    ? `/alarms?status=pending-ack&tenantId=${encodeURIComponent(tenantId)}`
    : '/alarms?status=pending-ack';
  return apiGet<Alarm[]>(path);
}

// Contagens autoritativas dos alarmes (mesma fonte da tela de Alarmes:
// `/alarm-events/stats`). Aceita escopo por tenant/site. `byStatus` é a
// distribuição mutuamente exclusiva por estado para o gráfico "Alarmes por
// Status"; `pendingAck` (apenas NORMALIZED_UNACK) alimenta o card "Aguard. ACK".
export interface AlarmDashboardStats {
  total: number;
  active: number;
  pendingAck: number;
  acknowledged: number;
  byStatus: { alarme: number; normal: number; reconhecido: number };
}

export async function getAlarmStatusCounts(
  tenantId?: string,
  siteId?: string,
): Promise<AlarmDashboardStats> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (siteId) params.set('siteId', siteId);
  const qs = params.toString();
  return apiGet<AlarmDashboardStats>(`/alarm-events/stats${qs ? `?${qs}` : ''}`);
}

// ─── Admin Stats ──────────────────────────────────────────────────────────────

export async function getAdminStats(): Promise<AdminStats> {
  return apiGet<AdminStats>('/dashboard/admin-stats');
}

// ─── Recent Commands ──────────────────────────────────────────────────────────

// Comandos recentes (todos os estados) para o card "Automações e comandos".
// Retorna a lista completa para que a UI derive tanto os "últimos comandos"
// quanto a contagem de falhas (status='failed') da MESMA fonte — evita o
// contrassenso de contar falhas a partir de uma lista filtrada por 'pending'.
// Escopado por tenant/site quando informado (visão Cliente/Site); sem escopo
// na visão Admin global.
export async function getRecentCommands(
  tenantId?: string,
  siteId?: string,
): Promise<PendingCommand[]> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (siteId) params.set('siteId', siteId);
  const qs = params.toString();
  return apiGet<PendingCommand[]>(`/commands${qs ? `?${qs}` : ''}`);
}

// ─── System Statuses ──────────────────────────────────────────────────────────

export async function getSystemStatuses(tenantId?: string): Promise<SystemStatus[]> {
  const path = tenantId ? `/systems/status?tenantId=${encodeURIComponent(tenantId)}` : '/systems/status';
  return apiGet<SystemStatus[]>(path);
}

// ─── Client Stats ─────────────────────────────────────────────────────────────

export async function getClientStats(tenantId?: string): Promise<ClientStats> {
  const path = tenantId ? `/dashboard/client-stats?tenantId=${encodeURIComponent(tenantId)}` : '/dashboard/client-stats';
  return apiGet<ClientStats>(path);
}

// ─── Overview (agregados de período) ──────────────────────────────────────────

export type DashboardPeriod = '24h' | '7d' | '30d';

/** Agregados de uma janela (atual ou anterior) do overview. */
export interface OverviewWindowStats {
  /** Alarmes disparados (ativados) na janela. */
  activated: number;
  /** Alarmes normalizados (resolvidos) na janela. */
  resolved: number;
  /**
   * Mediana ativação→ACK em ms, só de alarmes que ativaram na janela;
   * null quando nenhum alarme da janela foi reconhecido.
   */
  ackMedianMs: number | null;
  /** Quantos reconhecimentos entraram na mediana. */
  ackCount: number;
}

export interface TenantRankingEntry {
  tenantId: string;
  tenantName: string;
  activeAlarms: number;
  offlineDevices: number;
}

export interface RecentAuditEntry {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  entityName: string | null;
  tenantName: string | null;
  result: string;
}

export interface DashboardOverview {
  period: DashboardPeriod;
  from: string;
  to: string;
  current: OverviewWindowStats;
  previous: OverviewWindowStats;
  tenants: { total: number; active: number };
  /** Visão global (Admin) apenas; null nas demais. */
  tenantRanking: TenantRankingEntry[] | null;
  recentAudit: RecentAuditEntry[] | null;
}

export async function getDashboardOverview(
  period: DashboardPeriod,
  tenantId?: string,
  siteId?: string,
): Promise<DashboardOverview> {
  const params = new URLSearchParams({ period });
  if (tenantId) params.set('tenantId', tenantId);
  if (siteId) params.set('siteId', siteId);
  return apiGet<DashboardOverview>(`/dashboard/overview?${params.toString()}`);
}

// ─── Ativos críticos ──────────────────────────────────────────────────────────

/** Ativo crítico: device, câmera ou ponto marcado pelo operador. */
export interface CriticalAsset {
  /** deviceId (kind device/camera) ou pointId (kind point). */
  id: string;
  kind: 'device' | 'camera' | 'point';
  name: string;
  deviceId: string;
  deviceName: string;
  pointId: string | null;
  tenantId: string;
  tenantName: string;
  siteId: string | null;
  siteName: string | null;
  /** 'fault' = alarme ativo; senão online/offline. */
  status: 'online' | 'offline' | 'fault';
  /** Tempo em funcionamento (ms) na janela do período; null = sem dados. */
  runtimeMs: number | null;
  /** Ativo agora (ponto de status ligado com device online); null = sem dados. */
  activeNow: boolean | null;
  /** Início do período ligado contínuo vigente (ISO) e duração; null = sem dados. */
  activeSince: string | null;
  activeMs: number | null;
  faultSince: string | null;
  faultMs: number | null;
  faultSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  faultAlarmEventId: string | null;
  faultRuleName: string | null;
  offlineSince: string | null;
  offlineMs: number | null;
  lastSeen: string | null;
  /** Tela SCADA ativa do tenant que referencia o equipamento, se houver. */
  scadaScreenId: string | null;
}

export interface CriticalAssetsData {
  from: string;
  to: string;
  generatedAt: string;
  assets: CriticalAsset[];
}

export async function getCriticalAssets(
  period: DashboardPeriod,
  tenantId?: string,
  siteId?: string,
): Promise<CriticalAssetsData> {
  const params = new URLSearchParams({ period });
  if (tenantId) params.set('tenantId', tenantId);
  if (siteId) params.set('siteId', siteId);
  return apiGet<CriticalAssetsData>(`/dashboard/critical-assets?${params.toString()}`);
}

// ─── Primeira ação sugerida por IA (ativo crítico em falha) ──────────────────

export interface FirstActionStep {
  text: string;
  /** Título do documento da base de conhecimento que fundamenta o passo. */
  source: string | null;
}

export interface FirstActionSuggestion {
  steps: FirstActionStep[];
  confidence: 'high' | 'medium' | 'low';
  note: string | null;
  basedOnKnowledge: boolean;
}

export interface FirstActionContext {
  deviceId: string;
  deviceName: string;
  pointName: string | null;
  alarm: {
    name: string;
    message: string;
    severity: string;
    state: string;
    activatedAt: string;
  } | null;
  /** Ocorrências da mesma regra nos últimos 30 dias (reincidência). */
  recurrence30d: number | null;
  /** Motivos de reconhecimentos anteriores da mesma regra (90 dias, mais recentes primeiro). */
  ackHistory: Array<{ acknowledgedAt: string; note: string }>;
}

export interface FirstActionResult {
  context: FirstActionContext;
  /** null quando a IA falhou — o painel mostra só o contexto factual. */
  suggestion: FirstActionSuggestion | null;
  aiError: boolean;
  sources: Array<{ docId: string; title: string; type: string; source: string | null }>;
}

export async function getFirstActionSuggestion(payload: {
  deviceId: string;
  pointId?: string;
  alarmEventId?: string;
  locale: 'pt' | 'en';
}): Promise<FirstActionResult> {
  return apiPost<FirstActionResult>('/ai/first-action', payload);
}

// ─── Post command ─────────────────────────────────────────────────────────────

export async function postCommand(payload: { deviceId: string; command: string }): Promise<PendingCommand> {
  return apiPost<PendingCommand>('/commands', payload);
}
