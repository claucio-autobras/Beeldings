/**
 * Testes unitários das funções puras do CreateInfraspeakRequestModal.
 *
 * Cobre: filterProblemsByClient, submitErrorMessage e a lógica de reset
 * de problemId ao trocar de local (sem DOM/React — só lógica).
 *
 * Contexto: problema com all_clients=false só pode ser usado em failures
 * cujo local pertence a um cliente na sua lista. Confirmado no sandbox
 * Infraspeak em 05/08/2026.
 */
import {
  filterProblemsByClient,
  filterProblemsForLocal,
  submitErrorMessage,
} from './CreateInfraspeakRequestModal';
import type { InfraspeakProblemOption } from '../services/infraspeak-api.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const GLOBAL_PROBLEM: InfraspeakProblemOption = {
  id: 28310,
  name: '01.01. Banheira',
  fullName: '01. Hidráulica / Esgoto - 01.01. Banheira',
  areaId: 28309,
  areaName: '01. Hidráulica / Esgoto',
  allClients: true,
  clientIds: [],
};

const RESTRICTED_PROBLEM_A: InfraspeakProblemOption = {
  id: 29000,
  name: 'Falha de Sistema',
  fullName: 'TI - Falha de Sistema',
  areaId: 28999,
  areaName: 'TI',
  allClients: false,
  clientIds: [75473],
};

const RESTRICTED_PROBLEM_B: InfraspeakProblemOption = {
  id: 29001,
  name: 'Outro restrito',
  fullName: 'TI - Outro restrito',
  areaId: 28999,
  areaName: 'TI',
  allClients: false,
  clientIds: [75472],
};

const ALL_PROBLEMS = [GLOBAL_PROBLEM, RESTRICTED_PROBLEM_A, RESTRICTED_PROBLEM_B];

// ── filterProblemsByClient ────────────────────────────────────────────────────

describe('filterProblemsByClient', () => {
  it('sem local (clientId=null) retorna lista completa', () => {
    const result = filterProblemsByClient(ALL_PROBLEMS, null);
    expect(result).toHaveLength(3);
    expect(result).toEqual(ALL_PROBLEMS);
  });

  it('com clientId 75473 retorna globais + restritos a 75473', () => {
    const result = filterProblemsByClient(ALL_PROBLEMS, 75473);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual([28310, 29000]);
  });

  it('com clientId 75472 retorna globais + restritos a 75472', () => {
    const result = filterProblemsByClient(ALL_PROBLEMS, 75472);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual([28310, 29001]);
  });

  it('clientId sem nenhum problema restrito correspondente retorna só os globais', () => {
    const result = filterProblemsByClient(ALL_PROBLEMS, 99999);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(28310);
  });

  it('lista vazia retorna vazia independente do clientId', () => {
    expect(filterProblemsByClient([], 75473)).toEqual([]);
    expect(filterProblemsByClient([], null)).toEqual([]);
  });

  it('problema com allClients=true e clientIds não-vazios ainda é incluído (allClients prevalece)', () => {
    const oddProblem: InfraspeakProblemOption = {
      ...GLOBAL_PROBLEM,
      id: 99,
      allClients: true,
      clientIds: [75473],
    };
    const result = filterProblemsByClient([oddProblem], 75472);
    expect(result).toHaveLength(1);
  });

  it('problema com allClients=false e clientIds=[] é excluído para qualquer clientId', () => {
    const restricted: InfraspeakProblemOption = {
      ...RESTRICTED_PROBLEM_A,
      id: 88,
      allClients: false,
      clientIds: [],
    };
    expect(filterProblemsByClient([restricted], 75473)).toHaveLength(0);
    expect(filterProblemsByClient([restricted], null)).toHaveLength(1); // sem filtro
  });
});

// ── filterProblemsForLocal (modo seguro para cliente indeterminado) ──────────

describe('filterProblemsForLocal', () => {
  it('sem local selecionado retorna lista completa', () => {
    expect(filterProblemsForLocal(ALL_PROBLEMS, false, null)).toEqual(ALL_PROBLEMS);
  });

  it('local selecionado com cliente resolvido filtra por clientId', () => {
    const result = filterProblemsForLocal(ALL_PROBLEMS, true, 75473);
    expect(result.map((p) => p.id)).toEqual([28310, 29000]);
  });

  it('local selecionado com cliente INDETERMINADO (null) mostra só os globais', () => {
    const result = filterProblemsForLocal(ALL_PROBLEMS, true, null);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(28310);
    expect(result.every((p) => p.allClients)).toBe(true);
  });

  it('cliente indeterminado + nenhum problema restrito = lista completa (nada escondido)', () => {
    const onlyGlobals = [GLOBAL_PROBLEM];
    expect(filterProblemsForLocal(onlyGlobals, true, null)).toEqual(onlyGlobals);
  });

  it('cliente resolvido sem match retorna só os globais', () => {
    const result = filterProblemsForLocal(ALL_PROBLEMS, true, 99999);
    expect(result.map((p) => p.id)).toEqual([28310]);
  });
});

// ── submitErrorMessage ────────────────────────────────────────────────────────

describe('submitErrorMessage', () => {
  it('detecta incompatibilidade problema × local (mensagem backend mapeada)', () => {
    const msg = submitErrorMessage(
      new Error('O tipo de problema selecionado não está disponível para o local escolhido.'),
    );
    expect(msg).toMatch(/tipo de problema/i);
    expect(msg).toMatch(/local escolhido/i);
    expect(msg).not.toMatch(/Infraspeak 400/);
  });

  it('detecta "O tipo de chamado deve existir" (mensagem raw da Infraspeak)', () => {
    const msg = submitErrorMessage(
      new Error('O tipo de chamado deve existir'),
    );
    expect(msg).toMatch(/tipo de problema/i);
  });

  it('detecta has_access_network (validation key da Infraspeak)', () => {
    const msg = submitErrorMessage(
      new Error('Infraspeak 400 (validação): validation.has_access_network'),
    );
    expect(msg).toMatch(/tipo de problema/i);
  });

  it('detecta rate limit', () => {
    const msg = submitErrorMessage(new Error('Infraspeak rate limit excedido'));
    expect(msg).toMatch(/rate limit/i);
  });

  it('detecta timeout', () => {
    const msg = submitErrorMessage(new Error('timeout após 15000ms'));
    expect(msg).toMatch(/Infraspeak demorou/i);
  });

  it('detecta erro de autenticação 401', () => {
    const msg = submitErrorMessage(new Error('Infraspeak 401: autenticação inválida'));
    expect(msg).toMatch(/token de acesso/i);
  });

  it('passa mensagens desconhecidas sem transformação', () => {
    const msg = submitErrorMessage(new Error('Algo inesperado aconteceu'));
    expect(msg).toBe('Algo inesperado aconteceu');
  });

  it('aceita string (não Error)', () => {
    const msg = submitErrorMessage('erro genérico');
    expect(msg).toBe('erro genérico');
  });
});

// ── Lógica de reset de problemId ao trocar de local ──────────────────────────
// Testa a lógica isolada da função handleLocalChange (sem React state).

describe('lógica de reset de problema ao trocar local', () => {
  /**
   * Simula a decisão de reset: dado o problemId atual e o novo clientId,
   * retorna true se o problema deve ser resetado.
   */
  function shouldResetProblem(
    currentProblemId: number | '',
    newClientId: number | null,
    allProblems: InfraspeakProblemOption[],
  ): boolean {
    if (currentProblemId === '') return false;
    const current = allProblems.find((p) => p.id === currentProblemId);
    if (!current) return false;
    // Espelha handleLocalChange: com cliente indeterminado, só globais valem
    // (modo seguro — problema restrito é resetado).
    return current.allClients
      ? false
      : !(newClientId !== null && current.clientIds.includes(newClientId));
  }

  it('não reseta quando problema é global (allClients=true)', () => {
    expect(shouldResetProblem(28310, 75472, ALL_PROBLEMS)).toBe(false);
    expect(shouldResetProblem(28310, 75473, ALL_PROBLEMS)).toBe(false);
  });

  it('reseta problema RESTRITO quando novo local tem clientId null (modo seguro)', () => {
    expect(shouldResetProblem(29000, null, ALL_PROBLEMS)).toBe(true);
  });

  it('não reseta problema global quando novo local tem clientId null', () => {
    expect(shouldResetProblem(28310, null, ALL_PROBLEMS)).toBe(false);
  });

  it('reseta quando problema restrito a 75473 e novo local é de 75472', () => {
    expect(shouldResetProblem(29000, 75472, ALL_PROBLEMS)).toBe(true);
  });

  it('não reseta quando problema restrito e novo local é do cliente correto', () => {
    expect(shouldResetProblem(29000, 75473, ALL_PROBLEMS)).toBe(false);
  });

  it('não reseta quando problemId ainda não foi selecionado', () => {
    expect(shouldResetProblem('', 75472, ALL_PROBLEMS)).toBe(false);
  });

  it('reseta quando problema restrito a 75472 e novo local é de 75473', () => {
    expect(shouldResetProblem(29001, 75473, ALL_PROBLEMS)).toBe(true);
  });
});
