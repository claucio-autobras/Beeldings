import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '@/lib/api-client';
import type {
  Automation,
  AutomationRunsPage,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '../types/automation.types';

/** Cliente do backend de Automações (motor de comando QUANDO/SE/ENTÃO). */

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v);
  if (entries.length === 0) return '';
  return `?${entries.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&')}`;
}

export async function getAutomations(tenantId?: string, siteId?: string): Promise<Automation[]> {
  return apiGet<Automation[]>(`/automation${query({ tenantId, siteId })}`);
}

export async function getAutomationRuns(params: {
  tenantId?: string;
  siteId?: string;
  automationId?: string;
  result?: string;
  page?: number;
  pageSize?: number;
}): Promise<AutomationRunsPage> {
  return apiGet<AutomationRunsPage>(
    `/automation/runs${query({
      tenantId: params.tenantId,
      siteId: params.siteId,
      automationId: params.automationId,
      result: params.result,
      page: params.page ? String(params.page) : undefined,
      pageSize: params.pageSize ? String(params.pageSize) : undefined,
    })}`,
  );
}

export async function getAutomation(id: string, tenantId?: string): Promise<Automation> {
  return apiGet<Automation>(`/automation/${id}${query({ tenantId })}`);
}

export async function createAutomation(input: CreateAutomationInput): Promise<Automation> {
  return apiPost<Automation>('/automation', input);
}

export async function updateAutomation(id: string, input: UpdateAutomationInput): Promise<Automation> {
  return apiPut<Automation>(`/automation/${id}`, input);
}

export async function setAutomationEnabled(
  id: string,
  enabled: boolean,
  tenantId?: string,
): Promise<Automation> {
  return apiPatch<Automation>(`/automation/${id}/enabled`, { enabled, tenantId });
}

export async function deleteAutomation(id: string, tenantId?: string): Promise<void> {
  return apiDelete(`/automation/${id}${query({ tenantId })}`);
}
