import { AiService } from './ai.service.js';

/**
 * Testa o contrato da "primeira ação sugerida":
 * - as regras de primeira ação (JSON estrito + proibição de ações destrutivas)
 *   são aplicadas SEMPRE, com e sem hits da base de conhecimento;
 * - o parse tolerante nunca quebra o render e degrada com confiança baixa.
 */

type AnyRecord = Record<string, unknown>;

const makeService = () => {
  const service = new AiService(
    {} as never,
    { search: jest.fn(async () => []) } as never,
    { record: jest.fn() } as never,
    { findSimilar: jest.fn(async () => []) } as never,
    { findAll: jest.fn(async () => []) } as never,
    { getStatus: jest.fn(() => 'online'), resolveLastSeenMany: jest.fn(async () => new Map()) } as never,
  );
  return service as unknown as {
    complete(
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      hits: AnyRecord[],
      rulesOverride?: string,
    ): Promise<string>;
    parseFirstAction(raw: string, hadContext: boolean): {
      steps: Array<{ text: string; source: string | null }>;
      confidence: 'high' | 'medium' | 'low';
      note: string | null;
      basedOnKnowledge: boolean;
    };
    getClient(): unknown;
  };
};

/** Captura o system prompt enviado ao provedor. */
const stubClient = (service: AnyRecord) => {
  const create = jest.fn(async (args: { system: string }) => ({
    content: [{ type: 'text', text: '{"steps":[{"text":"ok"}],"confidence":"low"}' }],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _system: args.system,
  }));
  (service as { getClient: () => unknown }).getClient = () =>
    ({ messages: { create } }) as never;
  return create;
};

const RULES = 'REGRAS-PRIMEIRA-ACAO: responda SOMENTE JSON; NUNCA sugira ações destrutivas.';

describe('AiService.complete com rulesOverride (primeira ação)', () => {
  it('aplica as regras de primeira ação quando HÁ hits da base', async () => {
    const service = makeService();
    const create = stubClient(service as unknown as AnyRecord);
    await service.complete([{ role: 'user', content: 'q' }], [
      { docId: 'd1', title: 'Manual X', type: 'MANUAL', source: 'x.pdf', content: 'trecho' },
    ] as never, RULES);
    const system = (create.mock.calls[0][0] as { system: string }).system;
    expect(system).toContain(RULES);
    expect(system).toContain('CONTEXTO DA BASE DE CONHECIMENTO');
  });

  it('aplica as MESMAS regras quando NÃO há hits (nunca cai nas regras genéricas)', async () => {
    const service = makeService();
    const create = stubClient(service as unknown as AnyRecord);
    await service.complete([{ role: 'user', content: 'q' }], [], RULES);
    const system = (create.mock.calls[0][0] as { system: string }).system;
    expect(system).toContain(RULES);
    expect(system).not.toContain('CONTEXTO DA BASE DE CONHECIMENTO');
  });
});

// ─── Elegibilidade de câmeras CFTV (criticidade no nível do equipamento) ─────

const CAMERA = {
  id: 'cam-1',
  name: 'Camera NIS',
  protocol: 'snmp',
  monitoredDeviceType: 'CAMERA',
  config: { manufacturer: 'Hikvision' },
  tenantId: 't1',
  points: [
    { id: 'p-status', tag: 'STATUS', objectName: 'STATUS', opRole: 'status', unit: null },
  ],
};

const STATUS_EVENT = {
  id: 'ev-1',
  state: 'ACTIVE',
  activatedAt: new Date('2026-07-30T10:00:00Z'),
  alarmRule: {
    id: 'r1',
    name: 'Câmera offline',
    message: 'STATUS = offline',
    severity: 'HIGH',
    pointId: 'p-status',
  },
};

const USER = { id: 'u1', name: 'Op', email: 'op@x', role: 'ADMIN' } as never;

const makeFirstActionService = (overrides?: {
  deviceFindFirst?: jest.Mock;
  eventFindFirst?: jest.Mock;
  eventFindMany?: jest.Mock;
}) => {
  const prisma = {
    device: {
      findFirst: overrides?.deviceFindFirst ?? jest.fn(async () => CAMERA),
    },
    alarmEvent: {
      findFirst: overrides?.eventFindFirst ?? jest.fn(async () => null),
      findMany:
        overrides?.eventFindMany ??
        // A mesma API atende à busca de alarmes ativos e à do histórico de
        // ACKs (where.acknowledgedAt presente). Sem override: sem histórico.
        jest.fn(async (args: { where: AnyRecord }) =>
          args?.where && 'acknowledgedAt' in args.where ? [] : [STATUS_EVENT],
        ),
      count: jest.fn(async () => 2),
    },
  };
  const findSimilar = jest.fn(async (..._args: unknown[]) => []);
  const service = new AiService(
    prisma as never,
    { search: jest.fn(async () => []) } as never,
    { record: jest.fn() } as never,
    { findSimilar } as never,
    { findAll: jest.fn(async () => []) } as never,
    { getStatus: jest.fn(() => 'online'), resolveLastSeenMany: jest.fn(async () => new Map()) } as never,
  );
  stubClient(service as unknown as AnyRecord);
  return { service, prisma, findSimilar };
};

describe('AiService.firstAction — câmeras CFTV', () => {
  it('câmera crítica no nível do equipamento (sem pointId) resolve o alarme dominante', async () => {
    const { service, prisma } = makeFirstActionService();
    const result = await service.firstAction(USER, 't1', { deviceId: 'cam-1' });

    // Lookup do device exclui SÓ virtuais (câmeras snmp/onvif seguem elegíveis).
    const where = (prisma.device.findFirst.mock.calls[0][0] as { where: AnyRecord }).where;
    expect(where.protocol).toEqual({ not: 'virtual' });
    expect(where.tenantId).toBe('t1');

    // Sem pointId: a busca de alarme ativo não restringe por ponto.
    const eventWhere = (prisma.alarmEvent.findMany.mock.calls[0][0] as {
      where: { alarmRule: { point: AnyRecord } };
    }).where;
    expect(eventWhere.alarmRule.point).toEqual({ deviceId: 'cam-1' });

    expect(result.context.alarm?.name).toBe('Câmera offline');
    expect(result.context.pointName).toBe('STATUS');
    expect(result.suggestion?.steps.length).toBeGreaterThan(0);
    expect(result.aiError).toBe(false);
  });

  it('câmera com alarmEventId do card usa o evento indicado', async () => {
    const eventFindFirst = jest.fn(async () => STATUS_EVENT);
    const { service, prisma } = makeFirstActionService({ eventFindFirst });
    const result = await service.firstAction(USER, 't1', {
      deviceId: 'cam-1',
      alarmEventId: 'ev-1',
    });
    expect(eventFindFirst).toHaveBeenCalled();
    // findMany só é usado para o histórico de ACKs (nunca para alarmes ativos).
    for (const call of prisma.alarmEvent.findMany.mock.calls) {
      expect((call[0] as { where: AnyRecord }).where).toHaveProperty('acknowledgedAt');
    }
    expect(result.context.alarm?.name).toBe('Câmera offline');
    expect(result.suggestion).not.toBeNull();
  });

  it('inclui o contexto CFTV (câmera, fabricante, STATUS/eventos) no prompt', async () => {
    const { service } = makeFirstActionService();
    const create = stubClient(service as unknown as AnyRecord);
    await service.firstAction(USER, 't1', { deviceId: 'cam-1' });
    const args = create.mock.calls[0][0] as unknown as { messages: Array<{ content: string }> };
    const prompt = args.messages[0].content;
    expect(prompt).toContain('câmera de CFTV');
    expect(prompt).toContain('Hikvision');
    expect(prompt).toContain('SNMP');
    expect(prompt).toMatch(/motion, tamper e video_loss/);
  });

  it('busca de casos semelhantes usa modo ESTRITO com o alvo do equipamento', async () => {
    const { service, findSimilar } = makeFirstActionService();
    await service.firstAction(USER, 't1', { deviceId: 'cam-1' });
    expect(findSimilar).toHaveBeenCalledTimes(1);
    const target = findSimilar.mock.calls[0][1] as AnyRecord;
    expect(target).toMatchObject({
      monitoredDeviceType: 'CAMERA',
      protocol: 'snmp',
      strict: true,
    });
  });

  it('sugestão por equipamento também usa modo ESTRITO com o alvo do equipamento', async () => {
    const { service, findSimilar } = makeFirstActionService();
    await service.suggestForDevice('t1', 'cam-1');
    expect(findSimilar).toHaveBeenCalledTimes(1);
    const target = findSimilar.mock.calls[0][1] as AnyRecord;
    expect(target).toMatchObject({
      monitoredDeviceType: 'CAMERA',
      protocol: 'snmp',
      strict: true,
    });
  });

  it('device virtual (Bancada) continua 404', async () => {
    // O Prisma filtraria o virtual pelo where → findFirst devolve null.
    const deviceFindFirst = jest.fn(async () => null);
    const { service } = makeFirstActionService({ deviceFindFirst });
    await expect(
      service.firstAction(USER, 't1', { deviceId: 'virt-1' }),
    ).rejects.toThrow('Equipamento não encontrado.');
  });
});

// ─── Histórico de motivos de reconhecimento (Task: IA usa motivos anteriores) ─

const ackedEvents = [
  {
    acknowledgedAt: new Date('2026-07-20T12:00:00Z'),
    ackNote: 'Equipamento estava realmente em falha; técnico chamado e problema resolvido.',
  },
  {
    acknowledgedAt: new Date('2026-07-10T09:00:00Z'),
    ackNote: '  Cabo de rede solto no switch PoE.  ',
  },
];

const ackAwareFindMany = (acked: unknown[]) =>
  jest.fn(async (args: { where: AnyRecord }) =>
    args?.where && 'acknowledgedAt' in args.where ? acked : [STATUS_EVENT],
  );

describe('AiService.firstAction — motivos de reconhecimentos anteriores', () => {
  it('inclui os motivos no prompt e no contexto (com trim e ordem)', async () => {
    const { service } = makeFirstActionService({ eventFindMany: ackAwareFindMany(ackedEvents) });
    const create = stubClient(service as unknown as AnyRecord);
    const result = await service.firstAction(USER, 't1', { deviceId: 'cam-1' });

    const prompt = (create.mock.calls[0][0] as unknown as { messages: Array<{ content: string }> })
      .messages[0].content;
    expect(prompt).toContain('Motivos de reconhecimentos anteriores');
    expect(prompt).toContain('técnico chamado e problema resolvido');
    expect(prompt).toContain('Cabo de rede solto no switch PoE.');
    expect(prompt).toContain('não são verdade absoluta');

    expect(result.context.ackHistory).toHaveLength(2);
    expect(result.context.ackHistory[1].note).toBe('Cabo de rede solto no switch PoE.');
  });

  it('trunca motivos longos', async () => {
    const long = 'x'.repeat(500);
    const { service } = makeFirstActionService({
      eventFindMany: ackAwareFindMany([{ acknowledgedAt: new Date('2026-07-01'), ackNote: long }]),
    });
    const result = await service.firstAction(USER, 't1', { deviceId: 'cam-1' });
    expect(result.context.ackHistory[0].note).toHaveLength(281); // 280 + '…'
    expect(result.context.ackHistory[0].note.endsWith('…')).toBe(true);
  });

  it('sem histórico: prompt e contexto seguem como hoje', async () => {
    const { service } = makeFirstActionService();
    const create = stubClient(service as unknown as AnyRecord);
    const result = await service.firstAction(USER, 't1', { deviceId: 'cam-1' });
    const prompt = (create.mock.calls[0][0] as unknown as { messages: Array<{ content: string }> })
      .messages[0].content;
    expect(prompt).not.toContain('Motivos de reconhecimentos anteriores');
    expect(result.context.ackHistory).toEqual([]);
    expect(result.suggestion).not.toBeNull();
  });

  it('falha da consulta ao histórico não derruba o endpoint', async () => {
    const { service } = makeFirstActionService({
      eventFindMany: jest.fn(async (args: { where: AnyRecord }) => {
        if (args?.where && 'acknowledgedAt' in args.where) throw new Error('db down');
        return [STATUS_EVENT];
      }),
    });
    const result = await service.firstAction(USER, 't1', { deviceId: 'cam-1' });
    expect(result.context.ackHistory).toEqual([]);
    expect(result.aiError).toBe(false);
    expect(result.suggestion).not.toBeNull();
  });

  it('falha da IA degrada para contexto factual COM o histórico (nunca 5xx)', async () => {
    const { service } = makeFirstActionService({ eventFindMany: ackAwareFindMany(ackedEvents) });
    (service as unknown as { getClient: () => unknown }).getClient = () => {
      throw new Error('IA fora');
    };
    const result = await service.firstAction(USER, 't1', { deviceId: 'cam-1' });
    expect(result.aiError).toBe(true);
    expect(result.suggestion).toBeNull();
    expect(result.context.ackHistory).toHaveLength(2);
  });
});

describe('AiService.parseFirstAction', () => {
  it('parseia JSON estrito com fonte e confiança', () => {
    const service = makeService();
    const s = service.parseFirstAction(
      '{"steps":[{"text":"Passo 1","source":"Manual X"},{"text":"Passo 2"}],"confidence":"high","note":"n"}',
      true,
    );
    expect(s.steps).toHaveLength(2);
    expect(s.steps[0].source).toBe('Manual X');
    expect(s.confidence).toBe('high');
    expect(s.basedOnKnowledge).toBe(true);
  });

  it('remove cerca markdown e limita a 3 passos', () => {
    const service = makeService();
    const s = service.parseFirstAction(
      '```json\n{"steps":[{"text":"a"},{"text":"b"},{"text":"c"},{"text":"d"}],"confidence":"medium"}\n```',
      true,
    );
    expect(s.steps).toHaveLength(3);
  });

  it('texto livre degrada para passo único com confiança baixa (nunca quebra)', () => {
    const service = makeService();
    const s = service.parseFirstAction('Verifique o disjuntor da bomba.', false);
    expect(s.steps).toHaveLength(1);
    expect(s.confidence).toBe('low');
    expect(s.basedOnKnowledge).toBe(false);
  });

  it('confiança inválida sem contexto vira low; com contexto vira medium', () => {
    const service = makeService();
    expect(service.parseFirstAction('{"steps":[{"text":"x"}],"confidence":"alta"}', false).confidence).toBe('low');
    expect(service.parseFirstAction('{"steps":[{"text":"x"}],"confidence":"alta"}', true).confidence).toBe('medium');
  });
});
