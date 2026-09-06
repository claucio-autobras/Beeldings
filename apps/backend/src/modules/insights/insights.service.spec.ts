// Geração do insight: degradação para só-factual quando a IA falha (nunca dá
// erro), pulo de tenant sem dados no job agendado e evento de gancho para a
// entrega futura (contrato beeldings_insight: tema, resumo, período).

import { InsightsService, INSIGHT_GENERATED_CHANNEL } from './insights.service.js';
import type { InsightFacts } from './insight-facts.service.js';

const PERIOD = {
  from: new Date('2026-08-03T03:00:00Z'),
  to: new Date('2026-08-10T03:00:00Z'),
  label: 'Semana de 03/08/2026 a 09/08/2026',
};

function makeFacts(over: Partial<InsightFacts> = {}): InsightFacts {
  return {
    tenantId: 't1',
    tenantName: 'Cliente A',
    period: { from: PERIOD.from.toISOString(), to: PERIOD.to.toISOString(), label: PERIOD.label },
    hasData: true,
    alarms: {
      total: 5,
      bySeverity: { high: 2, medium: 2, low: 1 },
      acknowledged: 4,
      stillActive: 1,
      topRules: [],
      topDevices: [],
    },
    availability: {
      entityCount: 3,
      withDataCount: 3,
      avgUptimePct: 99.1,
      totalDrops: 2,
      totalOfflineMs: 60000,
      worst: [],
      longestOffline: null,
    },
    criticalAssets: { totalCritical: 1, inFaultDuringPeriod: [] },
    ...over,
  };
}

function makeDeps(facts: InsightFacts) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    tenantInsightConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1' }) },
    aiInsight: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({
          id: 'i1',
          ...data,
          narrative: data.narrative ?? null,
          theme: data.theme ?? null,
          summary: data.summary ?? null,
          createdAt: new Date('2026-08-10T03:05:00Z'),
        });
      }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const factsService = { compute: jest.fn().mockResolvedValue(facts) };
  const ai = { completeWithSystem: jest.fn() };
  const recipients = { resolveRecipients: jest.fn().mockResolvedValue([{ id: 'r1', name: 'Ana', email: 'a@b.c' }]) };
  const cluster = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new InsightsService(
    prisma as never,
    factsService as never,
    ai as never,
    recipients as never,
    cluster as never,
  );
  return { service, prisma, factsService, ai, recipients, cluster, created };
}

describe('InsightsService.generateForPeriod', () => {
  it('IA ok → salva narrativa e emite evento com tema/resumo/período', async () => {
    const { service, ai, cluster, recipients, created } = makeDeps(makeFacts());
    ai.completeWithSystem.mockResolvedValue(
      JSON.stringify({
        theme: 'Semana estável',
        summary: 'Operação dentro do esperado.',
        highlights: ['5 alarmes tratados'],
        recommendations: ['Manter rotina de inspeção'],
      }),
    );

    const result = await service.generateForPeriod('t1', PERIOD, 'WEEKLY', 'scheduled');

    expect(result?.aiFailed).toBe(false);
    expect(result?.theme).toBe('Semana estável');
    expect(created[0].aiFailed).toBe(false);
    expect(recipients.resolveRecipients).toHaveBeenCalledWith({ tenantId: 't1', category: 'insights' });
    expect(cluster.publish).toHaveBeenCalledTimes(1);
    const [channel, payloadRaw] = cluster.publish.mock.calls[0];
    expect(channel).toBe(INSIGHT_GENERATED_CHANNEL);
    const payload = JSON.parse(payloadRaw as string);
    expect(payload).toMatchObject({
      insightId: 'i1',
      tenantId: 't1',
      theme: 'Semana estável',
      summary: 'Operação dentro do esperado.',
      period: { start: PERIOD.from.toISOString(), end: PERIOD.to.toISOString(), label: PERIOD.label },
    });
    expect(payload.recipients).toHaveLength(1);
  });

  it('IA falha → insight salvo só-factual (aiFailed=true), sem lançar erro', async () => {
    const { service, ai, created, cluster } = makeDeps(makeFacts());
    ai.completeWithSystem.mockRejectedValue(new Error('API indisponível'));

    const result = await service.generateForPeriod('t1', PERIOD, 'WEEKLY', 'manual');

    expect(result?.aiFailed).toBe(true);
    expect(result?.summary).toBeNull();
    expect(result?.facts.alarms.total).toBe(5);
    expect(created[0].aiFailed).toBe(true);
    expect(created[0].theme).toBeNull();
    // Evento ainda é emitido, com resumo determinístico factual.
    const payload = JSON.parse(cluster.publish.mock.calls[0][1] as string);
    expect(payload.summary).toContain('5 alarmes');
  });

  it('IA responde sem JSON válido → trata como falha (só-factual)', async () => {
    const { service, ai, created } = makeDeps(makeFacts());
    ai.completeWithSystem.mockResolvedValue('Desculpe, não consegui gerar o resumo.');

    const result = await service.generateForPeriod('t1', PERIOD, 'WEEKLY', 'manual');

    expect(result?.aiFailed).toBe(true);
    expect(created[0].summary).toBeNull();
  });

  it('job agendado pula tenant sem dados no período (skipIfNoData)', async () => {
    const { service, ai, prisma, cluster } = makeDeps(makeFacts({ hasData: false }));

    const result = await service.generateForPeriod('t1', PERIOD, 'WEEKLY', 'scheduled', {
      skipIfNoData: true,
    });

    expect(result).toBeNull();
    expect(ai.completeWithSystem).not.toHaveBeenCalled();
    expect(prisma.aiInsight.create).not.toHaveBeenCalled();
    expect(cluster.publish).not.toHaveBeenCalled();
  });

  it('geração manual NÃO pula tenant sem dados', async () => {
    const { service, ai, prisma } = makeDeps(makeFacts({ hasData: false }));
    ai.completeWithSystem.mockResolvedValue(
      JSON.stringify({ theme: 'Período sem eventos', summary: 'Sem ocorrências relevantes.' }),
    );

    const result = await service.generateForPeriod('t1', PERIOD, 'WEEKLY', 'manual');

    expect(result).not.toBeNull();
    expect(prisma.aiInsight.create).toHaveBeenCalledTimes(1);
  });

  it('violação de unicidade no insert AGENDADO → idempotência (null, sem evento)', async () => {
    const { service, ai, cluster, prisma } = makeDeps(makeFacts());
    ai.completeWithSystem.mockResolvedValue(
      JSON.stringify({ theme: 'X', summary: 'Y', highlights: [], recommendations: [] }),
    );
    // Índice parcial ai_insights_scheduled_unique: outra instância venceu a corrida.
    prisma.aiInsight.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const result = await service.generateForPeriod('t1', PERIOD, 'WEEKLY', 'scheduled');

    expect(result).toBeNull();
    expect(cluster.publish).not.toHaveBeenCalled();
  });

  it('violação de unicidade na geração MANUAL propaga o erro (manual permite duplicata, logo é inesperado)', async () => {
    const { service, ai, prisma } = makeDeps(makeFacts());
    ai.completeWithSystem.mockResolvedValue(
      JSON.stringify({ theme: 'X', summary: 'Y', highlights: [], recommendations: [] }),
    );
    prisma.aiInsight.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(service.generateForPeriod('t1', PERIOD, 'WEEKLY', 'manual')).rejects.toThrow();
  });

  it('falha ao publicar o evento não derruba a geração', async () => {
    const { service, ai, cluster } = makeDeps(makeFacts());
    ai.completeWithSystem.mockResolvedValue(JSON.stringify({ theme: 'T', summary: 'S' }));
    cluster.publish.mockRejectedValue(new Error('bus off'));

    await expect(service.generateForPeriod('t1', PERIOD, 'WEEKLY', 'manual')).resolves.not.toBeNull();
  });
});

describe('InsightsService config', () => {
  it('sem linha no banco → padrão habilitado + semanal', async () => {
    const { service } = makeDeps(makeFacts());
    await expect(service.getConfig('t1')).resolves.toEqual({
      tenantId: 't1',
      enabled: true,
      frequency: 'WEEKLY',
    });
  });
});
