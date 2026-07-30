import { apiGet, apiPost, apiPatch, apiDelete, API_URL, sensitiveActionHeaders } from '@/lib/api-client';
import type { ScadaScreen, Widget, ScreenSettings, ScadaScreenStatus, SavedComponent } from '../types/scada.types';

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
    widgets: Array.isArray(s.widgets) ? (s.widgets as Widget[]) : [],
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
  siteId?: string;
  projectId?: string;
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

export async function getScreen(id: string): Promise<ScadaScreen> {
  const data = await apiGet<ScadaScreenApi>(`/scada/screens/${id}`);
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
    widgets: Array.isArray(c.widgets) ? (c.widgets as Widget[]) : [],
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

// ─── Projetos do SCADA (cards da landing) ──────────────────────────────────────

/** Projeto existente marcado como visível no SCADA. */
export interface ScadaProject {
  id: string;
  name: string;
  siteId: string;
  tenantId: string;
}

/** Lista os projetos adicionados ao SCADA (filtra por tenant para perfis globais). */
export async function getScadaProjects(tenantId?: string): Promise<ScadaProject[]> {
  const qs = tenantId ? `?tenantId=${tenantId}` : '';
  return apiGet<ScadaProject[]>(`/scada/projects${qs}`);
}

/** Adiciona um projeto existente ao SCADA. */
export async function addScadaProject(projectId: string): Promise<ScadaProject> {
  return apiPost<ScadaProject>('/scada/projects', { projectId });
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
export function resolveAssetUrl(src: string | undefined): string | undefined {
  if (!src) return src;
  if (src.startsWith('/scada-assets/')) return `${API_URL}${src}`;
  return src;
}
