import { NotFoundException } from '@nestjs/common';
import { AiService } from './ai.service.js';
import type { ChatPollResult, ChatStartResult } from './ai.service.js';

/**
 * Regressão do turno assíncrono do chat da IA — garante que o polling
 * (getChatResult) SEMPRE termina, nunca fica "pensando" para sempre:
 * - startChat persiste a mensagem do usuário (âncora) e retorna imediatamente,
 *   mesmo quando a geração em segundo plano falha (runChatTurn nunca rejeita);
 * - falha na geração vira um turno de erro persistido (data.error=true) com
 *   mensagem amigável — é isso que encerra o polling com status 'error';
 * - getChatResult devolve pending/done/error corretamente a partir do banco;
 * - getChatResult nega acesso a conversa/mensagem de outro usuário (404).
 */

type AnyRecord = Record<string, unknown>;

const makePrisma = () => ({
  aiConversation: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(async () => ({})),
  },
  aiMessage: {
    findFirst: jest.fn(),
    findMany: jest.fn(async () => []),
    create: jest.fn(async (args: AnyRecord) => ({ id: 'msg-new', ...(args.data as AnyRecord) })),
  },
  $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
});

type PrismaMock = ReturnType<typeof makePrisma>;

const makeService = (prisma: PrismaMock) => {
  const service = new AiService(
    prisma as never,
    { search: jest.fn(async () => []) } as never,
    { record: jest.fn() } as never,
    { findSimilar: jest.fn(async () => []) } as never,
    { findAll: jest.fn(async () => []) } as never,
    { getStatus: jest.fn(() => 'online'), resolveLastSeenMany: jest.fn(async () => new Map()) } as never,
  );
  return service as unknown as {
    startChat(
      userId: string,
      tenantId: string | null,
      conversationId: string | null,
      content: string,
    ): Promise<ChatStartResult>;
    getChatResult(
      userId: string,
      conversationId: string,
      afterMessageId: string,
    ): Promise<ChatPollResult>;
    runChatTurn(
      tenantId: string | null,
      conversationId: string,
      content: string,
      options: { liveData?: boolean },
    ): Promise<void>;
    generateChatTurn(...args: unknown[]): Promise<AnyRecord>;
  };
};

// Silencia os logs de erro esperados dos cenários de falha.
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

// ─── runChatTurn: falha vira turno de erro persistido ────────────────────────

describe('AiService.runChatTurn', () => {
  it('persiste turno de erro (data.error=true) quando a geração falha — polling termina', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    (service as unknown as AnyRecord).generateChatTurn = jest.fn(async () => {
      throw new Error('provedor indisponível');
    });

    await expect(service.runChatTurn('t1', 'conv-1', 'pergunta', {})).resolves.toBeUndefined();

    expect(prisma.aiMessage.create).toHaveBeenCalledTimes(1);
    const created = prisma.aiMessage.create.mock.calls[0][0] as {
      data: { conversationId: string; role: string; content: string; data: AnyRecord };
    };
    expect(created.data.conversationId).toBe('conv-1');
    expect(created.data.role).toBe('assistant');
    expect(created.data.data.error).toBe(true);
    // Mensagem amigável, nunca vazia — é o que o operador vê no lugar do "pensando".
    expect(created.data.content.length).toBeGreaterThan(10);
  });

  it('nunca rejeita, mesmo quando persistir o turno de erro também falha', async () => {
    const prisma = makePrisma();
    prisma.aiMessage.create.mockRejectedValue(new Error('db down'));
    const service = makeService(prisma);
    (service as unknown as AnyRecord).generateChatTurn = jest.fn(async () => {
      throw new Error('provedor indisponível');
    });

    await expect(service.runChatTurn('t1', 'conv-1', 'pergunta', {})).resolves.toBeUndefined();
  });

  it('no sucesso persiste o turno do assistente com sources/similarCases (sem error)', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const sources = [{ docId: 'd1', title: 'Doc', type: 'MANUAL', source: null }];
    (service as unknown as AnyRecord).generateChatTurn = jest.fn(async () => ({
      reply: 'resposta',
      sources,
      similarCases: [],
    }));

    await service.runChatTurn('t1', 'conv-1', 'pergunta', {});

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const created = prisma.aiMessage.create.mock.calls[0][0] as {
      data: { role: string; content: string; data: AnyRecord };
    };
    expect(created.data.role).toBe('assistant');
    expect(created.data.content).toBe('resposta');
    expect(created.data.data.sources).toEqual(sources);
    expect(created.data.data.error).toBeUndefined();
  });
});

// ─── startChat: âncora durável + retorno imediato ────────────────────────────

describe('AiService.startChat', () => {
  it('persiste a mensagem do usuário e retorna pending mesmo com geração falhando', async () => {
    const prisma = makePrisma();
    prisma.aiConversation.create.mockResolvedValue({ id: 'conv-9', title: 'pergunta' });
    prisma.aiMessage.create.mockResolvedValue({ id: 'user-msg-1' });
    const service = makeService(prisma);
    (service as unknown as AnyRecord).generateChatTurn = jest.fn(async () => {
      throw new Error('boom');
    });

    const result: ChatStartResult = await service.startChat('u1', 't1', null, 'pergunta');

    expect(result.pending).toBe(true);
    expect(result.conversationId).toBe('conv-9');
    expect(result.userMessageId).toBe('user-msg-1');
    // Mensagem do usuário persistida ANTES do retorno (âncora do polling).
    expect(prisma.aiMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { conversationId: 'conv-9', role: 'user', content: 'pergunta' },
      }),
    );
  });

  it('404 quando a conversa informada não pertence ao usuário', async () => {
    const prisma = makePrisma();
    prisma.aiConversation.findFirst.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(service.startChat('u1', 't1', 'conv-de-outro', 'oi')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.aiMessage.create).not.toHaveBeenCalled();
  });
});

// ─── getChatResult: pending / done / error / acesso ──────────────────────────

describe('AiService.getChatResult', () => {
  const anchor = { createdAt: new Date('2026-08-14T10:00:00Z') };

  it("retorna 'pending' enquanto o turno do assistente não existe", async () => {
    const prisma = makePrisma();
    prisma.aiMessage.findFirst
      .mockResolvedValueOnce(anchor) // âncora (mensagem do usuário)
      .mockResolvedValueOnce(null); // ainda sem resposta
    const service = makeService(prisma);

    const result: ChatPollResult = await service.getChatResult('u1', 'conv-1', 'anchor-1');
    expect(result).toEqual({ status: 'pending' });
  });

  it("retorna 'done' com reply/sources/similarCases quando o turno existe", async () => {
    const prisma = makePrisma();
    const sources = [{ docId: 'd1', title: 'Doc', type: 'MANUAL', source: null }];
    prisma.aiMessage.findFirst
      .mockResolvedValueOnce(anchor)
      .mockResolvedValueOnce({ content: 'resposta', data: { sources } });
    const service = makeService(prisma);

    const result = await service.getChatResult('u1', 'conv-1', 'anchor-1');
    expect(result).toEqual({ status: 'done', reply: 'resposta', sources, similarCases: [] });
  });

  it("retorna 'error' com a mensagem persistida quando data.error=true", async () => {
    const prisma = makePrisma();
    prisma.aiMessage.findFirst
      .mockResolvedValueOnce(anchor)
      .mockResolvedValueOnce({ content: 'Não consegui gerar a resposta.', data: { error: true } });
    const service = makeService(prisma);

    const result = await service.getChatResult('u1', 'conv-1', 'anchor-1');
    expect(result).toEqual({ status: 'error', message: 'Não consegui gerar a resposta.' });
  });

  it('nega acesso (404) quando a conversa/mensagem é de outro usuário', async () => {
    const prisma = makePrisma();
    prisma.aiMessage.findFirst.mockResolvedValueOnce(null); // âncora não encontrada p/ este userId
    const service = makeService(prisma);

    await expect(service.getChatResult('outro-user', 'conv-1', 'anchor-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // O filtro da âncora inclui o dono da conversa — é o que garante o escopo.
    const where = (prisma.aiMessage.findFirst.mock.calls[0][0] as AnyRecord).where as AnyRecord;
    expect(where.conversation).toEqual({ userId: 'outro-user' });
  });
});
