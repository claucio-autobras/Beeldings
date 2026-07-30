import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

/**
 * Cliente do backend de Alarmes (modelo por-ponto, EBO). Regras (config) em
 * /alarm-rules e ocorrências em /alarm-events. Substitui o contrato mock binário.
 */

export type AlarmType = 'STATE_CHANGE' | 'VALUE_RANGE';
export type AlarmSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type AlarmCondition = 'GT' | 'LT' | 'GTE' | 'LTE' | 'BETWEEN' | 'OUTSIDE';
export type AlarmEventState = 'ACTIVE' | 'ACTIVE_ACK' | 'NORMALIZED_UNACK' | 'NORMALIZED_ACK';

export interface AlarmPointRef {
  id: string;
  tag: string;
  objectName: string;
  objectType: string;
  instance: number;
  unit: string | null;
  deviceId: string;
}

export interface AlarmRuleItem {
  id: string;
  tenantId: string;
  pointId: string;
  name: string;
  message: string;
  type: AlarmType;
  severity: AlarmSeverity;
  enabled: boolean;
  activationState: boolean | null;
  condition: AlarmCondition | null;
  limitValue: number | null;
  limitLow: number | null;
  limitHigh: number | null;
  hysteresis: number;
  delaySeconds: number;
  point?: AlarmPointRef;
  _count?: { events: number };
}

export interface AlarmEventItem {
  id: string;
  alarmRuleId: string;
  tenantId: string;
  tenantName: string;
  siteName: string | null;
  pointId: string;
  deviceId: string;
  deviceName: string;
  tag: string;
  objectName: string;
  unit: string | null;
  name: string;
  message: string;
  severity: AlarmSeverity;
  state: AlarmEventState;
  valueAtTrigger: number | null;
  activatedAt: string;
  normalizedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  /** Nome resolvido de quem reconheceu; null se o usuário foi excluído. */
  acknowledgedByName: string | null;
  ackNote: string | null;
  reactivationCount: number;
  lastReactivatedAt: string | null;
}

export interface AlarmStats {
  total: number;
  active: number;
  pendingAck: number;
  acknowledged: number;
}

// ─── Regras (config) ────────────────────────────────────────────────────────

export interface CreateAlarmRuleInput {
  pointId: string;
  name: string;
  message: string;
  type: AlarmType;
  severity: AlarmSeverity;
  enabled?: boolean;
  activationState?: boolean | null;
  condition?: AlarmCondition | null;
  limitValue?: number | null;
  limitLow?: number | null;
  limitHigh?: number | null;
  hysteresis?: number | null;
  delaySeconds?: number | null;
}

export interface UpdateAlarmRuleInput {
  name?: string;
  message?: string;
  severity?: AlarmSeverity;
  enabled?: boolean;
  activationState?: boolean | null;
  condition?: AlarmCondition | null;
  limitValue?: number | null;
  limitLow?: number | null;
  limitHigh?: number | null;
  hysteresis?: number | null;
  delaySeconds?: number | null;
}

export interface AlarmRuleFilters {
  deviceId?: string;
  pointId?: string;
  siteId?: string;
  tenantId?: string;
}

export async function getAlarmRules(filters: AlarmRuleFilters = {}): Promise<AlarmRuleItem[]> {
  const params = new URLSearchParams();
  if (filters.deviceId) params.set('deviceId', filters.deviceId);
  if (filters.pointId) params.set('pointId', filters.pointId);
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.tenantId) params.set('tenantId', filters.tenantId);
  const qs = params.toString();
  return apiGet<AlarmRuleItem[]>(`/alarm-rules${qs ? `?${qs}` : ''}`);
}

export async function createAlarmRule(input: CreateAlarmRuleInput): Promise<AlarmRuleItem> {
  return apiPost<AlarmRuleItem>('/alarm-rules', input);
}

export async function updateAlarmRule(id: string, input: UpdateAlarmRuleInput): Promise<AlarmRuleItem> {
  return apiPatch<AlarmRuleItem>(`/alarm-rules/${id}`, input);
}

export async function deleteAlarmRule(id: string): Promise<void> {
  await apiDelete(`/alarm-rules/${id}`);
}

// ─── Ocorrências (eventos) ──────────────────────────────────────────────────

export interface AlarmEventFilters {
  tenantId?: string;
  siteId?: string;
  deviceId?: string;
  pointId?: string;
  severity?: AlarmSeverity;
  state?: AlarmEventState;
  open?: boolean;
  from?: Date;
  to?: Date;
}

export async function getAlarmEvents(filters: AlarmEventFilters = {}): Promise<AlarmEventItem[]> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set('tenantId', filters.tenantId);
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.deviceId) params.set('deviceId', filters.deviceId);
  if (filters.pointId) params.set('pointId', filters.pointId);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.state) params.set('state', filters.state);
  if (filters.open) params.set('open', 'true');
  if (filters.from) params.set('from', filters.from.toISOString());
  if (filters.to) params.set('to', filters.to.toISOString());
  const qs = params.toString();
  return apiGet<AlarmEventItem[]>(`/alarm-events${qs ? `?${qs}` : ''}`);
}

export async function getAlarmStats(tenantId?: string, siteId?: string): Promise<AlarmStats> {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (siteId) params.set('siteId', siteId);
  const qs = params.toString();
  return apiGet<AlarmStats>(`/alarm-events/stats${qs ? `?${qs}` : ''}`);
}

export async function acknowledgeAlarmEvent(eventId: string, userId?: string, note?: string): Promise<AlarmEventItem> {
  return apiPost<AlarmEventItem>(`/alarm-events/${eventId}/acknowledge`, { userId, note });
}

export async function acknowledgeAlarmEvents(ids: string[], note?: string): Promise<{ acknowledged: number }> {
  return apiPost<{ acknowledged: number }>(`/alarm-events/acknowledge`, { ids, note });
}
