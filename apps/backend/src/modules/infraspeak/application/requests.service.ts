import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfraspeakClient, InfraspeakQuery } from '../infrastructure/infraspeak.client.js';

/**
 * Item cru do recurso `failures` conforme retornado pela API (estilo JSON:API):
 *   { "type": "failure", "id": "709936", "attributes": { ... } }
 *
 * Estrutura confirmada com chamada real ao sandbox em 20/07/2026 — ver
 * `docs/infraspeak-requirements-api.md`, secção "Campos confirmados".
 */
export interface InfraspeakFailureRaw {
  type?: string;
  id?: string | number;
  attributes?: Record<string, unknown>;
}

/**
 * Chamado (failure) mapeado para o formato interno limpo do BlueBee.
 * Todos os campos vêm do payload real confirmado; nada é inventado.
 */
export interface InfraspeakRequestItem {
  /** ID numérico do chamado (attributes.failure_id / id do envelope). */
  id: number | null;
  uuid: string | null;
  /** Descrição livre do chamado. */
  description: string | null;
  observations: string | null;
  /** Estado do fluxo (ex.: WAITING_APPROVAL, ...). `status` e `state` vêm iguais no payload real. */
  state: string | null;
  stateDescription: string | null;
  /** Prioridade numérica e texto (ex.: 2 / "NORMAL"). */
  priority: number | null;
  priorityText: string | null;
  /** Problema/categoria associado. */
  problemId: number | null;
  problemName: string | null;
  /** Cliente associado. */
  clientId: number | null;
  clientCode: string | null;
  clientName: string | null;
  /** Local onde o chamado ocorreu. */
  localId: number | null;
  localCode: string | null;
  localName: string | null;
  /** Datas do ciclo de vida (strings "YYYY-MM-DD HH:mm:ss" como vêm da API). */
  reportDate: string | null;
  startedDate: string | null;
  completedDate: string | null;
  approvedDate: string | null;
  pausedDate: string | null;
  lastStatusChangeDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Prazo (SLA) mais próximo, quando existir. */
  nextSlaDate: string | null;
  /** Flags de conclusão. */
  solved: boolean | null;
  confirmed: boolean | null;
  /** Payload original íntegro, para não perder nenhum campo. */
  raw: InfraspeakFailureRaw;
}

/**
 * Entrada para criação de chamado (failure) na Infraspeak.
 * Contrato confirmado contra o sandbox em 31/07/2026 — ver
 * `docs/infraspeak-requirements-api.md`, secção "Criação de chamados".
 */
export interface CreateInfraspeakRequestInput {
  /** ID de um problem FOLHA (problem_type). Áreas (problem_area) são recusadas pela API. */
  problemId: number;
  /** Local onde o problema ocorre (obrigatório quando não há elementId). */
  localId?: number;
  /** Elemento/ativo (alternativa ao localId). */
  elementId?: number;
  /** Descrição livre do problema. */
  description: string;
  /** Prioridade 1–4 (2 = NORMAL). */
  priority?: number;
}

/** Opção de problem (tipo de chamado) para o formulário. */
export interface InfraspeakProblemOption {
  id: number;
  name: string;
  fullName: string;
  /** Área (grupo) a que pertence. */
  areaId: number | null;
  areaName: string | null;
  /**
   * true = problema disponível para qualquer cliente (all_clients=true na API).
   * false = problema restrito aos clientes em `clientIds`.
   *
   * Confirmado no sandbox (05/08/2026): problem_area com all_clients=false
   * só pode ser usado em failures de clientes na sua lista. A criação com
   * problema fora do escopo retorna 400 "O tipo de chamado deve existir".
   */
  allClients: boolean;
  /**
   * IDs dos clientes Infraspeak que têm acesso quando allClients=false.
   * Vazio quando allClients=true.
   */
  clientIds: number[];
}

/** Opção de local para o formulário. */
export interface InfraspeakLocalOption {
  id: number;
  name: string;
  fullName: string;
  /**
   * client_id do prédio (building) ao qual este local pertence.
   * Resolvido via root_parent_id → building.client_id.
   * null quando o local é um prédio-raiz sem client_id ou o prédio não foi encontrado.
   */
  clientId: number | null;
}

/** Dados de apoio para o formulário de abertura de chamado. */
export interface InfraspeakFormOptions {
  problems: InfraspeakProblemOption[];
  locals: InfraspeakLocalOption[];
}

/** Resultado consolidado dos chamados (failures) obtidos da Infraspeak. */
export interface InfraspeakRequestsResult {
  /** Caminho do recurso efetivamente consultado (vindo de configuração). */
  resource: string;
  /** Total de itens consolidados de todas as páginas. */
  total: number;
  /** Número de páginas percorridas. */
  pages: number;
  /** Chamados mapeados para o formato interno (com `raw` preservado). */
  data: InfraspeakRequestItem[];
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asBoolean(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/**
 * Mapeia um item cru do recurso `failures` para o formato interno limpo,
 * preservando o payload original em `raw`.
 */
export function mapFailure(item: unknown): InfraspeakRequestItem {
  const rawItem = (item && typeof item === 'object' ? item : {}) as InfraspeakFailureRaw;
  const attrs = (rawItem.attributes && typeof rawItem.attributes === 'object'
    ? rawItem.attributes
    : {}) as Record<string, unknown>;

  return {
    id: asNumber(attrs.failure_id) ?? asNumber(rawItem.id),
    uuid: asString(attrs.uuid),
    description: asString(attrs.description),
    observations: asString(attrs.observations),
    state: asString(attrs.state) ?? asString(attrs.status),
    stateDescription: asString(attrs.state_description),
    priority: asNumber(attrs.priority),
    priorityText: asString(attrs.priority_text),
    problemId: asNumber(attrs.problem_id),
    problemName: asString(attrs.problem_name),
    clientId: asNumber(attrs.client_id),
    clientCode: asString(attrs.client_code),
    clientName: asString(attrs.client_name),
    localId: asNumber(attrs.local_id),
    localCode: asString(attrs.local_code),
    localName: asString(attrs.local_name),
    reportDate: asString(attrs.report_date),
    startedDate: asString(attrs.started_date),
    completedDate: asString(attrs.completed_date),
    approvedDate: asString(attrs.approved_date),
    pausedDate: asString(attrs.paused_date),
    lastStatusChangeDate: asString(attrs.last_status_change_date),
    createdAt: asString(attrs.created_at),
    updatedAt: asString(attrs.updated_at),
    nextSlaDate: asString(attrs.next_sla_date),
    solved: asBoolean(attrs.solved),
    confirmed: asBoolean(attrs.confirmed),
    raw: rawItem,
  };
}

/**
 * Serviço responsável por consumir o recurso correspondente aos chamados do
 * negócio na Infraspeak. Trata a paginação automaticamente e consolida todas as
 * páginas em uma única coleção.
 */
@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  /**
   * Caminho do recurso dos chamados. Vem 100% de configuração para NÃO fixar no
   * código um endpoint que não foi confirmado na documentação oficial. Confirme
   * o valor correto com a Infraspeak (ex.: "v3/<recurso>").
   */
  private readonly resourcePath: string;

  constructor(
    private readonly client: InfraspeakClient,
    private readonly config: ConfigService,
  ) {
    this.resourcePath = this.config.get<string>('INFRASPEAK_REQUESTS_PATH') ?? '';
  }

  /**
   * Consulta os chamados na Infraspeak, percorrendo todas as páginas e
   * consolidando o resultado. Filtros JQL (s_*, date_min_*, sort, etc.) podem ser
   * repassados via `query`.
   */
  async findAll(query: InfraspeakQuery = {}): Promise<InfraspeakRequestsResult> {
    if (!this.resourcePath) {
      throw new ServiceUnavailableException(
        'Recurso de chamados não configurado: defina INFRASPEAK_REQUESTS_PATH com o ' +
          'caminho confirmado na documentação oficial da Infraspeak (ex.: "v3/<recurso>").',
      );
    }

    this.logger.log(`Infraspeak: consultando chamados em "${this.resourcePath}" (auto-paginação)`);

    const { data, pages } = await this.client.getAll(this.resourcePath, { query });

    this.logger.log(`Infraspeak: ${data.length} chamado(s) consolidado(s) de ${pages} página(s)`);

    const mapped = data.map((item) => mapFailure(item));

    return {
      resource: this.resourcePath,
      total: mapped.length,
      pages,
      data: mapped,
    };
  }

  /**
   * Cria um chamado (failure) na Infraspeak.
   *
   * Contrato confirmado contra o sandbox: `POST /failures` com
   * `{ problem_id, local_id | element_id, description, priority }`.
   * O problem precisa ser um tipo FOLHA (problem_type); prioridade 1–4.
   */
  async create(input: CreateInfraspeakRequestInput): Promise<InfraspeakRequestItem> {
    this.assertResource();
    const payload = buildCreateFailurePayload(input);

    this.logger.log(
      `Infraspeak: criando chamado (problem_id=${payload.problem_id}, ` +
        `${payload.local_id !== undefined ? `local_id=${payload.local_id}` : `element_id=${payload.element_id}`})`,
    );

    const { data } = await this.client.post(this.resourcePath, payload);
    const mapped = mapFailure(data);
    this.logger.log(`Infraspeak: chamado criado com sucesso (#${mapped.id ?? '?'})`);
    return mapped;
  }

  /**
   * Dados de apoio para o formulário de abertura de chamado.
   *
   * - Problems folha vêm de `GET /problems?expanded=children,clients`: a lista
   *   `data` traz as áreas (problem_area) com os atributos `all_clients` e a
   *   relação `clients`; os tipos folha (problem_type) chegam em `included` —
   *   só eles são aceitos na criação. Os filhos herdam o escopo da área pai.
   * - Locais vêm de `GET /locations` (JSON:API). Só entradas `type: "location"`
   *   são oferecidas: prédios (`building`) e pastas (`location-folder`) são
   *   recusados pela criação de failure ("O edifício deve existir").
   *   O campo `clientId` é resolvido via `root_parent_id → building.client_id`
   *   do mesmo payload — sem requests adicionais.
   *
   * Causa raiz do erro de rejeição (confirmado sandbox 05/08/2026):
   *   problem_area com all_clients=false só pode ser usado em failures cujo
   *   local pertence a um cliente na sua lista; fora desse escopo a Infraspeak
   *   retorna HTTP 400 "O tipo de chamado deve existir" / validation.has_access_network.
   *   A API NÃO oferece filtro nativo por client_id em /problems (retorna 500
   *   code 42703); o filtro é feito client-side usando a relation `clients`.
   */
  async getFormOptions(): Promise<InfraspeakFormOptions> {
    const [problemsRes, localsRes] = await Promise.all([
      this.client.get<InfraspeakFailureRaw>('problems', {
        query: { expanded: 'children,clients', limit: 400 },
      }),
      this.client.getAll<InfraspeakFailureRaw>('locations'),
    ]);

    // ── Índice de áreas: problem_id → { name, allClients, clientIds } ────────
    const areaById = new Map<
      number,
      { name: string; allClients: boolean; clientIds: number[] }
    >();
    for (const area of problemsRes.data ?? []) {
      const attrs = (area?.attributes ?? {}) as Record<string, unknown>;
      const id = asNumber(attrs.problem_id);
      const name = asString(attrs.name);
      if (id === null || !name) continue;

      // all_clients=true → problema disponível a qualquer cliente.
      const allClients = attrs.all_clients !== false;

      // clients relationship → IDs dos clientes permitidos quando all_clients=false.
      const rel = (area as Record<string, unknown>).relationships as
        | Record<string, { data?: Array<{ id: string | number }> }>
        | undefined;
      const clientIds: number[] = [];
      if (!allClients && Array.isArray(rel?.clients?.data)) {
        for (const c of rel!.clients!.data!) {
          const cid = asNumber(c.id);
          if (cid !== null) clientIds.push(cid);
        }
      }

      areaById.set(id, { name, allClients, clientIds });
    }

    const included = Array.isArray((problemsRes as { included?: unknown[] }).included)
      ? ((problemsRes as { included?: unknown[] }).included as InfraspeakFailureRaw[])
      : [];

    const problems: InfraspeakProblemOption[] = included
      .map((item) => {
        const attrs = (item?.attributes ?? {}) as Record<string, unknown>;
        const id = asNumber(attrs.problem_id);
        if (id === null) return null;
        const parentId = asNumber(attrs.parent_id);
        const area = parentId !== null ? areaById.get(parentId) : undefined;
        return {
          id,
          name: asString(attrs.name) ?? String(id),
          fullName: asString(attrs.full_name) ?? asString(attrs.name) ?? String(id),
          areaId: parentId,
          areaName: area?.name ?? null,
          // Herda o escopo de acesso da área pai.
          allClients: area?.allClients ?? true,
          clientIds: area?.clientIds ?? [],
        };
      })
      .filter((p): p is InfraspeakProblemOption => p !== null)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt'));

    // ── Mapa de prédios → clientId ──────────────────────────────────────────
    // Buildings têm client_id direto; locations resolvem via root_parent_id.
    const buildingClientMap = new Map<number, number>();
    for (const raw of localsRes.data) {
      if (raw?.type !== 'building') continue;
      const attrs = (raw?.attributes ?? {}) as Record<string, unknown>;
      const bid = asNumber(attrs.local_id);
      const cid = asNumber(attrs.client_id);
      if (bid !== null && cid !== null) buildingClientMap.set(bid, cid);
    }

    const locals: InfraspeakLocalOption[] = localsRes.data
      .filter((raw) => raw?.type === 'location')
      .map((raw) => {
        const attrs = (raw?.attributes ?? {}) as Record<string, unknown>;
        const id = asNumber(attrs.local_id);
        if (id === null) return null;
        // Resolve clientId via root_parent_id → building.client_id.
        const rootParentId = asNumber(attrs.root_parent_id);
        const clientId = rootParentId !== null ? (buildingClientMap.get(rootParentId) ?? null) : null;
        return {
          id,
          name: asString(attrs.name) ?? String(id),
          fullName: asString(attrs.full_name) ?? asString(attrs.name) ?? String(id),
          clientId,
        };
      })
      .filter((l): l is InfraspeakLocalOption => l !== null)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt'));

    return { problems, locals };
  }

  private assertResource(): void {
    if (!this.resourcePath) {
      throw new ServiceUnavailableException(
        'Recurso de chamados não configurado: defina INFRASPEAK_REQUESTS_PATH com o ' +
          'caminho confirmado na documentação oficial da Infraspeak (ex.: "v3/<recurso>").',
      );
    }
  }
}

/**
 * Valida a entrada e monta o payload de criação exatamente como a API espera.
 * Exportada para testes de unidade.
 */
export function buildCreateFailurePayload(
  input: CreateInfraspeakRequestInput,
): Record<string, unknown> {
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!description) {
    throw new BadRequestException('Informe a descrição do problema.');
  }
  if (description.length > 5000) {
    throw new BadRequestException('Descrição muito longa (máximo 5000 caracteres).');
  }

  const problemId = toPositiveInt(input.problemId);
  if (problemId === null) {
    throw new BadRequestException('Selecione o tipo de chamado (problema).');
  }

  const localId = input.localId === undefined ? null : toPositiveInt(input.localId);
  const elementId = input.elementId === undefined ? null : toPositiveInt(input.elementId);
  if (localId === null && elementId === null) {
    throw new BadRequestException('Selecione o local (ou elemento) onde o problema ocorre.');
  }
  if (localId !== null && elementId !== null) {
    throw new BadRequestException('Informe apenas o local OU o elemento, nunca ambos.');
  }

  let priority: number | undefined;
  if (input.priority !== undefined) {
    const p = toPositiveInt(input.priority);
    if (p === null || p < 1 || p > 4) {
      throw new BadRequestException('Prioridade inválida: use um valor entre 1 e 4.');
    }
    priority = p;
  }

  const payload: Record<string, unknown> = { problem_id: problemId, description };
  if (localId !== null) payload.local_id = localId;
  if (elementId !== null) payload.element_id = elementId;
  if (priority !== undefined) payload.priority = priority;
  return payload;
}

function toPositiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
