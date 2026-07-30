import { apiGet } from '@/lib/api-client';

/**
 * Cliente do endpoint interno `GET /infraspeak/requests` (backend BlueBee).
 * O backend consolida a paginação da Infraspeak e devolve o formato limpo
 * `InfraspeakRequestItem`. Filtros JQL (s_*, date_min_*, sort) são repassados
 * diretamente à API da Infraspeak via query string.
 */

export interface InfraspeakRequestItem {
  id: number | null;
  uuid: string | null;
  description: string | null;
  observations: string | null;
  state: string | null;
  stateDescription: string | null;
  priority: number | null;
  priorityText: string | null;
  problemId: number | null;
  problemName: string | null;
  clientId: number | null;
  clientCode: string | null;
  clientName: string | null;
  localId: number | null;
  localCode: string | null;
  localName: string | null;
  reportDate: string | null;
  startedDate: string | null;
  completedDate: string | null;
  approvedDate: string | null;
  pausedDate: string | null;
  lastStatusChangeDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  nextSlaDate: string | null;
  solved: boolean | null;
  confirmed: boolean | null;
  /** Payload original íntegro da Infraspeak (estilo JSON:API), preservado pelo backend. */
  raw?: {
    type?: string;
    id?: string | number;
    attributes?: Record<string, unknown>;
  };
}

export interface InfraspeakRequestsResult {
  resource: string;
  total: number;
  pages: number;
  data: InfraspeakRequestItem[];
}

export interface InfraspeakRequestFilters {
  /** Filtro JQL exato de estado (ex.: WAITING_APPROVAL) → `s_state`. */
  state?: string;
  /** Filtro JQL exato de prioridade numérica (ex.: 2) → `s_priority`. */
  priority?: number;
}

export async function getInfraspeakRequests(
  filters: InfraspeakRequestFilters = {},
): Promise<InfraspeakRequestsResult> {
  const params = new URLSearchParams();
  if (filters.state) params.set('s_state', filters.state);
  if (filters.priority !== undefined) params.set('s_priority', String(filters.priority));
  const qs = params.toString();
  return apiGet<InfraspeakRequestsResult>(`/infraspeak/requests${qs ? `?${qs}` : ''}`);
}
