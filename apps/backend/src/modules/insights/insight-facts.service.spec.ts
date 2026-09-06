// Agregador factual do insight: escopo estrito do tenant, consolidação por
// severidade/regra/equipamento, ativos críticos em falha e tenant sem dados.

import { InsightFactsService, insightAlarmOverlapWhere } from './insight-facts.service.js';

type AnyFn = jest.Mock;

interface MockPrisma {
  tenant: { findUnique: AnyFn };
  alarmEvent: { findMany: AnyFn };
  device: { count: AnyFn };
  devicePoint: { count: AnyFn };
}

function makePrisma(): MockPrisma {
  return {
    tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'Cliente A' }) },
    alarmEvent: { findMany: jest.fn().mockResolvedValue([]) },
    device: { count: jest.fn().mockResolvedValue(0) },
    devicePoint: { count: jest.fn().mockResolvedValue(0) },
  };
}

const EMPTY_AVAILABILITY = {
  rows: [],
  summary: {
    entityCount: 0,
    withDataCount: 0,
    avgUptimePct: null,
    totalDrops: 0,
    totalOfflineMs: 0,
    worst: [],
  },
};

function makeAvailability(data: unknown = EMPTY_AVAILABILITY) {
  return { compute: jest.fn().mockResolvedValue(data) };
}

function makeEvent(over: Record<string, unknown> = {}) {
  return {
    state: 'NORMALIZED_ACK',
    acknowledgedAt: new Date('2026-08-05T12:00:00Z'),
    alarmRule: {
      name: 'Temperatura alta',
      severity: 'HIGH',
      point: {
        critical: false,
        device: { id: 'd1', name: 'Chiller 01', critical: false, site: { name: 'Sede' } },
      },
    },
    ...over,
  };
}

const FROM = new Date('2026-08-03T03:00:00Z');
const TO = new Date('2026-08-10T03:00:00Z');

describe('InsightFactsService', () => {
  it('escopa TODAS as consultas ao tenant informado', async () => {
    const prisma = makePrisma();
    const availability = makeAvailability();
    const service = new InsightFactsService(prisma as never, availability as never);

    await service.compute('t1', FROM, TO, 'Semana X');

    const alarmWhere = prisma.alarmEvent.findMany.mock.calls[0][0].where;
    expect(alarmWhere.tenantId).toBe('t1');
    expect(alarmWhere.kind).toBe('ALARM');
    // Dispositivos virtuais (Bancada) nunca contam como equipamento real.
    expect(alarmWhere.alarmRule.point.device).toEqual({ protocol: { not: 'virtual' } });
    // `to` do insight é EXCLUSIVO; a disponibilidade dos relatórios é inclusiva,
    // então o serviço converte para o último instante interno ao período.
    expect(availability.compute).toHaveBeenCalledWith({
      tenantId: 't1',
      from: FROM,
      to: new Date(TO.getTime() - 1),
    });
    expect(prisma.device.count.mock.calls[0][0].where.tenantId).toBe('t1');
    expect(prisma.devicePoint.count.mock.calls[0][0].where.device.tenantId).toBe('t1');
  });

  it('tenant sem alarmes nem cobertura de disponibilidade → hasData=false', async () => {
    const prisma = makePrisma();
    const service = new InsightFactsService(prisma as never, makeAvailability() as never);

    const facts = await service.compute('t1', FROM, TO, 'Semana X');

    expect(facts.hasData).toBe(false);
    expect(facts.alarms.total).toBe(0);
    expect(facts.availability.avgUptimePct).toBeNull();
    expect(facts.criticalAssets.inFaultDuringPeriod).toEqual([]);
  });

  it('consolida severidades, recorrências, equipamentos e ativos críticos', async () => {
    const prisma = makePrisma();
    prisma.alarmEvent.findMany.mockResolvedValue([
      makeEvent(),
      makeEvent({ state: 'ACTIVE', acknowledgedAt: null }),
      makeEvent({
        alarmRule: {
          name: 'Porta aberta',
          severity: 'MEDIUM',
          point: {
            critical: true,
            device: { id: 'd2', name: 'Controladora', critical: false, site: null },
          },
        },
      }),
    ]);
    prisma.device.count.mockResolvedValue(2);
    prisma.devicePoint.count.mockResolvedValue(1);
    const availability = makeAvailability({
      rows: [
        { name: 'Chiller 01', noData: false, longestOfflineMs: 120000 },
        { name: 'Câmera 02', noData: true, longestOfflineMs: 0 },
      ],
      summary: {
        entityCount: 2,
        withDataCount: 1,
        avgUptimePct: 97.531,
        totalDrops: 3,
        totalOfflineMs: 600000,
        worst: [{ id: 'x', name: 'Chiller 01', uptimePct: 97.531 }],
      },
    });
    const service = new InsightFactsService(prisma as never, availability as never);

    const facts = await service.compute('t1', FROM, TO, 'Semana X');

    expect(facts.hasData).toBe(true);
    expect(facts.alarms.total).toBe(3);
    expect(facts.alarms.bySeverity).toEqual({ high: 2, medium: 1, low: 0 });
    expect(facts.alarms.acknowledged).toBe(2);
    expect(facts.alarms.stillActive).toBe(1);
    expect(facts.alarms.topRules[0]).toEqual({
      name: 'Temperatura alta',
      deviceName: 'Chiller 01',
      severity: 'HIGH',
      count: 2,
    });
    expect(facts.alarms.topDevices[0]).toEqual({ deviceName: 'Chiller 01', siteName: 'Sede', count: 2 });
    // Ponto crítico em alarme → ativo crítico em falha.
    expect(facts.criticalAssets.totalCritical).toBe(3);
    expect(facts.criticalAssets.inFaultDuringPeriod).toEqual([
      { deviceName: 'Controladora', alarmCount: 1, maxSeverity: 'MEDIUM' },
    ]);
    expect(facts.availability.avgUptimePct).toBe(97.53);
    expect(facts.availability.longestOffline).toEqual({ name: 'Chiller 01', ms: 120000 });
  });

  it('inclui na seleção ocorrências abertas ANTES do período e ainda ativas (sobreposição)', async () => {
    const prisma = makePrisma();
    // Alarme crítico ativado 10 dias antes do período e ainda ACTIVE: não tem
    // atividade nova dentro do período, mas o sobrepõe inteiro — deve contar.
    prisma.alarmEvent.findMany.mockResolvedValue([
      makeEvent({
        state: 'ACTIVE',
        acknowledgedAt: null,
        activatedAt: new Date('2026-07-24T00:00:00Z'),
        normalizedAt: null,
        lastReactivatedAt: null,
        alarmRule: {
          name: 'Falha de comunicação',
          severity: 'HIGH',
          point: {
            critical: true,
            device: { id: 'd9', name: 'NVR Central', critical: false, site: null },
          },
        },
      }),
    ]);
    const service = new InsightFactsService(prisma as never, makeAvailability() as never);

    const facts = await service.compute('t1', FROM, TO, 'Semana X');

    expect(facts.alarms.total).toBe(1);
    expect(facts.alarms.stillActive).toBe(1);
    expect(facts.criticalAssets.inFaultDuringPeriod).toEqual([
      { deviceName: 'NVR Central', alarmCount: 1, maxSeverity: 'HIGH' },
    ]);
    expect(facts.hasData).toBe(true);
  });

  it('pagina por cursor e agrega TODOS os eventos (sem teto silencioso)', async () => {
    const prisma = makePrisma();
    // 1º lote cheio (1000) força a busca do 2º lote via cursor.
    const fullBatch = Array.from({ length: 1000 }, (_, i) =>
      makeEvent({ id: `e${i}`, state: 'NORMALIZED_ACK' }),
    );
    const tail = [
      makeEvent({ id: 'e1000', state: 'ACTIVE', acknowledgedAt: null }),
      makeEvent({ id: 'e1001' }),
    ];
    prisma.alarmEvent.findMany.mockResolvedValueOnce(fullBatch).mockResolvedValueOnce(tail);
    const service = new InsightFactsService(prisma as never, makeAvailability() as never);

    const facts = await service.compute('t1', FROM, TO, 'Semana X');

    expect(prisma.alarmEvent.findMany).toHaveBeenCalledTimes(2);
    const secondCall = prisma.alarmEvent.findMany.mock.calls[1][0];
    expect(secondCall.cursor).toEqual({ id: 'e999' });
    expect(secondCall.skip).toBe(1);
    // Ordem determinística por id em todas as chamadas.
    expect(prisma.alarmEvent.findMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' });
    expect(facts.alarms.total).toBe(1002);
    expect(facts.alarms.stillActive).toBe(1);
    expect(facts.alarms.bySeverity.high).toBe(1002);
  });

  it('propaga o rótulo e as fronteiras do período no payload', async () => {
    const prisma = makePrisma();
    const service = new InsightFactsService(prisma as never, makeAvailability() as never);
    const facts = await service.compute('t1', FROM, TO, 'Semana de 03/08/2026 a 09/08/2026');
    expect(facts.period).toEqual({
      from: FROM.toISOString(),
      to: TO.toISOString(),
      label: 'Semana de 03/08/2026 a 09/08/2026',
    });
  });
});

// ─── Semântica de sobreposição do where (avaliada de verdade) ─────────────────
// O motor REUSA a linha na reativação (limpa normalizedAt, grava
// lastReactivatedAt); estes cenários garantem que estado atual não vira prova
// de atividade histórica e que a fronteira `to` é exclusiva.

interface Occ {
  activatedAt: Date;
  normalizedAt: Date | null;
  lastReactivatedAt: Date | null;
  state: string;
}

/** Mini-avaliador do subset de Prisma where usado (AND/OR, gte/gt/lt/in/null). */
function matchesWhere(e: Occ, node: unknown): boolean {
  const n = node as Record<string, unknown>;
  for (const [key, cond] of Object.entries(n)) {
    if (key === 'AND') {
      if (!(cond as unknown[]).every((c) => matchesWhere(e, c))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!(cond as unknown[]).some((c) => matchesWhere(e, c))) return false;
      continue;
    }
    const value = e[key as keyof Occ];
    if (cond === null) {
      if (value !== null) return false;
      continue;
    }
    if (cond instanceof Date || typeof cond === 'string') {
      if (value !== cond) return false;
      continue;
    }
    const ops = cond as { gte?: Date; gt?: Date; lt?: Date; in?: string[] };
    if (ops.in !== undefined) {
      if (!ops.in.includes(value as string)) return false;
      continue;
    }
    // Comparações de data: null nunca satisfaz (semântica do Prisma).
    if (value == null || !(value instanceof Date)) return false;
    if (ops.gte && !(value.getTime() >= ops.gte.getTime())) return false;
    if (ops.gt && !(value.getTime() > ops.gt.getTime())) return false;
    if (ops.lt && !(value.getTime() < ops.lt.getTime())) return false;
  }
  return true;
}

describe('insightAlarmOverlapWhere — intervalos ativos vs período [from, to)', () => {
  const AUG = { from: new Date('2026-08-03T03:00:00Z'), to: new Date('2026-08-10T03:00:00Z') };
  const SEP = { from: new Date('2026-08-31T03:00:00Z'), to: new Date('2026-09-07T03:00:00Z') };
  const inPeriod = (e: Occ, p: { from: Date; to: Date }) =>
    matchesWhere(e, insightAlarmOverlapWhere(p.from, p.to));

  it('normalizada ANTES do período e reativada DEPOIS dele (ACTIVE hoje) → NÃO conta no período, conta no da reativação', () => {
    const e: Occ = {
      activatedAt: new Date('2026-07-01T00:00:00Z'),
      normalizedAt: null, // reativação limpou a normalização de 10/07
      lastReactivatedAt: new Date('2026-09-01T00:00:00Z'),
      state: 'ACTIVE',
    };
    expect(inPeriod(e, AUG)).toBe(false);
    expect(inPeriod(e, SEP)).toBe(true);
  });

  it('reativada depois do período e RENORMALIZADA depois também → não conta no período anterior', () => {
    const e: Occ = {
      activatedAt: new Date('2026-07-01T00:00:00Z'),
      normalizedAt: new Date('2026-09-05T00:00:00Z'),
      lastReactivatedAt: new Date('2026-09-01T00:00:00Z'),
      state: 'NORMALIZED_UNACK',
    };
    expect(inPeriod(e, AUG)).toBe(false);
    expect(inPeriod(e, SEP)).toBe(true);
  });

  it('ativa contínua desde antes do período (sem reativação) → conta', () => {
    const e: Occ = {
      activatedAt: new Date('2026-07-24T00:00:00Z'),
      normalizedAt: null,
      lastReactivatedAt: null,
      state: 'ACTIVE',
    };
    expect(inPeriod(e, AUG)).toBe(true);
  });

  it('intervalo único cruzando o início (normalizada dentro do período) → conta só nesse período', () => {
    const e: Occ = {
      activatedAt: new Date('2026-07-20T00:00:00Z'),
      normalizedAt: new Date('2026-08-05T00:00:00Z'),
      lastReactivatedAt: null,
      state: 'NORMALIZED_ACK',
    };
    expect(inPeriod(e, AUG)).toBe(true);
    expect(inPeriod(e, SEP)).toBe(false);
  });

  it('reativada DENTRO do período (ativação original antes) → conta', () => {
    const e: Occ = {
      activatedAt: new Date('2026-06-01T00:00:00Z'),
      normalizedAt: null,
      lastReactivatedAt: new Date('2026-08-05T00:00:00Z'),
      state: 'ACTIVE_ACK',
    };
    expect(inPeriod(e, AUG)).toBe(true);
  });

  it('fronteiras exclusivas: ativação exatamente em `to` fica no período seguinte; normalização exatamente em `from` fica no anterior', () => {
    const atTo: Occ = {
      activatedAt: AUG.to,
      normalizedAt: null,
      lastReactivatedAt: null,
      state: 'ACTIVE',
    };
    expect(inPeriod(atTo, AUG)).toBe(false);
    const normAtFrom: Occ = {
      activatedAt: new Date('2026-07-20T00:00:00Z'),
      normalizedAt: AUG.from, // intervalo terminou exatamente no início: [a, from) não sobrepõe [from, to)
      lastReactivatedAt: null,
      state: 'NORMALIZED_ACK',
    };
    expect(inPeriod(normAtFrom, AUG)).toBe(false);
  });
});
