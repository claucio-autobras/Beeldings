import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

export interface ProjectGateway {
  id: string;
  status: string;
  mqttUser?: string;
  mqttPass?: string;
  lastSeen?: string | null;
}

export interface ProjectItem {
  id: string;
  name: string;
  address?: string | null;
  technicalContact?: string | null;
  siteId: string;
  tenantId: string;
  createdAt: string;
  gateway?: ProjectGateway | null;
}

export interface CreateProjectDto {
  name: string;
  address?: string;
  technicalContact?: string;
  siteId: string;
  tenantId: string;
  /** Quando informado, vincula a um gateway existente em vez de criar um novo. */
  gatewayId?: string;
}

/** Projeto recém-criado já vem com o gateway provisionado. */
export type ProjectWithGateway = ProjectItem & { gateway: ProjectGateway };

export async function getProjects(siteId?: string, tenantId?: string): Promise<ProjectItem[]> {
  const params = new URLSearchParams();
  if (siteId) params.set('siteId', siteId);
  if (tenantId) params.set('tenantId', tenantId);
  const qs = params.toString();
  return apiGet<ProjectItem[]>(`/projects${qs ? `?${qs}` : ''}`);
}

export async function getProject(id: string): Promise<ProjectItem> {
  return apiGet<ProjectItem>(`/projects/${id}`);
}

export interface UpdateProjectDto {
  name?: string;
  address?: string | null;
  technicalContact?: string | null;
}

export async function updateProject(id: string, data: UpdateProjectDto): Promise<ProjectItem> {
  return apiPatch<ProjectItem>(`/projects/${id}`, data);
}

export async function createProject(data: CreateProjectDto): Promise<ProjectWithGateway> {
  return apiPost<ProjectWithGateway>('/projects', data);
}

export async function deleteProject(id: string): Promise<void> {
  return apiDelete(`/projects/${id}`);
}

/** Baixa o conteúdo do gateway-config.env do projeto. */
export async function getGatewayConfigText(projectId: string): Promise<string> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  // Autenticação via cookie de sessão HttpOnly (enviado pelo browser).
  const res = await fetch(`${API_URL}/projects/${projectId}/gateway-config`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Baixa o Guia de Integração MQTT (PDF) do gateway do projeto. */
export async function getMqttIntegrationGuidePdf(projectId: string): Promise<Blob> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  // Autenticação via cookie de sessão HttpOnly (enviado pelo browser).
  const res = await fetch(`${API_URL}/projects/${projectId}/mqtt-integration-guide`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}
