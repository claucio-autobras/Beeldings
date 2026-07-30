import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

/**
 * Cliente do backend de Somas de Alarme (alarm groups). Um grupo agrega várias
 * regras de alarme por-ponto (escolhidas por site) e expõe um agregado ao vivo
 * "ativos/total" + a maior severidade ativa — derivado em tempo de leitura.
 */

export type AlarmSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AlarmGroupMemberDto {
  alarmRuleId: string;
  name: string;
  severity: AlarmSeverity;
  enabled: boolean;
  pointId: string;
  tag: string;
  deviceId: string;
  deviceName: string;
  active: boolean;
}

export interface AlarmGroupAggregate {
  total: number;
  active: number;
  severity: AlarmSeverity | null;
}

export interface AlarmGroup {
  id: string;
  tenantId: string;
  siteId: string;
  siteName: string;
  projectId: string | null;
  name: string;
  enabled: boolean;
  aggregate: AlarmGroupAggregate;
  members: AlarmGroupMemberDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AlarmGroupFilters {
  tenantId?: string;
  siteId?: string;
  projectId?: string;
}

export interface CreateAlarmGroupInput {
  siteId: string;
  name: string;
  memberRuleIds?: string[];
  enabled?: boolean;
}

export interface UpdateAlarmGroupInput {
  name?: string;
  enabled?: boolean;
  memberRuleIds?: string[];
}

export async function listAlarmGroups(filters: AlarmGroupFilters = {}): Promise<AlarmGroup[]> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set('tenantId', filters.tenantId);
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  const qs = params.toString();
  return apiGet<AlarmGroup[]>(`/alarm-groups${qs ? `?${qs}` : ''}`);
}

export async function getAlarmGroup(id: string): Promise<AlarmGroup> {
  return apiGet<AlarmGroup>(`/alarm-groups/${id}`);
}

export async function createAlarmGroup(input: CreateAlarmGroupInput): Promise<AlarmGroup> {
  return apiPost<AlarmGroup>('/alarm-groups', input);
}

export async function updateAlarmGroup(id: string, input: UpdateAlarmGroupInput): Promise<AlarmGroup> {
  return apiPatch<AlarmGroup>(`/alarm-groups/${id}`, input);
}

export async function deleteAlarmGroup(id: string): Promise<void> {
  await apiDelete(`/alarm-groups/${id}`);
}
