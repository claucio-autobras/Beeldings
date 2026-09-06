import { KnowledgeClass, KnowledgeStatus, KnowledgeType, Prisma } from '@prisma/client';
import {
  composeCaseContent,
  extractSeedRecords,
  normalizeSeedCase,
  parseTags,
  type SeedCaseRecord,
} from './case-import.util';
import { KnowledgeService } from './knowledge.service';

// Testes do importador da seed de casos técnicos:
// 1) normalização/validação dos registros (funções puras);
// 2) IDEMPOTÊNCIA do importador — rodar de novo não duplica casos (dedupe por
//    case_id) e os casos entram já APPROVED + anonymized (pesquisáveis no RAG).

const record = (over: Partial<SeedCaseRecord> = {}): SeedCaseRecord => ({
  case_id: 'BB-BMS-0001',
  domain: 'BMS',
  subsystem: 'BACnet MS/TP',
  protocol: 'BACnet MS/TP',
  vendor_scope: 'Multi-vendor / Johnson Controls anchor',
  equipment: 'Controladora MS/TP',
  bluebee_question: 'Controlador MS/TP fica caindo, o que verificar?',
  symptom: 'Dispositivo MS/TP intermitente',
  possible_causes: 'Terminação incorreta; polaridade invertida',
  diagnostic_steps: '1. Verificar terminação; 2. Medir tensão',
  corrective_action: 'Corrigir terminação do barramento',
  bluebee_answer: 'Verifique a terminação do barramento...',
  severity: 'Média',
  knowledge_class: 'DOCUMENTED',
  evidence_strength: 'Alta',
  source_title: 'JCI MS/TP Communications Bus Technical Bulletin',
  source_url: 'https://example.com/mstp',
  tags: 'mstp, bacnet, terminação',
  ...over,
});

describe('normalizeSeedCase — validação e normalização', () => {
  it('normaliza um registro completo', () => {
    const n = normalizeSeedCase(record());
    expect(n).not.toBeNull();
    expect(n!.caseId).toBe('BB-BMS-0001');
    expect(n!.knowledgeClass).toBe(KnowledgeClass.DOCUMENTED);
    expect(n!.title).toBe('BB-BMS-0001 — Controlador MS/TP fica caindo, o que verificar?');
    expect(n!.caseSeverity).toBe('Média');
    expect(n!.protocol).toBe('BACnet MS/TP');
    expect(n!.vendorScope).toContain('Johnson Controls');
    expect(n!.source).toContain('JCI');
    expect(n!.sourceUrl).toBe('https://example.com/mstp');
    expect(n!.tags).toEqual(['mstp', 'bacnet', 'terminação']);
  });

  it('rejeita case_id ausente ou fora do formato BB-XXX-NNNN', () => {
    expect(normalizeSeedCase(record({ case_id: '' }))).toBeNull();
    expect(normalizeSeedCase(record({ case_id: 'CASO-1' }))).toBeNull();
    expect(normalizeSeedCase(record({ case_id: 'BB-BMS-' }))).toBeNull();
  });

  it('rejeita classe de conhecimento desconhecida (nunca cria caso sem classe)', () => {
    expect(normalizeSeedCase(record({ knowledge_class: undefined }))).toBeNull();
    expect(normalizeSeedCase(record({ knowledge_class: 'INVENTED' }))).toBeNull();
  });

  it('aceita classe em caixa mista e case_id minúsculo (normaliza)', () => {
    const n = normalizeSeedCase(record({ knowledge_class: 'derived', case_id: 'bb-bms-0002' }));
    expect(n!.knowledgeClass).toBe(KnowledgeClass.DERIVED);
    expect(n!.caseId).toBe('BB-BMS-0002');
  });

  it('o conteúdo composto contém as seções técnicas e a fonte', () => {
    const content = composeCaseContent(record());
    expect(content).toContain('Caso: BB-BMS-0001');
    expect(content).toContain('Sintoma: Dispositivo MS/TP intermitente');
    expect(content).toContain('Passos de diagnóstico:');
    expect(content).toContain('Fonte: JCI MS/TP Communications Bus Technical Bulletin');
    expect(content).toContain('URL da fonte: https://example.com/mstp');
    // Campos ausentes não geram linhas vazias.
    expect(content).not.toContain('Contexto:');
  });
});

describe('parseTags', () => {
  it('separa por vírgula, normaliza e deduplica', () => {
    expect(parseTags(' MSTP, bacnet , mstp,, terminação ')).toEqual([
      'mstp',
      'bacnet',
      'terminação',
    ]);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe('extractSeedRecords', () => {
  it('rejeita arquivo sem a lista records', () => {
    expect(() => extractSeedRecords({} as never)).toThrow(/records/);
  });
  it('filtra entradas sem case_id', () => {
    const out = extractSeedRecords({ records: [record(), { foo: 1 }, null] } as never);
    expect(out).toHaveLength(1);
  });
});

// ─── Idempotência do importador (Prisma mockado) ─────────────────────────────

function buildImportService(existingCaseIds: string[], seedRecords: SeedCaseRecord[]) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    knowledgeDoc: {
      findMany: jest.fn(async () => existingCaseIds.map((caseId) => ({ caseId }))),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `doc-${created.length}`, ...data };
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        knowledgeChunk: { deleteMany: jest.fn() },
        $executeRaw: jest.fn(),
      }),
    ),
  };
  const embeddings = {
    embed: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
    toSqlVector: jest.fn(() => '[0.1,0.2]'),
  };
  const service = new KnowledgeService(prisma as never, embeddings as never);
  // Lê a seed empacotada de um stub em memória, não do disco.
  jest
    .spyOn(service as never as { seedFilePath: () => string }, 'seedFilePath')
    .mockReturnValue('/tmp/unused.json');
  jest
    .spyOn(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('fs/promises'),
      'readFile',
    )
    .mockResolvedValue(JSON.stringify({ records: seedRecords }));
  return { service, prisma, created };
}

afterEach(() => jest.restoreAllMocks());

describe('KnowledgeService.importSeedCases — idempotência', () => {
  const seed = [record(), record({ case_id: 'BB-BMS-0002', knowledge_class: 'DERIVED' })];

  it('primeira execução importa tudo, já APPROVED + anonymized + type CASE', async () => {
    const { service, created } = buildImportService([], seed);
    const r = await service.importSeedCases('user-1');
    expect(r).toMatchObject({ total: 2, imported: 2, skippedExisting: 0, invalid: 0 });
    expect(created).toHaveLength(2);
    for (const doc of created) {
      expect(doc.type).toBe(KnowledgeType.CASE);
      expect(doc.status).toBe(KnowledgeStatus.APPROVED);
      expect(doc.anonymized).toBe(true);
    }
    expect(created.map((d) => d.caseId)).toEqual(['BB-BMS-0001', 'BB-BMS-0002']);
  });

  it('reexecução não duplica: casos existentes são pulados (dedupe por case_id)', async () => {
    const { service, created } = buildImportService(['BB-BMS-0001', 'BB-BMS-0002'], seed);
    const r = await service.importSeedCases('user-1');
    expect(r).toMatchObject({ imported: 0, skippedExisting: 2 });
    expect(created).toHaveLength(0);
  });

  it('execução parcial importa só o que falta', async () => {
    const { service, created } = buildImportService(['BB-BMS-0001'], seed);
    const r = await service.importSeedCases(null);
    expect(r).toMatchObject({ imported: 1, skippedExisting: 1 });
    expect(created.map((d) => d.caseId)).toEqual(['BB-BMS-0002']);
  });

  it('corrida (P2002 no insert) conta como existente em vez de estourar', async () => {
    const { service, prisma } = buildImportService([], [record()]);
    prisma.knowledgeDoc.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const r = await service.importSeedCases(null);
    expect(r).toMatchObject({ imported: 0, skippedExisting: 1 });
  });

  it('registros inválidos e case_id repetido no arquivo são contados como inválidos', async () => {
    const { service } = buildImportService(
      [],
      [record(), record(), record({ case_id: 'x' })],
    );
    const r = await service.importSeedCases(null);
    expect(r).toMatchObject({ total: 3, imported: 1, invalid: 2 });
  });
});
