import {
  INSUFFICIENT_MESSAGE,
  MAX_CASES,
  MIN_CASE_SIMILARITY,
  hasSufficientHistory,
  parseAnalysisResponse,
  rankSimilarCases,
  type TicketCandidate,
} from './ticket-analysis.service.js';
import { composeTicketText, hasConfirmedResolution } from './ticket-index.service.js';
import type { InfraspeakRequestItem } from './requests.service.js';

function candidate(overrides: Partial<TicketCandidate> = {}): TicketCandidate {
  return {
    failureId: 1,
    problemId: 10,
    problemName: 'Elétrica',
    localId: 100,
    localName: 'Sala Elétrica',
    description: 'Falha no disjuntor',
    observations: 'Rearmado o disjuntor',
    state: 'COMPLETED',
    hasResolution: true,
    similarity: 0.6,
    ...overrides,
  };
}

function item(overrides: Partial<InfraspeakRequestItem> = {}): InfraspeakRequestItem {
  return {
    id: 1,
    uuid: null,
    description: null,
    observations: null,
    state: null,
    stateDescription: null,
    priority: null,
    priorityText: null,
    problemId: null,
    problemName: null,
    clientId: null,
    clientCode: null,
    clientName: null,
    localId: null,
    localCode: null,
    localName: null,
    reportDate: null,
    startedDate: null,
    completedDate: null,
    approvedDate: null,
    pausedDate: null,
    lastStatusChangeDate: null,
    createdAt: null,
    updatedAt: null,
    nextSlaDate: null,
    solved: null,
    confirmed: null,
    raw: {},
    ...overrides,
  };
}

describe('rankSimilarCases', () => {
  const target = { problemId: 10, localId: 100 };

  it('descarta candidatos abaixo do corte de similaridade', () => {
    const out = rankSimilarCases(target, [
      candidate({ failureId: 1, similarity: MIN_CASE_SIMILARITY - 0.01 }),
      candidate({ failureId: 2, similarity: MIN_CASE_SIMILARITY + 0.01 }),
    ]);
    expect(out.map((c) => c.failureId)).toEqual([2]);
  });

  it('prioriza mesmo equipamento > mesmo problema > só similaridade', () => {
    const out = rankSimilarCases(target, [
      candidate({ failureId: 1, problemId: 99, localId: 999, similarity: 0.6 }), // só sintoma
      candidate({ failureId: 2, problemId: 10, localId: 999, similarity: 0.6 }), // mesmo problema
      candidate({ failureId: 3, problemId: 10, localId: 100, similarity: 0.6 }), // mesmo equipamento
    ]);
    expect(out.map((c) => c.failureId)).toEqual([3, 2, 1]);
    expect(out[0].sameEquipment).toBe(true);
    expect(out[1].sameProblem).toBe(true);
    expect(out[2].sameEquipment).toBe(false);
    expect(out[2].sameProblem).toBe(false);
  });

  it('favorece resolução confirmada e coloca não resolvidos sempre depois', () => {
    const out = rankSimilarCases(target, [
      // Não resolvido com score alto (mesmo equipamento)…
      candidate({ failureId: 1, hasResolution: false, similarity: 0.9 }),
      // …ainda assim fica atrás de um resolvido com score menor.
      candidate({ failureId: 2, problemId: 99, localId: 999, hasResolution: true, similarity: 0.4 }),
    ]);
    expect(out.map((c) => c.failureId)).toEqual([2, 1]);
  });

  it('limita ao máximo de casos', () => {
    const many = Array.from({ length: MAX_CASES + 5 }, (_, i) =>
      candidate({ failureId: i + 1, similarity: 0.5 }),
    );
    expect(rankSimilarCases(target, many)).toHaveLength(MAX_CASES);
  });

  it('funciona com alvo sem problem/local (rascunho só com descrição)', () => {
    const out = rankSimilarCases({ problemId: null, localId: null }, [
      candidate({ failureId: 1, similarity: 0.5 }),
    ]);
    expect(out[0].sameEquipment).toBe(false);
    expect(out[0].sameProblem).toBe(false);
  });
});

describe('hasSufficientHistory', () => {
  it('exige pelo menos um caso com resolução confirmada', () => {
    const target = { problemId: 10, localId: 100 };
    const unresolvedOnly = rankSimilarCases(target, [
      candidate({ failureId: 1, hasResolution: false, similarity: 0.9 }),
      candidate({ failureId: 2, hasResolution: false, similarity: 0.8 }),
    ]);
    expect(hasSufficientHistory(unresolvedOnly)).toBe(false);

    const withResolved = rankSimilarCases(target, [
      candidate({ failureId: 1, hasResolution: false, similarity: 0.9 }),
      candidate({ failureId: 3, hasResolution: true, similarity: 0.5 }),
    ]);
    expect(hasSufficientHistory(withResolved)).toBe(true);
  });

  it('sem nenhum caso acima do corte → insuficiente', () => {
    expect(hasSufficientHistory(rankSimilarCases({ problemId: 1, localId: 1 }, []))).toBe(false);
  });
});

describe('parseAnalysisResponse — salvaguardas fora do modelo', () => {
  const target = { problemId: 10, localId: 100 };
  const cases = rankSimilarCases(target, [
    candidate({ failureId: 1, hasResolution: true, similarity: 0.7 }),
    candidate({ failureId: 2, hasResolution: false, similarity: 0.6 }),
  ]);

  const payload = (over: Record<string, unknown>) =>
    JSON.stringify({
      problem: 'p',
      similarCases: [{ failureId: 1, relation: 'igual' }],
      actions: ['verificar'],
      evidence: 'com base no #1',
      confidence: 'medium',
      insufficientHistory: false,
      investigationPoints: [],
      ...over,
    });

  it('aceita recomendação quando cita caso resolvido válido', () => {
    const out = parseAnalysisResponse(payload({}), cases, true);
    expect(out.insufficientHistory).toBe(false);
    expect(out.similarCases).toEqual([{ failureId: 1, relation: 'igual', resolved: true }]);
    expect(out.actions).toEqual(['verificar']);
  });

  it('descarta IDs alucinados (não listados nos candidatos)', () => {
    const out = parseAnalysisResponse(
      payload({ similarCases: [{ failureId: 999, relation: 'x' }, { failureId: 1, relation: 'ok' }] }),
      cases,
      true,
    );
    expect(out.similarCases.map((c) => c.failureId)).toEqual([1]);
  });

  it('IA citando SÓ não resolvidos → histórico insuficiente, mesmo com resolvido no pool', () => {
    const out = parseAnalysisResponse(
      payload({ similarCases: [{ failureId: 2, relation: 'parecido' }] }),
      cases,
      true,
    );
    expect(out.insufficientHistory).toBe(true);
    expect(out.similarCases).toEqual([]);
    expect(out.actions).toEqual([]);
    expect(out.evidence).toBe(INSUFFICIENT_MESSAGE);
    expect(out.confidence).toBe('low');
  });

  it('sem caso resolvido no pool (sufficient=false) → sempre insuficiente', () => {
    const unresolvedOnly = rankSimilarCases(target, [
      candidate({ failureId: 2, hasResolution: false, similarity: 0.6 }),
    ]);
    const out = parseAnalysisResponse(
      payload({ similarCases: [{ failureId: 2, relation: 'x' }] }),
      unresolvedOnly,
      false,
    );
    expect(out.insufficientHistory).toBe(true);
  });

  it('JSON quebrado degrada para insuficiente sem lançar', () => {
    const out = parseAnalysisResponse('não é json', cases, true);
    expect(out.insufficientHistory).toBe(true);
    expect(out.evidence).toBe(INSUFFICIENT_MESSAGE);
  });

  it('remove cerca de markdown ```json antes de interpretar', () => {
    const out = parseAnalysisResponse('```json\n' + payload({}) + '\n```', cases, true);
    expect(out.insufficientHistory).toBe(false);
  });

  it('confidence inválida vira low', () => {
    const out = parseAnalysisResponse(payload({ confidence: 'huge' }), cases, true);
    expect(out.confidence).toBe('low');
  });
});

describe('composeTicketText / hasConfirmedResolution', () => {
  it('compõe o texto com problema, local, descrição e observações', () => {
    const text = composeTicketText(
      item({
        problemName: 'HVAC',
        localName: 'Cobertura',
        description: 'Chiller desarmando',
        observations: 'Trocado o pressostato',
        state: 'COMPLETED',
        solved: true,
      }),
    );
    expect(text).toContain('Problema/categoria: HVAC');
    expect(text).toContain('Local: Cobertura');
    expect(text).toContain('Descrição/sintomas: Chiller desarmando');
    expect(text).toContain('Observações/diagnóstico/solução: Trocado o pressostato');
    expect(text).toContain('Resolução: chamado resolvido.');
  });

  it('muda quando o chamado ganha observações/estado — dispara re-embedding no sync', () => {
    const before = composeTicketText(item({ description: 'Falha X', state: 'WAITING_APPROVAL' }));
    const after = composeTicketText(
      item({ description: 'Falha X', state: 'COMPLETED', observations: 'Resolvido com reset' }),
    );
    expect(before).not.toEqual(after);
  });

  it('resolução confirmada = solved ou completedDate', () => {
    expect(hasConfirmedResolution(item({ solved: true }))).toBe(true);
    expect(hasConfirmedResolution(item({ completedDate: '2026-07-01 10:00:00' }))).toBe(true);
    expect(hasConfirmedResolution(item({ solved: false, completedDate: null }))).toBe(false);
    expect(hasConfirmedResolution(item({}))).toBe(false);
  });
});
