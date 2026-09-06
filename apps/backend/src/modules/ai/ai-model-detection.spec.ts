import { AiService } from './ai.service.js';

/**
 * Testa a detecção de modelos de equipamento citados na pergunta (boost RAG).
 * A detecção é por palavra inteira e case-insensitive, e falha de forma segura.
 */
describe('AiService.detectMentionedModels', () => {
  const makeService = (models: string[] | Error) => {
    const knowledge = {
      listSearchableModels: jest.fn(async () => {
        if (models instanceof Error) throw models;
        return models;
      }),
    };
    const service = new AiService(
      {} as never,
      knowledge as never,
      { record: jest.fn() } as never,
      { findSimilar: jest.fn(async () => []) } as never,
      { findAll: jest.fn(async () => []) } as never,
      { getStatus: jest.fn(() => 'online'), resolveLastSeenMany: jest.fn(async () => new Map()) } as never,
    );
    return {
      detect: (q: string) =>
        (service as unknown as { detectMentionedModels(q: string): Promise<string[]> })
          .detectMentionedModels(q),
    };
  };

  it('detecta um modelo citado, sem diferenciar maiúsculas', async () => {
    const { detect } = makeService(['MCP17', 'MCP46', 'MCP14']);
    await expect(detect('qual a pinagem do mcp17?')).resolves.toEqual(['MCP17']);
  });

  it('detecta múltiplos modelos em pergunta comparativa', async () => {
    const { detect } = makeService(['MCP17', 'MCP46', 'MCP14']);
    await expect(detect('diferença entre MCP17 e MCP46')).resolves.toEqual(['MCP17', 'MCP46']);
  });

  it('não casa modelo como substring de outro token', async () => {
    const { detect } = makeService(['MCP1']);
    await expect(detect('configuração do MCP17')).resolves.toEqual([]);
  });

  it('suporta modelos com hífen/ponto (limite não-alfanumérico)', async () => {
    const { detect } = makeService(['XR-500', 'T2.5']);
    await expect(detect('manual do xr-500 e do T2.5, por favor')).resolves.toEqual([
      'XR-500',
      'T2.5',
    ]);
  });

  it('retorna vazio quando nenhum modelo é citado', async () => {
    const { detect } = makeService(['MCP17']);
    await expect(detect('como criar um alarme de temperatura?')).resolves.toEqual([]);
  });

  it('falha de forma segura se a listagem de modelos der erro', async () => {
    const { detect } = makeService(new Error('db offline'));
    await expect(detect('pinagem do MCP17')).resolves.toEqual([]);
  });
});
