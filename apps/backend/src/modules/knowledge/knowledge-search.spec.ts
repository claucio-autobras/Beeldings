import { KnowledgeStatus, KnowledgeType } from '@prisma/client';
import { KnowledgeService } from './knowledge.service';

// Testes de regressão do filtro de segurança da busca semântica (RAG).
// A busca NUNCA pode retornar documentos que não sejam APPROVED + anonymized:
// é o que impede dados crus de um tenant vazarem para outro via Chat IA.
// Prisma é mockado; as asserções são sobre a SQL gerada ($queryRaw tagged
// template) e sobre os parâmetros interpolados (limit clampado, filtro de type).

type RawCall = { sql: string; values: unknown[] };

function buildService() {
  const calls: RawCall[] = [];
  const prisma = {
    // $queryRaw é chamado como tagged template: (strings, ...values).
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values });
      return [];
    }),
  };
  const embeddings = {
    embedOne: jest.fn(async () => [0.1, 0.2, 0.3]),
    toSqlVector: jest.fn((v: number[]) => `[${v.join(',')}]`),
  };
  const service = new KnowledgeService(prisma as never, embeddings as never);
  return { service, prisma, embeddings, calls };
}

describe('KnowledgeService.search — filtro de segurança (APPROVED + anonymized)', () => {
  it('a SQL sempre filtra status APPROVED e anonymized = true', async () => {
    const { service, calls } = buildService();
    await service.search('como calibrar o sensor?');

    expect(calls).toHaveLength(1);
    const sql = calls[0].sql;
    // Filtros obrigatórios — remover qualquer um deles é regressão de segurança.
    expect(sql).toMatch(/d\."status"\s*=\s*'APPROVED'/);
    expect(sql).toMatch(/d\."anonymized"\s*=\s*true/);
    // Ambos vivem na cláusula WHERE (não em ORDER BY/SELECT).
    const where = sql.slice(sql.indexOf('WHERE'), sql.indexOf('ORDER BY'));
    expect(where).toContain(`d."status" = 'APPROVED'`);
    expect(where).toContain('d."anonymized" = true');
    // Nunca aparece DRAFT como valor aceito.
    expect(sql).not.toContain('DRAFT');
  });

  it('o filtro de segurança não depende de opções (type/boost não o removem)', async () => {
    const { service, calls } = buildService();
    await service.search('playbook chiller', 5, {
      type: KnowledgeType.PLAYBOOK,
      boostModels: ['Modelo X'],
    });
    const sql = calls[0].sql;
    expect(sql).toMatch(/d\."status"\s*=\s*'APPROVED'/);
    expect(sql).toMatch(/d\."anonymized"\s*=\s*true/);
  });

  it('query vazia/só espaços não consulta o banco', async () => {
    const { service, prisma, embeddings } = buildService();
    expect(await service.search('')).toEqual([]);
    expect(await service.search('   \n ')).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(embeddings.embedOne).not.toHaveBeenCalled();
  });
});

describe('KnowledgeService.search — filtro opcional por type', () => {
  it('sem type: parâmetro null (filtro vira no-op na SQL)', async () => {
    const { service, calls } = buildService();
    await service.search('pergunta');
    const { sql, values } = calls[0];
    // A SQL usa o padrão (param IS NULL OR d."type" = param).
    expect(sql).toContain('IS NULL OR d."type"::text =');
    expect(values).toContain(null);
    expect(values).not.toContain('PLAYBOOK');
  });

  it('com type=PLAYBOOK: o valor é passado como parâmetro do filtro', async () => {
    const { service, calls } = buildService();
    await service.search('pergunta', 5, { type: KnowledgeType.PLAYBOOK });
    const { values } = calls[0];
    expect(values.filter((v) => v === 'PLAYBOOK')).toHaveLength(2); // aparece nos 2 lados do OR
  });
});

describe('KnowledgeService.search — clamp do limite k (1..20)', () => {
  async function limitFor(k?: number): Promise<number> {
    const { service, calls } = buildService();
    await (k === undefined ? service.search('q') : service.search('q', k));
    // LIMIT é o último parâmetro interpolado da query.
    return calls[0].values[calls[0].values.length - 1] as number;
  }

  it('default k=5', async () => {
    expect(await limitFor()).toBe(5);
  });
  it('k abaixo do mínimo vira 1', async () => {
    expect(await limitFor(0)).toBe(1);
    expect(await limitFor(-10)).toBe(1);
  });
  it('k acima do máximo vira 20', async () => {
    expect(await limitFor(21)).toBe(20);
    expect(await limitFor(1000)).toBe(20);
  });
  it('k dentro do intervalo é respeitado', async () => {
    expect(await limitFor(1)).toBe(1);
    expect(await limitFor(20)).toBe(20);
    expect(await limitFor(7)).toBe(7);
  });
});

// Regressão de segurança das sugestões de modelo do Chat IA: os nomes de modelo
// oferecidos à detecção vêm SÓ de documentos pesquisáveis (APPROVED + anonymized).
// Mudanças futuras no where do findMany não podem expor modelos de DRAFT/não
// anonimizados nas sugestões do chat.
describe('KnowledgeService.listSearchableModels — só documentos aprovados', () => {
  function buildModelsService(rows: Array<{ equipmentModel: string | null }>) {
    const findMany = jest.fn(async () => rows);
    const prisma = { knowledgeDoc: { findMany } };
    const service = new KnowledgeService(prisma as never, {} as never);
    return { service, findMany };
  }

  it('o where exige APPROVED + anonymized + equipmentModel não nulo, com distinct', async () => {
    const { service, findMany } = buildModelsService([]);
    await service.listSearchableModels();

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as Record<string, unknown>;
    expect(args.where).toEqual({
      status: KnowledgeStatus.APPROVED,
      anonymized: true,
      equipmentModel: { not: null },
    });
    expect(args.distinct).toEqual(['equipmentModel']);
    expect(args.select).toEqual({ equipmentModel: true });
  });

  it('filtra valores nulos, vazios e só-espaços do retorno', async () => {
    const { service } = buildModelsService([
      { equipmentModel: 'Chiller XPTO-500' },
      { equipmentModel: null },
      { equipmentModel: '' },
      { equipmentModel: '   \n\t ' },
      { equipmentModel: 'VRF Z-2000' },
    ]);
    expect(await service.listSearchableModels()).toEqual(['Chiller XPTO-500', 'VRF Z-2000']);
  });
});
