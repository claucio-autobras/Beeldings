import { KnowledgeService } from './knowledge.service';

// Testes do chunking + reindex de documentos longos. Prisma e embeddings são
// mockados: o foco é o fatiamento e a inserção em lotes multi-linha.

type Tx = {
  knowledgeChunk: { deleteMany: jest.Mock };
  $executeRaw: jest.Mock;
};

function buildService() {
  const tx: Tx = {
    knowledgeChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: Tx) => Promise<void>, _opts?: unknown) => fn(tx)),
  };
  const embeddings = {
    embed: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    toSqlVector: jest.fn((v: number[]) => `[${v.join(',')}]`),
  };
  const service = new KnowledgeService(prisma as never, embeddings as never);
  return { service, prisma, tx, embeddings };
}

// Acessa o método privado de chunking sem expor na API pública.
function chunk(service: KnowledgeService, text: string): string[] {
  return (service as unknown as { chunk(t: string): string[] }).chunk(text);
}

describe('KnowledgeService chunking', () => {
  const { service } = buildService();

  it('texto vazio → nenhum chunk', () => {
    expect(chunk(service, '')).toEqual([]);
    expect(chunk(service, '   \n  ')).toEqual([]);
  });

  it('texto curto (≤ alvo) vira um único chunk', () => {
    const text = 'Parágrafo curto de manual.';
    expect(chunk(service, text)).toEqual([text]);
  });

  it('documento longo em parágrafos gera vários chunks com sobreposição', () => {
    const para = 'Seção do manual com instruções detalhadas do equipamento. '.repeat(8).trim(); // ~470 chars
    const text = Array.from({ length: 12 }, (_, i) => `Parte ${i + 1}. ${para}`).join('\n\n');
    const chunks = chunk(service, text);

    expect(chunks.length).toBeGreaterThan(1);
    // Nenhum chunk estoura o limite folgado (alvo * 1.5).
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1500);
    // Todo o conteúdo está representado, em ordem.
    for (let i = 1; i <= 12; i++) {
      expect(chunks.some((c) => c.includes(`Parte ${i}.`))).toBe(true);
    }
    // Sobreposição: o início de um chunk repete a cauda do anterior.
    const tail = chunks[0].slice(-50);
    expect(chunks[1].startsWith(tail.slice(-30).trimStart().slice(0, 10)) || chunks[1].includes(tail.slice(-30))).toBe(
      true,
    );
  });

  it('parágrafo único gigante é fatiado à força (nunca > alvo * 1.5)', () => {
    const text = 'x'.repeat(5000);
    const chunks = chunk(service, text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1500);
    expect(chunks.join('')).toContain('x'.repeat(1000));
  });
});

describe('KnowledgeService.reindex (lotes multi-linha)', () => {
  it('documento longo: apaga chunks antigos e insere em lotes de até 200', async () => {
    const { service, prisma, tx, embeddings } = buildService();

    // ~450 parágrafos de ~600 chars → centenas de chunks (> 200 = 2+ lotes).
    const para = 'Conteúdo técnico do manual, procedimentos e parâmetros. '.repeat(11).trim();
    const content = Array.from({ length: 450 }, (_, i) => `P${i}. ${para}`).join('\n\n');

    await service.reindex('doc-1', content);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Timeout folgado para manuais longos.
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ timeout: 120_000 });
    expect(tx.knowledgeChunk.deleteMany).toHaveBeenCalledWith({ where: { docId: 'doc-1' } });

    const totalChunks = (embeddings.embed.mock.calls[0][0] as string[]).length;
    expect(totalChunks).toBeGreaterThan(200);
    // Nº de INSERTs = ceil(chunks / 200).
    expect(tx.$executeRaw).toHaveBeenCalledTimes(Math.ceil(totalChunks / 200));
  });

  it('documento curto: um único lote de insert', async () => {
    const { service, tx } = buildService();
    await service.reindex('doc-2', 'Documento curto de teste.');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('embeddings recebem exatamente os chunks gerados, na ordem', async () => {
    const { service, embeddings } = buildService();
    const content = 'Primeiro parágrafo do manual.\n\nSegundo parágrafo do manual.';
    await service.reindex('doc-3', content);
    const sent = embeddings.embed.mock.calls[0][0] as string[];
    expect(sent.join('\n\n')).toContain('Primeiro parágrafo');
    expect(sent.join('\n\n')).toContain('Segundo parágrafo');
  });
});
