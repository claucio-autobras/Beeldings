import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmbeddingsService } from '../../knowledge/embeddings.service.js';
import { AuditService } from '../../audit/audit.service.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Entrada da análise: um chamado existente OU um rascunho ainda não criado. */
export interface AnalyzeTicketInput {
  /** ID do chamado existente na Infraspeak (cópia local). */
  failureId?: number;
  /** Rascunho (antes de criar): categoria/descrição/local. */
  draft?: {
    problemId?: number;
    problemName?: string;
    localId?: number;
    localName?: string;
    description?: string;
  };
}

/** Candidato retornado pela busca vetorial na cópia local. */
export interface TicketCandidate {
  failureId: number;
  problemId: number | null;
  problemName: string | null;
  localId: number | null;
  localName: string | null;
  description: string | null;
  observations: string | null;
  state: string | null;
  hasResolution: boolean;
  similarity: number;
}

/** Candidato ranqueado com o score final e as razões da priorização. */
export interface RankedCase extends TicketCandidate {
  score: number;
  sameEquipment: boolean;
  sameProblem: boolean;
}

export interface AnalysisSimilarCase {
  failureId: number;
  relation: string;
  resolved: boolean;
}

/** Resposta estruturada da IA, no formato do roteiro. */
export interface TicketAnalysis {
  problem: string;
  similarCases: AnalysisSimilarCase[];
  actions: string[];
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
  /** true quando não há casos com similaridade suficiente. */
  insufficientHistory: boolean;
  /** Pontos de investigação (só no caminho de histórico insuficiente). */
  investigationPoints: string[];
}

export interface TicketAnalysisResult {
  /** Contexto factual sempre presente (a IA pode falhar). */
  context: {
    target: { failureId: number | null; problemName: string | null; localName: string | null };
    candidates: Array<{
      failureId: number;
      problemName: string | null;
      localName: string | null;
      resolved: boolean;
      similarity: number;
    }>;
    /** Ocorrências anteriores do MESMO problema no MESMO local (recorrência). */
    recurrenceSameEquipment: number;
    indexedTotal: number;
  };
  analysis: TicketAnalysis | null;
  aiError: boolean;
}

// ─── Ranqueamento (puro, exportado para testes) ──────────────────────────────

/** Similaridade vetorial mínima para um caso contar como "semelhante". */
export const MIN_CASE_SIMILARITY = 0.35;
/** Máximo de casos levados ao prompt da IA. */
export const MAX_CASES = 8;

/**
 * Ranqueia os candidatos seguindo a prioridade do roteiro:
 * mesmo equipamento (mesmo problema no mesmo local) > mesmo tipo de problema >
 * sintomas semelhantes (similaridade vetorial); resolução confirmada é
 * favorecida. Chamados sem resolução NUNCA são evidência principal: só entram
 * se houver menos casos resolvidos que MAX_CASES, e sempre depois deles.
 */
export function rankSimilarCases(
  target: { problemId: number | null; localId: number | null },
  candidates: TicketCandidate[],
): RankedCase[] {
  const ranked: RankedCase[] = candidates
    .filter((c) => c.similarity >= MIN_CASE_SIMILARITY)
    .map((c) => {
      const sameProblem = target.problemId !== null && c.problemId === target.problemId;
      const sameEquipment = sameProblem && target.localId !== null && c.localId === target.localId;
      let score = c.similarity;
      if (sameEquipment) score += 0.25;
      else if (sameProblem) score += 0.15;
      if (c.hasResolution) score += 0.15;
      return { ...c, score, sameEquipment, sameProblem };
    })
    .sort((a, b) => b.score - a.score);

  // Resolvidos primeiro (evidência principal); não resolvidos só completam.
  const resolved = ranked.filter((c) => c.hasResolution);
  const unresolved = ranked.filter((c) => !c.hasResolution);
  return [...resolved, ...unresolved].slice(0, MAX_CASES);
}

/**
 * Há histórico suficiente quando existe pelo menos um caso semelhante COM
 * resolução confirmada — sem isso, nunca fabricamos recomendação.
 */
export function hasSufficientHistory(cases: RankedCase[]): boolean {
  return cases.some((c) => c.hasResolution);
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

const ANALYST_RULES = `Você é o analista de chamados de manutenção do BlueBee. Sua ÚNICA base de evidência são os CHAMADOS HISTÓRICOS listados abaixo (cópia local da Infraspeak).
Responda APENAS com um JSON válido, sem markdown, no formato exato:
{"problem":"resumo objetivo do problema","similarCases":[{"failureId":123,"relation":"por que é semelhante","resolved":true}],"actions":["passo 1","passo 2"],"evidence":"por que a ação é recomendada, citando os números dos chamados","confidence":"high|medium|low","insufficientHistory":false,"investigationPoints":[]}

Regras estritas (siga TODAS):
- NUNCA invente solução, procedimento ou informação que não esteja sustentada pelos chamados históricos listados. Não use conhecimento prévio sobre equipamentos.
- Em "similarCases", inclua SOMENTE chamados da lista abaixo, pelos seus números (failureId) exatos.
- Chamados SEM resolução confirmada (marcados como "não resolvido") não podem ser a evidência principal: podem no máximo reforçar contexto.
- Priorize: mesmo equipamento (mesmo problema no mesmo local) > mesmo tipo de problema > sintomas semelhantes > resolução confirmada > frequência.
- Se houver recorrência no mesmo equipamento (informada no contexto), destaque isso em "evidence" — recorrência pode indicar necessidade de investigação da causa raiz.
- "actions": passos numeráveis, curtos e concretos, em ordem (verificação primeiro). Nunca sugira ações destrutivas/irreversíveis.
- "confidence": "high" só com diversos chamados muito semelhantes e mesma solução; "medium" com casos semelhantes mas variações; "low" com poucos casos ou informação fraca.
- Se os casos listados NÃO forem suficientemente semelhantes ao novo chamado, use "insufficientHistory": true, "similarCases": [], "actions": [], comece "evidence" com "Não foram encontrados casos anteriores com similaridade suficiente para recomendar uma ação com segurança." e liste apenas pontos de investigação em "investigationPoints", deixando claro que não são solução comprovada.
- É apoio à decisão: a solução anterior não necessariamente resolve o novo chamado.
- Escreva em português do Brasil.`;

export const INSUFFICIENT_MESSAGE =
  'Não foram encontrados casos anteriores com similaridade suficiente para recomendar uma ação com segurança.';

/**
 * Interpreta a resposta JSON da IA com tolerância e aplica as salvaguardas do
 * roteiro FORA do modelo (pura, exportada para testes):
 * - só chamados realmente listados podem ser citados (alucinação de ID descarta);
 * - a recomendação só vale se a EVIDÊNCIA CITADA incluir pelo menos um chamado
 *   com resolução confirmada — não basta existir um resolvido no pool de
 *   candidatos; sem isso, degrada para "histórico insuficiente".
 */
export function parseAnalysisResponse(
  raw: string,
  cases: RankedCase[],
  sufficient: boolean,
): TicketAnalysis {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const validIds = new Map(cases.map((c) => [c.failureId, c] as const));

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // JSON quebrado: degrada para histórico insuficiente com o texto como nota.
    return {
      problem: '',
      similarCases: [],
      actions: [],
      evidence: INSUFFICIENT_MESSAGE,
      confidence: 'low',
      insufficientHistory: true,
      investigationPoints: [cleaned.slice(0, 600)].filter(Boolean),
    };
  }

  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [];

  const similarCases: AnalysisSimilarCase[] = (Array.isArray(parsed.similarCases)
    ? parsed.similarCases
    : []
  )
    .map((c) => {
      const rec = (c ?? {}) as { failureId?: unknown; relation?: unknown };
      const id = Number(rec.failureId);
      const known = validIds.get(id);
      if (!known) return null; // alucinação de ID: descarta.
      return {
        failureId: id,
        relation: typeof rec.relation === 'string' ? rec.relation : '',
        resolved: known.hasResolution,
      };
    })
    .filter((c): c is AnalysisSimilarCase => c !== null);

  const declaredInsufficient = parsed.insufficientHistory === true;
  // Salvaguarda dura: evidência principal exige caso CITADO com resolução.
  const citedResolved = similarCases.some((c) => c.resolved);
  const insufficient = declaredInsufficient || !sufficient || !citedResolved;

  if (insufficient) {
    return {
      problem: typeof parsed.problem === 'string' ? parsed.problem : '',
      similarCases: [],
      actions: [],
      evidence: INSUFFICIENT_MESSAGE,
      confidence: 'low',
      insufficientHistory: true,
      investigationPoints: strArray(parsed.investigationPoints).slice(0, 6),
    };
  }

  const confidence =
    parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
      ? parsed.confidence
      : 'low';

  return {
    problem: typeof parsed.problem === 'string' ? parsed.problem : '',
    similarCases,
    actions: strArray(parsed.actions).slice(0, 8),
    evidence: typeof parsed.evidence === 'string' ? parsed.evidence : '',
    confidence,
    insufficientHistory: false,
    investigationPoints: [],
  };
}

/**
 * Analista de chamados Infraspeak: busca casos semelhantes na cópia local
 * indexada (pgvector) e pede ao Claude uma recomendação fundamentada — sempre
 * citando os chamados de referência, com nível de confiança e caminho
 * explícito de "histórico insuficiente". Falha da IA nunca vira 5xx: o
 * endpoint devolve o contexto factual com aiError=true (padrão first-action).
 */
@Injectable()
export class TicketAnalysisService {
  private readonly logger = new Logger(TicketAnalysisService.name);
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    private readonly audit: AuditService,
  ) {}

  async analyze(user: AuthenticatedUser, input: AnalyzeTicketInput): Promise<TicketAnalysisResult> {
    // 1. Alvo: chamado existente (cópia local) ou rascunho.
    const target = await this.resolveTarget(input);

    const indexedTotal = await this.prisma.infraspeakTicket.count();

    // 2. Busca vetorial pelos candidatos mais próximos (excluindo o próprio).
    const candidates = await this.searchCandidates(target.queryText, target.failureId);
    const cases = rankSimilarCases(
      { problemId: target.problemId, localId: target.localId },
      candidates,
    );
    const sufficient = hasSufficientHistory(cases);

    // 3. Recorrência no mesmo equipamento: mesmo problema no mesmo local.
    const recurrenceSameEquipment =
      target.problemId !== null && target.localId !== null
        ? await this.prisma.infraspeakTicket.count({
            where: {
              problemId: target.problemId,
              localId: target.localId,
              ...(target.failureId !== null ? { failureId: { not: target.failureId } } : {}),
            },
          })
        : 0;

    const context: TicketAnalysisResult['context'] = {
      target: {
        failureId: target.failureId,
        problemName: target.problemName,
        localName: target.localName,
      },
      candidates: cases.map((c) => ({
        failureId: c.failureId,
        problemName: c.problemName,
        localName: c.localName,
        resolved: c.hasResolution,
        similarity: Math.round(c.similarity * 100) / 100,
      })),
      recurrenceSameEquipment,
      indexedTotal,
    };

    // 4. Sem NENHUM caso acima do corte: caminho de histórico insuficiente
    //    determinístico — ainda pedimos à IA apenas os pontos de investigação.
    let analysis: TicketAnalysis | null = null;
    let aiError = false;
    try {
      const raw = await this.complete(this.buildPrompt(target, cases, recurrenceSameEquipment));
      analysis = parseAnalysisResponse(raw, cases, sufficient);
    } catch (err) {
      this.logger.warn(`IA indisponível (análise de chamado): ${(err as Error).message}`);
      aiError = true;
    }

    // Trilha de auditoria (metadados, nunca o conteúdo).
    void this.audit.record({
      actor: { id: user.id, name: user.name, email: user.email, role: user.role },
      action: 'CREATE',
      entityType: 'Análise IA de chamado Infraspeak',
      entityName:
        target.failureId !== null ? `Chamado Infraspeak #${target.failureId}` : 'Rascunho de chamado',
      entityId: target.failureId !== null ? String(target.failureId) : null,
      change: aiError
        ? 'IA indisponível — exibido apenas o contexto factual'
        : analysis?.insufficientHistory
          ? 'Histórico insuficiente — apenas pontos de investigação'
          : `Recomendação com ${analysis?.similarCases.length ?? 0} caso(s) de referência`,
      tenantId: user.tenantId ?? null,
      result: aiError ? 'FAILURE' : 'SUCCESS',
    });

    return { context, analysis, aiError };
  }

  // ─── Interno ───────────────────────────────────────────────────────────────

  private async resolveTarget(input: AnalyzeTicketInput): Promise<{
    failureId: number | null;
    problemId: number | null;
    problemName: string | null;
    localId: number | null;
    localName: string | null;
    description: string | null;
    queryText: string;
  }> {
    if (input.failureId !== undefined && input.failureId !== null) {
      const failureId = Number(input.failureId);
      if (!Number.isInteger(failureId) || failureId <= 0) {
        throw new BadRequestException('failureId inválido.');
      }
      const ticket = await this.prisma.infraspeakTicket.findUnique({
        where: { failureId },
        select: {
          failureId: true,
          problemId: true,
          problemName: true,
          localId: true,
          localName: true,
          description: true,
          composedText: true,
        },
      });
      if (!ticket) {
        throw new NotFoundException(
          'Chamado ainda não sincronizado na base local. Aguarde a próxima sincronização (ou dispare-a manualmente) e tente de novo.',
        );
      }
      return { ...ticket, queryText: ticket.composedText };
    }

    const draft = input.draft;
    const description = typeof draft?.description === 'string' ? draft.description.trim() : '';
    if (!draft || (!description && !draft.problemName && !draft.problemId)) {
      throw new BadRequestException(
        'Informe o chamado a analisar (failureId) ou um rascunho com descrição/problema.',
      );
    }
    const parts = [
      draft.problemName ? `Problema/categoria: ${draft.problemName}` : null,
      draft.localName ? `Local: ${draft.localName}` : null,
      description ? `Descrição/sintomas: ${description}` : null,
    ].filter((p): p is string => Boolean(p));
    return {
      failureId: null,
      problemId: Number.isInteger(draft.problemId) ? (draft.problemId as number) : null,
      problemName: draft.problemName ?? null,
      localId: Number.isInteger(draft.localId) ? (draft.localId as number) : null,
      localName: draft.localName ?? null,
      description: description || null,
      queryText: parts.join('\n'),
    };
  }

  private async searchCandidates(
    queryText: string,
    excludeFailureId: number | null,
  ): Promise<TicketCandidate[]> {
    const vec = this.embeddings.toSqlVector(await this.embeddings.embedOne(queryText));
    const rows = await this.prisma.$queryRaw<
      Array<{
        failureId: number;
        problemId: number | null;
        problemName: string | null;
        localId: number | null;
        localName: string | null;
        description: string | null;
        observations: string | null;
        state: string | null;
        hasResolution: boolean;
        similarity: number;
      }>
    >`
      SELECT
        t."failure_id" AS "failureId",
        t."problem_id" AS "problemId",
        t."problem_name" AS "problemName",
        t."local_id" AS "localId",
        t."local_name" AS "localName",
        t."description" AS "description",
        t."observations" AS "observations",
        t."state" AS "state",
        t."has_resolution" AS "hasResolution",
        1 - (t."embedding" <=> ${vec}::vector) AS "similarity"
      FROM "infraspeak_tickets" t
      WHERE t."embedding" IS NOT NULL
        AND (${excludeFailureId}::int IS NULL OR t."failure_id" <> ${excludeFailureId})
      ORDER BY t."embedding" <=> ${vec}::vector
      LIMIT 30
    `;
    return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
  }

  private buildPrompt(
    target: {
      failureId: number | null;
      problemName: string | null;
      localName: string | null;
      description: string | null;
    },
    cases: RankedCase[],
    recurrence: number,
  ): string {
    const casesText =
      cases.length > 0
        ? cases
            .map((c) => {
              const flags = [
                c.sameEquipment ? 'MESMO EQUIPAMENTO (mesmo problema no mesmo local)' : null,
                !c.sameEquipment && c.sameProblem ? 'mesmo tipo de problema' : null,
                c.hasResolution ? 'resolução confirmada' : 'NÃO RESOLVIDO',
              ]
                .filter(Boolean)
                .join('; ');
              return `Chamado #${c.failureId} [${flags}] — problema: ${c.problemName ?? '?'}; local: ${
                c.localName ?? '?'
              }\n  Descrição: ${c.description ?? '(sem descrição)'}\n  Observações/solução: ${
                c.observations ?? '(sem observações registradas)'
              }`;
            })
            .join('\n\n')
        : '(nenhum chamado histórico com similaridade suficiente)';

    return `NOVO CHAMADO A ANALISAR:
${target.failureId !== null ? `Número: #${target.failureId}` : 'Rascunho (ainda não criado)'}
Problema/categoria: ${target.problemName ?? '(não informado)'}
Local: ${target.localName ?? '(não informado)'}
Descrição/sintomas: ${target.description ?? '(não informada)'}
Recorrência: ${recurrence} chamado(s) anteriores com o MESMO problema no MESMO local.

CHAMADOS HISTÓRICOS SEMELHANTES (única base de evidência permitida):
${casesText}

Analise o novo chamado e responda no JSON especificado.`;
  }

  private async complete(userPrompt: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Serviço de IA não configurado: defina a chave ANTHROPIC_API_KEY.',
      );
    }
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: ANALYST_RULES,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  }
}
