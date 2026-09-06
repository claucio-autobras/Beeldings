import { apiGet, apiPost } from '@/lib/api-client';

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

export interface InfraspeakProblemOption {
  id: number;
  name: string;
  fullName: string;
  areaId: number | null;
  areaName: string | null;
  /**
   * true = problema disponível a qualquer cliente.
   * false = restrito aos clientes em clientIds.
   */
  allClients: boolean;
  /** IDs dos clientes Infraspeak permitidos quando allClients=false. */
  clientIds: number[];
}

export interface InfraspeakLocalOption {
  id: number;
  name: string;
  fullName: string;
  /**
   * ID do cliente Infraspeak ao qual este local pertence.
   * null quando indeterminado (local sem building, ou building sem client_id).
   */
  clientId: number | null;
}

export interface InfraspeakFormOptions {
  problems: InfraspeakProblemOption[];
  locals: InfraspeakLocalOption[];
}

export interface CreateInfraspeakRequestInput {
  problemId: number;
  localId?: number;
  description: string;
  /** 1–4 (2 = NORMAL). */
  priority?: number;
}

/** Dados de apoio (tipos de problema e locais) para o formulário de abertura. */
export async function getInfraspeakFormOptions(): Promise<InfraspeakFormOptions> {
  return apiGet<InfraspeakFormOptions>('/infraspeak/form-options');
}

/** Cria um chamado (failure) na Infraspeak via backend BlueBee. */
export async function createInfraspeakRequest(
  input: CreateInfraspeakRequestInput,
): Promise<InfraspeakRequestItem> {
  return apiPost<InfraspeakRequestItem>('/infraspeak/requests', input);
}

// ─── Analista de IA de chamados ─────────────────────────────────────────────

export interface AnalyzeInfraspeakInput {
  failureId?: number;
  draft?: {
    problemId?: number;
    problemName?: string;
    localId?: number;
    localName?: string;
    description?: string;
  };
}

export interface InfraspeakSimilarCase {
  failureId: number;
  relation: string;
  resolved: boolean;
}

export interface InfraspeakTicketAnalysis {
  problem: string;
  similarCases: InfraspeakSimilarCase[];
  actions: string[];
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
  insufficientHistory: boolean;
  investigationPoints: string[];
}

export interface InfraspeakAnalysisResult {
  context: {
    target: { failureId: number | null; problemName: string | null; localName: string | null };
    candidates: Array<{
      failureId: number;
      problemName: string | null;
      localName: string | null;
      resolved: boolean;
      similarity: number;
    }>;
    recurrenceSameEquipment: number;
    indexedTotal: number;
  };
  analysis: InfraspeakTicketAnalysis | null;
  aiError: boolean;
}

/** Pede a análise de IA de um chamado (existente ou rascunho). */
export async function analyzeInfraspeakRequest(
  input: AnalyzeInfraspeakInput,
): Promise<InfraspeakAnalysisResult> {
  return apiPost<InfraspeakAnalysisResult>('/infraspeak/requests/analyze', input);
}

/** Dispara a sincronização manual da base local de chamados. */
export async function syncInfraspeakTickets(): Promise<{
  fetched: number;
  created: number;
  updated: number;
  indexedTotal: number;
  error: string | null;
}> {
  return apiPost('/infraspeak/tickets/sync');
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
