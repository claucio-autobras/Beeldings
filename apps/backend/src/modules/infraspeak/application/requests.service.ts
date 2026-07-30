import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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
}
