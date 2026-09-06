import { apiGet, apiPost, apiPatch, apiDelete, API_URL, authHeaders, sensitiveActionHeaders } from '@/lib/api-client';
import {
  normalizeScadaWidgets,
  type ScadaScreen, type Widget, type ScreenSettings, type ScadaScreenStatus, type SavedComponent,
} from '../types/scada.types';

/**
 * Serviço de telas SCADA — fala com o módulo `scada` do backend (`/scada/screens`).
 * Substitui o antigo `mockScadaScreens`: as telas agora persistem no servidor,
 * escopadas por tenant/site/projeto, para que o cliente veja o que o admin criou.
 */

/** Forma crua devolvida pelo backend (widgets/settings são JSON opaco). */
interface ScadaScreenApi {
  id: string;
  name: string;
  description: string | null;
  tenantId: string;
  siteId: string | null;
  projectId: string | null;
  width: number;
  height: number;
  status: string;
  isHome: boolean;
  widgets: unknown;
  settings: unknown;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_SETTINGS: ScreenSettings = { backgroundColor: '#1a1a2e', gridOpacity: 1 };

function fromApi(s: ScadaScreenApi): ScadaScreen {
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? undefined,
    tenantId: s.tenantId,
    siteId: s.siteId ?? undefined,
    projectId: s.projectId ?? undefined,
    width: s.width,
    height: s.height,
    status: (s.status as ScadaScreenStatus) ?? 'active',
    isHome: Boolean(s.isHome),
    widgets: Array.isArray(s.widgets) ? normalizeScadaWidgets(s.widgets) : [],
    settings: (s.settings && typeof s.settings === 'object'
      ? { ...DEFAULT_SETTINGS, ...(s.settings as Partial<ScreenSettings>) }
      : DEFAULT_SETTINGS),
    updatedAt: s.updatedAt,
  };
}

export interface ScadaScreenFilters {
  tenantId?: string;
  siteId?: string;
  projectId?: string;
}

export interface CreateScreenInput {
  name: string;
  description?: string;
  tenantId: string;
  siteId: string;
  projectId: string;
  width?: number;
  height?: number;
  widgets?: Widget[];
  settings?: ScreenSettings;
}

export interface UpdateScreenInput {
  name?: string;
  description?: string;
  siteId?: string | null;
  projectId?: string | null;
  width?: number;
  height?: number;
  status?: ScadaScreenStatus;
  widgets?: Widget[];
  settings?: ScreenSettings;
}

export async function getScreens(filters: ScadaScreenFilters = {}): Promise<ScadaScreen[]> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set('tenantId', filters.tenantId);
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.projectId) params.set('projectId', filters.projectId);
  const qs = params.toString();
  const data = await apiGet<ScadaScreenApi[]>(`/scada/screens${qs ? `?${qs}` : ''}`);
  return data.map(fromApi);
}

export async function getScreen(id: string, siteId?: string): Promise<ScadaScreen> {
  const params = siteId ? `?siteId=${encodeURIComponent(siteId)}` : '';
  const data = await apiGet<ScadaScreenApi>(`/scada/screens/${id}${params}`);
  return fromApi(data);
}

export async function createScreen(input: CreateScreenInput): Promise<ScadaScreen> {
  const data = await apiPost<ScadaScreenApi>('/scada/screens', input);
  return fromApi(data);
}

export async function updateScreen(id: string, input: UpdateScreenInput): Promise<ScadaScreen> {
  const data = await apiPatch<ScadaScreenApi>(`/scada/screens/${id}`, input);
  return fromApi(data);
}

// ─── Biblioteca global de componentes ("Meus Componentes") ─────────────────
// Escopada por tenant: um componente salvo em qualquer tela fica disponível em
// todas as telas do mesmo cliente.

interface ScadaComponentApi {
  id: string;
  name: string;
  tenantId: string;
  width: number;
  height: number;
  widgets: unknown;
}

function componentFromApi(c: ScadaComponentApi): SavedComponent {
  return {
    id: c.id,
    name: c.name,
    width: c.width,
    height: c.height,
    widgets: Array.isArray(c.widgets) ? normalizeScadaWidgets(c.widgets) : [],
  };
}

/** Lista a biblioteca do tenant (globais informam o tenant da tela aberta). */
export async function getComponents(tenantId?: string): Promise<SavedComponent[]> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const data = await apiGet<ScadaComponentApi[]>(`/scada/components${qs}`);
  return data.map(componentFromApi);
}

export async function createComponent(
  input: SavedComponent & { tenantId: string },
): Promise<SavedComponent> {
  const data = await apiPost<ScadaComponentApi>('/scada/components', input);
  return componentFromApi(data);
}

export async function deleteComponent(id: string): Promise<void> {
  await apiDelete(`/scada/components/${id}`);
}

/** Exclusão crítica: exige o token de confirmação de senha do operador. */
export async function deleteScreen(id: string, confirmationToken: string): Promise<void> {
  await apiDelete(`/scada/screens/${id}`, { headers: sensitiveActionHeaders(confirmationToken) });
}

/** Define a tela como inicial ("home") do projeto — desmarca as demais do mesmo projeto. */
export async function setScreenHome(id: string): Promise<ScadaScreen> {
  const data = await apiPatch<ScadaScreenApi>(`/scada/screens/${id}/home`, {});
  return fromApi(data);
}

export interface ScadaScreenVersion {
  id: string;
  name: string;
  description: string | null;
  width: number;
  height: number;
  status: string;
  createdAt: string;
}

/** Baixa um arquivo visual independente, sem expor referências do cliente de origem. */
export async function downloadScreenExport(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/scada/screens/${id}/export`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : 'tela-scada.bluebee-screen';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importScreen(input: {
  tenantId: string;
  siteId: string;
  projectId: string;
  file: unknown;
}): Promise<ScadaScreen> {
  const data = await apiPost<ScadaScreenApi>('/scada/screens/import', input);
  return fromApi(data);
}

export async function getScreenVersions(id: string): Promise<ScadaScreenVersion[]> {
  return apiGet<ScadaScreenVersion[]>(`/scada/screens/${id}/versions`);
}

export async function restoreScreenVersion(id: string, versionId: string): Promise<ScadaScreen> {
  const data = await apiPost<ScadaScreenApi>(`/scada/screens/${id}/versions/${versionId}/restore`, {});
  return fromApi(data);
}

// ─── Projetos do SCADA (cards da landing) ──────────────────────────────────────

/** Projeto existente marcado como visível no SCADA. */
export interface ScadaProject {
  id: string;
  name: string;
  siteId: string;
  tenantId: string;
  coverImageUrl: string | null;
}

interface ScadaProjectApi extends Omit<ScadaProject, 'coverImageUrl'> {
  coverImageUrl?: string | null;
}

function scadaProjectFromApi(project: ScadaProjectApi): ScadaProject {
  return {
    ...project,
    coverImageUrl: resolveAssetUrl(project.coverImageUrl) ?? null,
  };
}

/** Lista os projetos adicionados ao SCADA (filtra por tenant para perfis globais). */
export async function getScadaProjects(tenantId?: string): Promise<ScadaProject[]> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  const data = await apiGet<ScadaProjectApi[]>(`/scada/projects${qs}`);
  return data.map(scadaProjectFromApi);
}

/** Adiciona um projeto existente ao SCADA. */
export async function addScadaProject(projectId: string, coverImageDataUrl?: string): Promise<ScadaProject> {
  const data = await apiPost<ScadaProjectApi>('/scada/projects', {
    projectId,
    ...(coverImageDataUrl !== undefined ? { coverImageDataUrl } : {}),
  });
  return scadaProjectFromApi(data);
}

/** Substitui ou remove a capa de um projeto já presente no SCADA. */
export async function updateScadaProjectCover(
  projectId: string,
  coverImageDataUrl: string | null,
): Promise<ScadaProject> {
  const data = await apiPatch<ScadaProjectApi>(`/scada/projects/${projectId}`, { coverImageDataUrl });
  return scadaProjectFromApi(data);
}

/** Remove o projeto do SCADA: apaga as telas do projeto e tira o card da landing.
 *  Nunca afeta o gateway/dispositivos do cliente.
 *  Exclusão crítica: exige o token de confirmação de senha do operador. */
export async function removeScadaProject(projectId: string, confirmationToken: string): Promise<void> {
  await apiDelete(`/scada/projects/${projectId}`, { headers: sensitiveActionHeaders(confirmationToken) });
}

// ─── Assets de imagem ──────────────────────────────────────────────────────────

/**
 * Envia uma imagem (data URL base64) ao backend e devolve a URL pública relativa
 * para guardar no widget/tela. Mantém os bytes da imagem FORA do JSON da tela —
 * o save passa a trafegar só a URL, evitando estourar o limite de payload e
 * inflar o banco quando há muitas imagens.
 */
export async function uploadScadaAsset(dataUrl: string, tenantId?: string): Promise<string> {
  const { url } = await apiPost<{ url: string }>('/scada/assets', { dataUrl, tenantId });
  return url;
}

/**
 * Resolve a `src` de uma imagem para uma URL carregável pelo navegador.
 * Assets servidos pelo backend vêm como caminho relativo (`/scada-assets/...`) e
 * precisam do host da API. Data URLs legados (`data:`) e URLs absolutas passam direto.
 */
export function resolveAssetUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  // Accept values already resolved through the frontend proxy as well as the
  // relative path persisted by the backend. This avoids `/api/api/...` when a
  // project is refetched after a proxy response.
  if (src.startsWith('/api/scada-assets/')) return src;
  if (src.startsWith('/scada-assets/')) {
    return `${API_URL.replace(/\/$/, '')}${src}`;
  }
  return src;
}
