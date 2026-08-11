import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { PrismaService } from '../prisma/prisma.service.js';
import { CFTV_PROTOCOLS, EXCLUDE_VIRTUAL_DEVICES } from '../prisma/device-filters.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import type { KnowledgeSearchHit } from '../knowledge/knowledge.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { AlarmEventsService } from '../alarms/alarm-events.service.js';
import { DeviceStatusService } from '../mqtt/device-status.service.js';
import { OperationalMemoryService } from './operational-memory.service.js';
import {
  buildCasesBlock,
  inferQuestionDomain,
  OPERATIONAL_CASES_RULES,
  sanitizeCaseCitations,
  type CaseSearchTarget,
  type SimilarOperationalCase,
} from './operational-memory.util.js';
import {
  buildLiveStatusBlock,
  detectLiveStatusIntent,
  deviceKindLabel,
  LIVE_STATUS_RULES,
  matchNamedEntity,
  type LiveAlarmLine,
  type LiveOfflineDevice,
  type LiveStatusData,
} from './live-status.util.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

export interface ChatSource {
  docId: string;
  title: string;
  type: string;
  source: string | null;
}

export interface ChatResult {
  reply: string;
  conversationId: string;
  title: string;
  sources: ChatSource[];
  /**
   * Casos da memória operacional anônima usados como contexto — SEMPRE os
   * candidatos efetivamente recuperados pela busca, nunca texto do modelo.
   */
  similarCases: SimilarOperationalCase[];
}

export interface SuggestionAlarm {
  name: string;
  message: string;
  severity: string;
  state: string;
  activatedAt: Date;
}

export interface SuggestionResult {
  deviceId: string;
  deviceName: string;
  alarms: SuggestionAlarm[];
  suggestion: string;
  sources: ChatSource[];
  /** Casos anônimos da memória operacional usados como contexto adicional. */
  similarCases: SimilarOperationalCase[];
}

// ─── Primeira ação sugerida (ativo crítico em falha) ─────────────────────────

export interface FirstActionStep {
  text: string;
  /** Título do documento da base de conhecimento que fundamenta o passo. */
  source: string | null;
}

export interface FirstActionSuggestion {
  steps: FirstActionStep[];
  /** Nível de confiança declarado pela IA (depende da cobertura da base). */
  confidence: 'high' | 'medium' | 'low';
  /** Observação curta (ex.: "sem manual aplicável na base"). */
  note: string | null;
  /** true quando a sugestão se apoiou em documentos da base de conhecimento. */
  basedOnKnowledge: boolean;
}

/** Motivo registrado pelo operador ao reconhecer uma ocorrência anterior. */
export interface FirstActionAckHistoryItem {
  acknowledgedAt: Date;
  note: string;
}

export interface FirstActionContext {
  deviceId: string;
  deviceName: string;
  pointName: string | null;
  alarm: SuggestionAlarm | null;
  /** Ocorrências da mesma regra nos últimos 30 dias (reincidência). */
  recurrence30d: number | null;
  /**
   * Motivos de reconhecimentos anteriores da MESMA regra (últimos 90 dias,
   * mais recentes primeiro). Vazio quando não há histórico — a UI usa isso
   * para indicar que a sugestão considerou relatos do operador.
   */
  ackHistory: FirstActionAckHistoryItem[];
}

export interface FirstActionResult {
  context: FirstActionContext;
  /** null quando a IA falhou — o painel mostra só o contexto factual. */
  suggestion: FirstActionSuggestion | null;
  aiError: boolean;
  sources: ChatSource[];
  /** Casos anônimos da memória operacional usados como contexto adicional. */
  similarCases: SimilarOperationalCase[];
}

// Persona base. As regras anti-alucinação são acrescentadas em buildSystemPrompt
// junto com o contexto recuperado da base de conhecimento (RAG).
const BASE_PROMPT = `Você é o Bluebee, assistente especialista da plataforma Beeldings — uma plataforma multi-tenant de supervisão predial (BMS/SCADA).
Ajuda operadores e gestores com alarmes, dispositivos/gateways, telemetria, tendências (trends), automações e relatórios.
Quando se apresentar ou for perguntado sobre sua identidade, diga que é o Bluebee, assistente da plataforma Beeldings.
Responda SEMPRE em português do Brasil, de forma clara, objetiva e técnica.`;

const RAG_RULES = `Regras importantes (aterramento — siga estritamente):
- Baseie a resposta no CONTEXTO da base de conhecimento abaixo e no histórico da conversa.
- Dados técnicos de equipamentos (especificações, faixas, pinagem, bornes, endereços, parâmetros, jumpers, procedimentos de instalação/configuração) devem vir EXCLUSIVAMENTE do contexto abaixo. Nunca complete a partir de conhecimento prévio sobre o equipamento, mesmo que pareça plausível.
- Sempre que usar uma informação do contexto, cite a fonte entre colchetes pelo título do documento, ex.: [MCP17 - Manual do integrador].
- Se a informação pedida NÃO estiver no contexto, diga explicitamente que ela não consta na base de conhecimento (mesmo que o contexto traga outros trechos do mesmo manual) e sugira registrá-la — NÃO invente valores, modelos, números de série, tabelas ou procedimentos.
- Não misture dados de modelos diferentes: se o contexto for de outro modelo que não o perguntado, avise que a base não cobre o modelo solicitado.
- Você não tem acesso direto a leituras em tempo real; para um valor específico, oriente onde o operador encontra na plataforma.`;

const NO_CONTEXT_RULES = `Regras importantes (aterramento — siga estritamente):
- A base de conhecimento não retornou nada relevante para esta pergunta.
- Se a pergunta for sobre dados técnicos de um equipamento específico (especificações, parâmetros, procedimentos, pinagem), responda que essa informação não consta na base de conhecimento e sugira registrá-la — NÃO responda de memória.
- Fora isso, responda apenas com orientação geral e segura sobre BMS/SCADA, deixando claro que é orientação geral.
- NÃO invente dados específicos (valores, modelos, números de série, procedimentos proprietários). Se não souber, diga que não sabe.`;

const SUGGEST_RULES = `Tarefa: sugerir ações de manutenção/operação para um equipamento.
- Baseie as recomendações EXCLUSIVAMENTE nos playbooks/documentos do CONTEXTO abaixo e, quando presentes, nos "CASOS SEMELHANTES JÁ RESOLVIDOS" (precedentes anônimos do sistema). NÃO invente passos, valores ou procedimentos.
- Apresente as ações como uma lista enumerada, ordenadas da mais provável/segura para a menos.
- Para cada ação, cite a fonte entre colchetes pelo título, ex.: [Playbook Chiller — Alta Pressão].
- Deixe explícito que são SUGESTÕES; a decisão e a execução são responsabilidade do operador.
- Se o contexto não cobrir o caso, diga claramente que não há playbook aplicável e sugira registrar a experiência.`;

/**
 * Regras da "primeira ação sugerida" para ativo crítico em falha. A resposta é
 * JSON estrito para render consistente no painel do dashboard. Segurança:
 * nunca sugerir ações destrutivas nem comandos de escrita como passo direto.
 */
const FIRST_ACTION_RULES = (locale: 'pt' | 'en') => `Tarefa: sugerir a PRIMEIRA ação para um operador diante de um ativo crítico em falha.
- Responda APENAS com um JSON válido, sem markdown, no formato exato:
  {"steps":[{"text":"...","source":"Título do documento ou null"}],"confidence":"high|medium|low","note":"observação curta ou null"}
- Gere 2 a 3 passos curtos, concretos e ordenados (verificação primeiro, ação depois).
- Quando um passo se apoiar num documento do CONTEXTO da base de conhecimento, preencha "source" com o TÍTULO exato do documento e comece o texto com "Segundo o manual/playbook..."; senão, "source": null.
- Se não houver contexto aplicável, sugira com base no tipo de alarme/ponto e no histórico, use "confidence":"low" e explique em "note" que não há manual aplicável na base.
- Use "confidence":"high" apenas quando os passos vierem de documento que cobre exatamente este equipamento/falha.
- Se houver "Motivos de reconhecimentos anteriores" no contexto, trate-os como relatos do operador sobre ocorrências passadas do MESMO alarme: podem indicar causa/solução recorrente, mas NÃO são verdade absoluta — use-os para orientar os passos (ex.: verificar primeiro a causa relatada) e, quando usá-los, mencione em "note" que o histórico de reconhecimentos foi considerado.
- Se houver "CASOS SEMELHANTES JÁ RESOLVIDOS" no contexto, trate-os como precedentes ANÔNIMOS do sistema (podem vir de qualquer cliente): podem orientar os passos, mas NUNCA mencione ou infira local/cliente/equipamento de origem, e só mencione precedente se um caso listado for de fato semelhante.
- NUNCA sugira ações destrutivas ou irreversíveis (excluir, resetar de fábrica, desabilitar proteções) nem envio de comandos de escrita como passo executável direto — no máximo "avalie, conforme procedimento local, ...".
- São sugestões de apoio: a decisão e a execução são do operador.
- Escreva os textos em ${locale === 'en' ? 'inglês' : 'português do Brasil'}.`;

// Só consideramos trechos com similaridade mínima para evitar contexto irrelevante.
const MIN_SIMILARITY = 0.2;
// Manuais longos diluem a resposta em muitos chunks; recuperamos mais trechos
// para perguntas técnicas específicas terem o parágrafo certo no contexto.
const RAG_TOP_K = 8;
const MAX_CONTEXT_MESSAGES = 50;
const TITLE_MAX = 80;
// Histórico de motivos de ACK da mesma regra: poucos, recentes e truncados —
// conhecimento operacional sem inflar o prompt.
const ACK_HISTORY_LIMIT = 5;
const ACK_HISTORY_DAYS = 90;
const ACK_NOTE_MAX = 280;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly audit: AuditService,
    private readonly operationalMemory: OperationalMemoryService,
    private readonly alarmEvents: AlarmEventsService,
    private readonly deviceStatus: DeviceStatusService,
  ) {}

  /**
   * Busca casos semelhantes na memória operacional anônima. Degrada com
   * segurança: qualquer falha retorna lista vazia (comportamento atual
   * permanece intacto — a IA nunca inventa precedente).
   */
  private async findSimilarCases(
    query: string,
    target: Parameters<OperationalMemoryService['findSimilar']>[1] = {},
  ): Promise<SimilarOperationalCase[]> {
    try {
      return await this.operationalMemory.findSimilar(query, target);
    } catch (err) {
      this.logger.warn(`Memória operacional indisponível: ${(err as Error).message}`);
      return [];
    }
  }

  private getClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Serviço de IA não configurado: defina a chave ANTHROPIC_API_KEY.',
      );
    }
    return new Anthropic({ apiKey });
  }

  /** Lista as conversas do próprio usuário, da mais recente para a mais antiga. */
  async listConversations(userId: string): Promise<ConversationSummary[]> {
    return this.prisma.aiConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true },
    });
  }

  /** Carrega uma conversa do próprio usuário, com todas as mensagens em ordem. */
  async getConversation(userId: string, conversationId: string): Promise<ConversationDetail> {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    return {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    };
  }

  /** Remove uma conversa do próprio usuário (e suas mensagens via cascade). */
  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    const result = await this.prisma.aiConversation.deleteMany({
      where: { id: conversationId, userId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Conversa não encontrada.');
    }
  }

  /**
   * Processa um novo turno do usuário: cria a conversa se necessário, carrega o
   * histórico como contexto, chama o provedor de IA e persiste ambas as mensagens.
   */
  async chat(
    userId: string,
    tenantId: string | null,
    conversationId: string | null,
    content: string,
    options: {
      /**
       * Habilita o contexto factual ao vivo (diagnóstico/offline/tempo em
       * falha). O controller só liga quando o escopo é seguro: usuário com
       * tenant OU papel global — nunca escopo global "por acidente".
       */
      liveData?: boolean;
    } = {},
  ): Promise<ChatResult> {
    let conversation:
      | { id: string; title: string }
      | null = null;

    if (conversationId) {
      conversation = await this.prisma.aiConversation.findFirst({
        where: { id: conversationId, userId },
        select: { id: true, title: true },
      });
      if (!conversation) {
        throw new NotFoundException('Conversa não encontrada.');
      }
    } else {
      conversation = await this.prisma.aiConversation.create({
        data: {
          title: content.slice(0, TITLE_MAX),
          userId,
          tenantId,
        },
        select: { id: true, title: true },
      });
    }

    // Histórico prévio como contexto (limitado para conter o tamanho do prompt).
    const previous = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    const contextMessages: ChatMessage[] = [
      ...previous.map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
      { role: 'user' as const, content },
    ].slice(-MAX_CONTEXT_MESSAGES);

    // RAG: recupera os trechos mais relevantes da base de conhecimento. A busca
    // degrada com segurança — se o serviço de embeddings falhar, segue sem
    // contexto em vez de derrubar o chat.
    let hits: KnowledgeSearchHit[] = [];
    try {
      // Se a pergunta cita um modelo de equipamento conhecido (ex.: MCP17),
      // priorizamos os chunks desse modelo (boost com fallback — perguntas
      // comparativas citam vários modelos e todos são priorizados).
      const boostModels = await this.detectMentionedModels(content);
      const found = await this.knowledge.search(content, RAG_TOP_K, { boostModels });
      hits = found.filter((h) => h.similarity >= MIN_SIMILARITY);
    } catch (err) {
      this.logger.warn(`Busca na base de conhecimento indisponível: ${(err as Error).message}`);
    }

    // Resolve entidades do tenant citadas na pergunta (site/equipamento por
    // nome) e, quando a pergunta pede estado do sistema, monta o bloco factual
    // ao vivo. Qualquer falha degrada: chat segue como hoje, sem o bloco.
    let liveStatusBlock: string | null = null;
    let mentionedDevice: {
      monitoredDeviceType: string | null;
      protocol: string;
    } | null = null;
    if (options.liveData) {
      try {
        const resolved = await this.resolveLiveChatContext(tenantId, content);
        liveStatusBlock = resolved.block;
        mentionedDevice = resolved.mentionedDevice;
      } catch (err) {
        this.logger.warn(`Contexto ao vivo indisponível no chat: ${(err as Error).message}`);
      }
    }

    // Memória operacional anônima: casos semelhantes já resolvidos em toda a
    // plataforma entram como contexto adicional (nunca identificam a origem).
    // Modo ESTRITO no chat: o alvo vem do equipamento do tenant citado na
    // pergunta ou do domínio inferido do texto (câmera/BMS/switch/acesso);
    // sem domínio inferível, só entra caso com similaridade bem mais alta —
    // pergunta de câmera nunca traz precedente de chiller.
    const caseTarget: CaseSearchTarget = mentionedDevice
      ? {
          monitoredDeviceType: mentionedDevice.monitoredDeviceType,
          protocol: mentionedDevice.protocol,
          strict: true,
        }
      : { domain: inferQuestionDomain(content), strict: true };
    const similarCases = await this.findSimilarCases(content, caseTarget);

    const rawReply = await this.complete(
      contextMessages,
      hits,
      undefined,
      similarCases,
      liveStatusBlock,
    );
    // Anti-alucinação: citações [Caso N] fora dos candidatos recuperados são
    // neutralizadas — a IA só afirma precedente que a busca de fato encontrou.
    const reply = sanitizeCaseCitations(rawReply, similarCases.length);
    const sources = this.dedupeSources(hits);

    await this.prisma.$transaction([
      this.prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'user', content },
      }),
      this.prisma.aiMessage.create({
        data: { conversationId: conversation.id, role: 'assistant', content: reply },
      }),
      // Atualiza updatedAt para a conversa subir na lista de histórico.
      this.prisma.aiConversation.update({
        where: { id: conversation.id },
        data: {},
      }),
    ]);

    return {
      reply,
      conversationId: conversation.id,
      title: conversation.title,
      sources,
      similarCases,
    };
  }

  /**
   * Resolve o contexto ao vivo de um turno do chat: casa site/equipamento do
   * tenant citados na pergunta e, quando a pergunta pede estado do sistema,
   * monta o bloco factual (alarmes ativos com duração + offline com "desde
   * quando"), sempre no escopo do tenant. Lança em falha — o chamador degrada.
   */
  private async resolveLiveChatContext(
    tenantId: string | null,
    content: string,
  ): Promise<{
    block: string | null;
    mentionedDevice: { monitoredDeviceType: string | null; protocol: string } | null;
  }> {
    const tenantWhere = tenantId ? { tenantId } : {};
    const [sites, devices] = await Promise.all([
      this.prisma.site.findMany({
        where: tenantWhere,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.device.findMany({
        where: { ...tenantWhere, ...EXCLUDE_VIRTUAL_DEVICES },
        select: {
          id: true,
          name: true,
          protocol: true,
          monitoredDeviceType: true,
          siteId: true,
          gatewayId: true,
          site: { select: { name: true } },
        },
      }),
    ]);

    const matchedDevice = matchNamedEntity(content, devices);
    const matchedSite = matchedDevice ? null : matchNamedEntity(content, sites);
    const mentionedDevice = matchedDevice
      ? { monitoredDeviceType: matchedDevice.monitoredDeviceType, protocol: matchedDevice.protocol }
      : null;

    if (!detectLiveStatusIntent(content)) {
      return { block: null, mentionedDevice };
    }

    // Escopo: equipamento citado > site citado > cliente inteiro.
    const scopeDevices = matchedDevice
      ? [matchedDevice]
      : matchedSite
        ? devices.filter((d) => d.siteId === matchedSite.id)
        : devices;
    const scopeLabel = matchedDevice
      ? `equipamento "${matchedDevice.name}"`
      : matchedSite
        ? `site "${matchedSite.name}"`
        : tenantId
          ? 'todos os sites e equipamentos do cliente'
          : 'toda a plataforma (papel global)';

    // Alarmes ativos no escopo — reusa o serviço da tela de alarmes (ordena
    // por severidade e atividade; tenant sempre respeitado).
    const alarmDtos = await this.alarmEvents.findAll({
      tenantId: tenantId ?? undefined,
      open: true,
      ...(matchedDevice ? { deviceId: matchedDevice.id } : {}),
      ...(matchedSite ? { siteId: matchedSite.id } : {}),
    });
    const alarms: LiveAlarmLine[] = alarmDtos.map((a) => ({
      name: a.name,
      message: a.message ?? null,
      severity: a.severity,
      state: a.state,
      deviceName: a.deviceName,
      siteName: a.siteName,
      activatedAt: new Date(a.activatedAt),
      reactivationCount: a.reactivationCount,
      lastReactivatedAt: a.lastReactivatedAt ? new Date(a.lastReactivatedAt) : null,
    }));

    // Equipamentos offline no escopo — status ao vivo (LWT/heartbeat/telemetria)
    // com "visto por último" durável (nunca datas de cadastro).
    const offlineRaw = scopeDevices.filter((d) => this.deviceStatus.getStatus(d.id) === 'offline');
    const lastSeenMap = await this.deviceStatus.resolveLastSeenMany(offlineRaw.map((d) => d.id));
    const offlineDevices: LiveOfflineDevice[] = offlineRaw.map((d) => {
      const iso = lastSeenMap.get(d.id) ?? null;
      return {
        name: d.name,
        kindLabel: deviceKindLabel(d.monitoredDeviceType, d.protocol),
        siteName: d.site?.name ?? null,
        lastSeen: iso ? new Date(iso) : null,
      };
    });

    // Gateways do escopo: os referenciados pelos equipamentos do escopo quando
    // há site/equipamento citado; senão todos os do tenant.
    const scopeGatewayIds = new Set(
      scopeDevices.map((d) => d.gatewayId).filter((g): g is string => Boolean(g)),
    );
    const gateways = await this.prisma.gateway.findMany({
      where: {
        ...tenantWhere,
        ...(matchedDevice || matchedSite ? { id: { in: [...scopeGatewayIds] } } : {}),
      },
      select: { id: true, status: true, lastSeen: true },
    });
    const offlineGateways = gateways
      .filter((g) => g.status !== 'online')
      .map((g) => ({ id: g.id, lastSeen: g.lastSeen }));

    const data: LiveStatusData = {
      now: new Date(),
      scopeLabel,
      siteNames: sites.map((s) => s.name),
      alarms,
      offlineDevices,
      totalDevicesInScope: scopeDevices.length,
      offlineGateways,
      totalGatewaysInScope: gateways.length,
    };
    return { block: buildLiveStatusBlock(data), mentionedDevice };
  }

  /**
   * Sugere ações para um equipamento. Usa SOMENTE dados do tenant do usuário
   * (device + alarmes recentes) e cruza com os playbooks aprovados da base. A
   * recomendação é sintetizada a partir desses playbooks, com citação — nunca
   * inventada. Marcada como sugestão; a decisão é sempre do operador.
   */
  async suggestForDevice(
    tenantId: string | null,
    deviceId: string,
    symptom?: string,
  ): Promise<SuggestionResult> {
    // Elegível: qualquer equipamento real do tenant, inclusive câmeras CFTV.
    // Só a Bancada (virtual) fica de fora — nunca é equipamento real.
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, ...(tenantId ? { tenantId } : {}), ...EXCLUDE_VIRTUAL_DEVICES },
      select: { id: true, name: true, protocol: true, monitoredDeviceType: true },
    });
    if (!device) {
      throw new NotFoundException('Equipamento não encontrado.');
    }

    // Alarmes recentes deste equipamento (via regra → ponto → device), no tenant.
    const events = await this.prisma.alarmEvent.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        kind: 'ALARM',
        alarmRule: { point: { deviceId } },
      },
      orderBy: { activatedAt: 'desc' },
      take: 5,
      select: {
        state: true,
        activatedAt: true,
        alarmRule: { select: { name: true, message: true, severity: true } },
      },
    });

    const alarms: SuggestionAlarm[] = events.map((e) => {
      // Escopado a kind='ALARM', portanto alarmRule está sempre presente.
      const rule = e.alarmRule!;
      return {
        name: rule.name,
        message: rule.message,
        severity: rule.severity,
        state: e.state,
        activatedAt: e.activatedAt,
      };
    });

    // Monta a consulta semântica a partir do contexto operacional (sem IDs).
    const queryParts = [
      device.name,
      device.protocol,
      symptom?.trim(),
      ...alarms.map((a) => `${a.name}: ${a.message}`),
    ].filter((p): p is string => Boolean(p));
    const query = queryParts.join('. ');

    let hits: KnowledgeSearchHit[] = [];
    if (query) {
      try {
        const found = await this.knowledge.search(query, RAG_TOP_K, { type: 'PLAYBOOK' });
        hits = found.filter((h) => h.similarity >= MIN_SIMILARITY);
      } catch (err) {
        this.logger.warn(`Busca na base indisponível (sugestão): ${(err as Error).message}`);
      }
    }

    // Memória operacional anônima: casos resolvidos semelhantes de toda a
    // plataforma entram como contexto adicional (sem sintoma/alarmes só o
    // nome ajudaria pouco — a consulta reusa a mesma query semântica).
    // Modo ESTRITO (mesma regra do chat): o domínio vem do equipamento
    // concreto — sugestão de câmera nunca traz precedente de chiller.
    const similarCases = query
      ? await this.findSimilarCases(query, {
          monitoredDeviceType: device.monitoredDeviceType,
          protocol: device.protocol,
          strict: true,
        })
      : [];

    // Sem playbook E sem caso semelhante: comportamento atual intacto.
    if (hits.length === 0 && similarCases.length === 0) {
      return {
        deviceId: device.id,
        deviceName: device.name,
        alarms,
        suggestion:
          'Ainda não há playbooks na base de conhecimento aplicáveis a este equipamento/sintoma. Registre a experiência para que o assistente passe a recomendar ações aqui.',
        sources: [],
        similarCases: [],
      };
    }

    const alarmsText =
      alarms.length > 0
        ? alarms.map((a) => `- [${a.severity}/${a.state}] ${a.name}: ${a.message}`).join('\n')
        : 'Nenhum alarme recente registrado.';
    const userPrompt = `Equipamento: ${device.name} (protocolo ${device.protocol}).
Sintoma informado: ${symptom?.trim() || '(não informado)'}.
Alarmes recentes:\n${alarmsText}\n\nComo agir?`;

    const rawSuggestion = await this.complete(
      [{ role: 'user', content: userPrompt }],
      hits,
      SUGGEST_RULES,
      similarCases,
    );
    const suggestion = sanitizeCaseCitations(rawSuggestion, similarCases.length);

    return {
      deviceId: device.id,
      deviceName: device.name,
      alarms,
      suggestion,
      sources: this.dedupeSources(hits),
      similarCases,
    };
  }

  /**
   * "Primeira ação sugerida" para um ativo crítico em falha do dashboard.
   * Monta o contexto factual (alarme dominante, reincidência 30d, pontos do
   * equipamento), busca manuais/playbooks na base e pede 2–3 passos em JSON.
   * A falha da IA NÃO derruba o endpoint: retorna o contexto com aiError=true
   * para o painel degradar com elegância. Rate limit fica no guard da rota.
   */
  async firstAction(
    user: AuthenticatedUser,
    tenantId: string | null,
    input: { deviceId: string; pointId?: string; alarmEventId?: string; locale?: 'pt' | 'en' },
  ): Promise<FirstActionResult> {
    const locale = input.locale === 'en' ? 'en' : 'pt';
    // Elegível: qualquer equipamento real do tenant, inclusive câmeras CFTV
    // (críticas no nível do equipamento). Só a Bancada (virtual) fica de fora.
    const device = await this.prisma.device.findFirst({
      where: { id: input.deviceId, ...(tenantId ? { tenantId } : {}), ...EXCLUDE_VIRTUAL_DEVICES },
      select: {
        id: true,
        name: true,
        protocol: true,
        monitoredDeviceType: true,
        config: true,
        tenantId: true,
        points: {
          select: { id: true, tag: true, objectName: true, opRole: true, unit: true },
          take: 12,
        },
      },
    });
    if (!device) {
      throw new NotFoundException('Equipamento não encontrado.');
    }

    // Alarme dominante: o evento indicado pelo card quando informado; senão o
    // alarme ativo mais severo/antigo do equipamento (opcionalmente do ponto).
    const eventWhere = {
      ...(tenantId ? { tenantId } : {}),
      kind: 'ALARM' as const,
      alarmRule: {
        point: { deviceId: device.id, ...(input.pointId ? { id: input.pointId } : {}) },
      },
    };
    let event = input.alarmEventId
      ? await this.prisma.alarmEvent.findFirst({
          where: { id: input.alarmEventId, ...eventWhere },
          select: {
            state: true,
            activatedAt: true,
            alarmRule: { select: { id: true, name: true, message: true, type: true, severity: true, pointId: true } },
          },
        })
      : null;
    if (!event) {
      const active = await this.prisma.alarmEvent.findMany({
        where: { ...eventWhere, state: { in: ['ACTIVE', 'ACTIVE_ACK'] } },
        orderBy: { activatedAt: 'asc' },
        select: {
          state: true,
          activatedAt: true,
          alarmRule: { select: { id: true, name: true, message: true, type: true, severity: true, pointId: true } },
        },
      });
      const rank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      event = [...active].sort(
        (a, b) => (rank[b.alarmRule!.severity] ?? 0) - (rank[a.alarmRule!.severity] ?? 0),
      )[0] ?? null;
    }

    // Reincidência: ocorrências da MESMA regra nos últimos 30 dias.
    const recurrence30d = event
      ? await this.prisma.alarmEvent.count({
          where: {
            ...(tenantId ? { tenantId } : {}),
            kind: 'ALARM',
            alarmRuleId: event.alarmRule!.id,
            activatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        })
      : null;

    // Motivos de reconhecimentos anteriores da MESMA regra: conhecimento
    // operacional (ex.: causa/solução relatada) para a IA e para a UI. Só
    // ocorrências com motivo preenchido; falha aqui nunca derruba o endpoint.
    let ackHistory: FirstActionAckHistoryItem[] = [];
    if (event) {
      try {
        const acked = await this.prisma.alarmEvent.findMany({
          where: {
            ...(tenantId ? { tenantId } : {}),
            kind: 'ALARM',
            alarmRuleId: event.alarmRule!.id,
            acknowledgedAt: {
              not: null,
              gte: new Date(Date.now() - ACK_HISTORY_DAYS * 24 * 60 * 60 * 1000),
            },
            ackNote: { not: null },
          },
          orderBy: { acknowledgedAt: 'desc' },
          take: ACK_HISTORY_LIMIT,
          select: { acknowledgedAt: true, ackNote: true },
        });
        ackHistory = acked
          .filter((a) => a.acknowledgedAt && a.ackNote?.trim())
          .map((a) => ({
            acknowledgedAt: a.acknowledgedAt!,
            note:
              a.ackNote!.trim().length > ACK_NOTE_MAX
                ? `${a.ackNote!.trim().slice(0, ACK_NOTE_MAX)}…`
                : a.ackNote!.trim(),
          }));
      } catch (err) {
        this.logger.warn(
          `Histórico de reconhecimentos indisponível (primeira ação): ${(err as Error).message}`,
        );
      }
    }

    const point = event?.alarmRule?.pointId
      ? device.points.find((p) => p.id === event!.alarmRule!.pointId) ?? null
      : input.pointId
        ? device.points.find((p) => p.id === input.pointId) ?? null
        : null;

    const context: FirstActionContext = {
      deviceId: device.id,
      deviceName: device.name,
      pointName: point ? point.objectName || point.tag : null,
      alarm: event
        ? {
            name: event.alarmRule!.name,
            message: event.alarmRule!.message,
            severity: event.alarmRule!.severity,
            state: event.state,
            activatedAt: event.activatedAt,
          }
        : null,
      recurrence30d,
      ackHistory,
    };

    // Busca semântica: manuais E playbooks (sem filtro de tipo) — a primeira
    // ação pode vir tanto de procedimento quanto de manual do equipamento.
    // Contexto CFTV: câmeras têm domínio próprio (STATUS online/offline,
    // eventos motion/tamper/video_loss, fabricante no config do device).
    const isCamera = (CFTV_PROTOCOLS as readonly string[]).includes(device.protocol);
    const cfg = (device.config ?? {}) as {
      manufacturer?: string | null;
      deviceInfo?: { manufacturer?: string | null; model?: string | null } | null;
      model?: string | null;
    };
    const manufacturer = isCamera
      ? cfg.manufacturer ?? cfg.deviceInfo?.manufacturer ?? null
      : null;
    const cameraModel = isCamera ? cfg.model ?? cfg.deviceInfo?.model ?? null : null;

    const queryParts = [
      device.name,
      isCamera
        ? `câmera CFTV ${[manufacturer, cameraModel].filter(Boolean).join(' ')} (${device.protocol})`
        : device.protocol,
      point ? `${point.objectName || point.tag}${point.unit ? ` (${point.unit})` : ''}` : null,
      event ? `${event.alarmRule!.name}: ${event.alarmRule!.message}` : null,
      isCamera ? 'câmera offline, perda de vídeo, rede, PoE' : null,
      'primeira ação, diagnóstico inicial, verificação',
    ].filter((p): p is string => Boolean(p));

    let hits: KnowledgeSearchHit[] = [];
    try {
      const found = await this.knowledge.search(queryParts.join('. '), RAG_TOP_K);
      hits = found.filter((h) => h.similarity >= MIN_SIMILARITY);
    } catch (err) {
      this.logger.warn(`Busca na base indisponível (primeira ação): ${(err as Error).message}`);
    }

    // Memória operacional anônima: precedentes resolvidos de toda a plataforma
    // como contexto adicional (mesma regra de anonimato dos demais fluxos).
    // Modo ESTRITO (mesma regra do chat): o domínio deriva do tipo de
    // equipamento monitorado — alarme de câmera nunca mostra caso BMS solto.
    const similarCases = await this.findSimilarCases(queryParts.join('. '), {
      monitoredDeviceType: device.monitoredDeviceType,
      protocol: device.protocol,
      alarmType: event?.alarmRule?.type ?? null,
      strict: true,
    });

    const pointsText = device.points
      .map((p) => `- ${p.objectName || p.tag}${p.opRole ? ` [${p.opRole}]` : ''}${p.unit ? ` (${p.unit})` : ''}`)
      .join('\n');
    const faultMin = event
      ? Math.max(0, Math.round((Date.now() - event.activatedAt.getTime()) / 60_000))
      : null;
    const cameraLine = isCamera
      ? `Tipo: câmera de CFTV${manufacturer ? ` (fabricante ${manufacturer}${cameraModel ? `, modelo ${cameraModel}` : ''})` : ''}, monitorada via ${device.protocol.toUpperCase()}. O ponto STATUS indica online (1) / offline (0); eventos como motion, tamper e video_loss são pontos digitais da câmera.\n`
      : '';
    const userPrompt = `Ativo crítico em falha.
Equipamento: ${device.name} (protocolo ${device.protocol}).
${cameraLine}${point ? `Ponto em falha: ${point.objectName || point.tag}.` : ''}
Alarme ativo: ${
      event
        ? `[${event.alarmRule!.severity}] ${event.alarmRule!.name} — ${event.alarmRule!.message} (há ~${faultMin} min; ${recurrence30d ?? 0} ocorrência(s) desta regra nos últimos 30 dias)`
        : 'nenhum alarme ativo identificado (equipamento sinalizado em falha pelo dashboard)'
    }.
Pontos do equipamento:\n${pointsText || '(sem pontos cadastrados)'}
${
      ackHistory.length > 0
        ? `\nMotivos de reconhecimentos anteriores deste MESMO alarme (relatos do operador, do mais recente ao mais antigo — podem indicar causa/solução recorrente, mas não são verdade absoluta):\n${ackHistory
            .map(
              (a) =>
                `- [${a.acknowledgedAt.toISOString().slice(0, 10)}] "${a.note}"`,
            )
            .join('\n')}\n`
        : ''
    }\nQual a primeira ação?`;

    let suggestion: FirstActionSuggestion | null = null;
    let aiError = false;
    try {
      const raw = await this.complete(
        [{ role: 'user', content: userPrompt }],
        hits,
        FIRST_ACTION_RULES(locale),
        similarCases,
      );
      suggestion = this.parseFirstAction(raw, hits.length > 0);
      if (suggestion) {
        suggestion = {
          ...suggestion,
          steps: suggestion.steps.map((s) => ({
            ...s,
            text: sanitizeCaseCitations(s.text, similarCases.length),
          })),
          note: suggestion.note
            ? sanitizeCaseCitations(suggestion.note, similarCases.length)
            : suggestion.note,
        };
      }
    } catch (err) {
      this.logger.warn(`IA indisponível (primeira ação): ${(err as Error).message}`);
      aiError = true;
    }

    // Trilha: registra que a sugestão foi gerada (sem conteúdo — só metadados).
    void this.audit.record({
      actor: { id: user.id, name: user.name, email: user.email, role: user.role },
      action: 'CREATE',
      entityType: 'Sugestão de IA (primeira ação)',
      entityName: device.name,
      entityId: device.id,
      change: aiError
        ? 'IA indisponível — painel exibiu apenas o contexto factual'
        : suggestion?.basedOnKnowledge
          ? 'Sugestão gerada com base na base de conhecimento'
          : 'Sugestão gerada sem manual aplicável (orientação geral)',
      tenantId: device.tenantId,
      result: aiError ? 'FAILURE' : 'SUCCESS',
    });

    return { context, suggestion, aiError, sources: this.dedupeSources(hits), similarCases };
  }

  /**
   * Interpreta a resposta JSON da IA com tolerância (cerca markdown, campos
   * fora do esperado). Se o JSON não parsear, degrada para um passo único com
   * o texto bruto — o painel nunca fica sem render por formato.
   */
  private parseFirstAction(raw: string, hadContext: boolean): FirstActionSuggestion {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      const parsed = JSON.parse(cleaned) as {
        steps?: Array<{ text?: unknown; source?: unknown }>;
        confidence?: unknown;
        note?: unknown;
      };
      const steps: FirstActionStep[] = (Array.isArray(parsed.steps) ? parsed.steps : [])
        .map((s) => ({
          text: typeof s?.text === 'string' ? s.text.trim() : '',
          source: typeof s?.source === 'string' && s.source.trim() ? s.source.trim() : null,
        }))
        .filter((s) => s.text)
        .slice(0, 3);
      if (steps.length === 0) throw new Error('sem passos');
      const confidence =
        parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
          ? parsed.confidence
          : hadContext
            ? 'medium'
            : 'low';
      return {
        steps,
        confidence,
        note: typeof parsed.note === 'string' && parsed.note.trim() ? parsed.note.trim() : null,
        basedOnKnowledge: steps.some((s) => s.source !== null),
      };
    } catch {
      return {
        steps: [{ text: cleaned.slice(0, 1200), source: null }],
        confidence: 'low',
        note: null,
        basedOnKnowledge: false,
      };
    }
  }

  /**
   * Detecta quais equipmentModel da base de conhecimento aparecem na pergunta,
   * por casamento de palavra inteira (case-insensitive). Falha de forma segura:
   * qualquer erro retorna lista vazia e a busca segue sem boost.
   */
  private async detectMentionedModels(question: string): Promise<string[]> {
    try {
      const models = await this.knowledge.listSearchableModels();
      return models.filter((model) => {
        const escaped = model.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!escaped) return false;
        // Limite por não-alfanumérico (e não \b) para modelos com hífen/ponto.
        const re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
        return re.test(question);
      });
    } catch (err) {
      this.logger.warn(`Detecção de modelo indisponível: ${(err as Error).message}`);
      return [];
    }
  }

  /** Monta o bloco de contexto (RAG) a ser injetado no system prompt. */
  private buildContext(hits: KnowledgeSearchHit[]): string {
    return hits
      .map((h, i) => {
        const meta = [h.equipmentType, h.equipmentModel].filter(Boolean).join(' / ');
        const header = meta ? `${h.title} (${meta})` : h.title;
        return `[${i + 1}] ${header}\n${h.content}`;
      })
      .join('\n\n---\n\n');
  }

  /** Dedup das fontes por documento, para exibir as referências da resposta. */
  private dedupeSources(hits: KnowledgeSearchHit[]): ChatSource[] {
    const seen = new Set<string>();
    const sources: ChatSource[] = [];
    for (const h of hits) {
      if (seen.has(h.docId)) continue;
      seen.add(h.docId);
      sources.push({ docId: h.docId, title: h.title, type: h.type, source: h.source });
    }
    return sources;
  }

  /** Chamada bruta ao provedor de IA, sem persistência. */
  private async complete(
    messages: ChatMessage[],
    hits: KnowledgeSearchHit[],
    rulesOverride?: string,
    similarCases: SimilarOperationalCase[] = [],
    liveStatusBlock: string | null = null,
  ): Promise<string> {
    const client = this.getClient();

    // rulesOverride (ex.: primeira ação) vale SEMPRE — inclusive sem hits da
    // base — para manter o contrato JSON e a proibição de ações destrutivas.
    let system =
      hits.length > 0
        ? `${BASE_PROMPT}\n\n${rulesOverride ?? RAG_RULES}\n\n=== CONTEXTO DA BASE DE CONHECIMENTO ===\n${this.buildContext(
            hits,
          )}\n=== FIM DO CONTEXTO ===`
        : `${BASE_PROMPT}\n\n${rulesOverride ?? NO_CONTEXT_RULES}`;

    // Memória operacional anônima: bloco + regras SOMENTE quando há casos
    // recuperados — sem casos, o prompt (e o comportamento) fica idêntico ao
    // atual, e a IA não tem como "citar" precedente inexistente.
    if (similarCases.length > 0) {
      system += `\n\n${buildCasesBlock(similarCases)}\n\n${OPERATIONAL_CASES_RULES}`;
    }

    // Contexto factual ao vivo (diagnóstico/offline/tempo em falha): bloco +
    // regras SOMENTE quando o chamador montou o bloco — sem ele, o prompt
    // fica idêntico ao atual (a IA continua sem "acesso" a tempo real).
    if (liveStatusBlock) {
      system += `\n\n${liveStatusBlock}\n\n${LIVE_STATUS_RULES}`;
    }

    const chatMessages: MessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system,
        messages: chatMessages,
      });

      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
    } catch (err) {
      this.logger.error(`Falha ao chamar o provedor de IA: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        'Não foi possível obter resposta do assistente de IA. Verifique a chave e tente novamente.',
      );
    }
  }
}
