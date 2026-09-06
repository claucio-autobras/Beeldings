// ─── Testes do runtime do motor de alarmes ──────────────────────────────────────
// Cobre o ciclo completo da ocorrência com banco fake em memória:
//   ativa → normaliza → REATIVA antes do ACK (reusa a MESMA ocorrência),
//   ACK durante ativo → normaliza fecha (NORMALIZED_ACK),
//   nova ativação após ACK cria ocorrência nova,
//   reconciliação de duplicatas históricas no reload.

import { AlarmEngineService } from './alarm-engine.service.js';

interface FakeEvent {
  id: string;
  alarmRuleId: string | null;
  tenantId: string;
  kind: string;
  state: string;
  valueAtTrigger: number | null;
  activatedAt: Date;
  normalizedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  ackNote: string | null;
  reactivationCount: number;
  lastReactivatedAt: Date | null;
  createdAt: Date;
}

/** Aplica `data` de update do Prisma, resolvendo operadores como `{ increment }`. */
function applyUpdateData(e: any, data: any): void {
  for (const [k, v] of Object.entries<any>(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && typeof v.increment === 'number') {
      e[k] = (e[k] ?? 0) + v.increment;
    } else {
      e[k] = v;
    }
  }
}

/** Prisma fake em memória — implementa só o que o motor usa. */
class FakePrisma {
  events: FakeEvent[] = [];
  rules: any[] = [];
  private seq = 0;

  alarmRule = {
    findMany: async () => this.rules,
  };

  alarmEvent = {
    findMany: async ({ where }: any) =>
      this.events
        .filter((e) => where.state.in.includes(e.state) && e.kind === where.kind)
        .sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime()),
    findFirst: async ({ where }: any) =>
      this.events
        .filter(
          (e) =>
            e.alarmRuleId === where.alarmRuleId && e.kind === where.kind && e.state === where.state,
        )
        .sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime())[0] ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const e = this.events.find((x) => x.id === where.id);
      if (!e) throw new Error(`event ${where.id} not found`);
      return e;
    },
    create: async ({ data }: any) => {
      const e: FakeEvent = {
        id: `evt-${++this.seq}`,
        kind: 'ALARM',
        normalizedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        ackNote: null,
        reactivationCount: 0,
        lastReactivatedAt: null,
        createdAt: new Date(),
        ...data,
      };
      this.events.push(e);
      return e;
    },
    update: async ({ where, data }: any) => {
      const e = this.events.find((x) => x.id === where.id);
      if (!e) throw new Error(`event ${where.id} not found`);
      applyUpdateData(e, data);
      return e;
    },
    updateMany: async ({ where, data }: any) => {
      const matched = this.events.filter(
        (e) =>
          (where.id === undefined ||
            (typeof where.id === 'string' ? e.id === where.id : where.id.in.includes(e.id))) &&
          (where.kind === undefined || e.kind === where.kind) &&
          (where.state === undefined || e.state === where.state) &&
          (where.alarmRuleId === undefined ||
            (typeof where.alarmRuleId === 'string'
              ? e.alarmRuleId === where.alarmRuleId
              : where.alarmRuleId.in.includes(e.alarmRuleId))),
      );
      for (const e of matched) applyUpdateData(e, data);
      return { count: matched.length };
    },
  };
}

const RULE = {
  id: 'rule-1',
  tenantId: 'tenant-1',
  pointId: 'point-1',
  point: { deviceId: 'dev-1', tag: 'temp' },
  name: 'Temp alta',
  message: 'Temperatura acima do limite',
  type: 'VALUE_RANGE',
  severity: 'HIGH',
  enabled: true,
  activationState: null,
  condition: 'GT',
  limitValue: 50,
  limitLow: null,
  limitHigh: null,
  hysteresis: 0,
  delaySeconds: 0,
};

/** Aguarda a cadeia serial (promises encadeadas) do motor assentar. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

function makeEngine(prisma: FakePrisma) {
  const gateway = { emitAlarmEvent: jest.fn() };
  const engine = new AlarmEngineService(prisma as any, gateway as any);
  return { engine, gateway };
}

const sample = (value: number) => ({ deviceId: 'dev-1', points: [{ tag: 'temp', value }] });

describe('AlarmEngineService — reuso da ocorrência pendente de ACK', () => {
  it('ativa → normaliza → reativa antes do ACK: reusa a MESMA linha (volta a ACTIVE)', async () => {
    const prisma = new FakePrisma();
    prisma.rules = [RULE];
    const { engine, gateway } = makeEngine(prisma);
    await engine.reload();

    // Ativa
    engine.consume(sample(60));
    await flush();
    expect(prisma.events).toHaveLength(1);
    const evt = prisma.events[0];
    expect(evt.state).toBe('ACTIVE');
    expect(evt.valueAtTrigger).toBe(60);

    // Normaliza (aguarda ACK)
    engine.consume(sample(40));
    await flush();
    expect(prisma.events).toHaveLength(1);
    expect(evt.state).toBe('NORMALIZED_UNACK');
    expect(evt.normalizedAt).not.toBeNull();

    // Reativa ANTES do ACK → reusa a mesma ocorrência
    engine.consume(sample(70));
    await flush();
    expect(prisma.events).toHaveLength(1); // NÃO criou linha nova
    expect(evt.state).toBe('ACTIVE');
    expect(evt.normalizedAt).toBeNull(); // horário de normalização limpo
    expect(evt.valueAtTrigger).toBe(70); // valor do disparo atualizado
    expect(evt.reactivationCount).toBe(1); // registrou a oscilação
    expect(evt.lastReactivatedAt).not.toBeNull();

    // Emitiu no socket em cada transição (ativa, normaliza, reativa)
    expect(gateway.emitAlarmEvent).toHaveBeenCalledTimes(3);
    const last = gateway.emitAlarmEvent.mock.calls[2][0];
    expect(last.id).toBe(evt.id);
    expect(last.state).toBe('ACTIVE');
    expect(last.normalizedAt).toBeNull();

    // Oscila de novo: normaliza e reativa → contador vai a 2 (mesma linha)
    engine.consume(sample(40));
    engine.consume(sample(75));
    await flush();
    expect(prisma.events).toHaveLength(1);
    expect(evt.reactivationCount).toBe(2);
  });

  it('normaliza→reativa no MESMO ciclo (corrida): serializa e ainda reusa a linha', async () => {
    const prisma = new FakePrisma();
    prisma.rules = [RULE];
    const { engine } = makeEngine(prisma);
    await engine.reload();

    engine.consume(sample(60));
    await flush();
    const evt = prisma.events[0];

    // Normaliza e reativa sem aguardar entre os ciclos — a cadeia serial
    // garante que a reativação enxerga a normalização já persistida.
    engine.consume(sample(40));
    engine.consume(sample(70));
    await flush();

    expect(prisma.events).toHaveLength(1);
    expect(evt.state).toBe('ACTIVE');
    expect(evt.valueAtTrigger).toBe(70);
  });

  it('ACK durante ativo → normaliza fecha (NORMALIZED_ACK); nova ativação cria linha NOVA', async () => {
    const prisma = new FakePrisma();
    prisma.rules = [RULE];
    const { engine } = makeEngine(prisma);
    await engine.reload();

    engine.consume(sample(60));
    await flush();
    const first = prisma.events[0];

    // Operador reconhece a ocorrência ainda ativa (via API → syncAcknowledged)
    first.state = 'ACTIVE_ACK';
    engine.syncAcknowledged(first.id);

    // Normaliza → fecha reconhecida
    engine.consume(sample(40));
    await flush();
    expect(first.state).toBe('NORMALIZED_ACK');

    // Nova ativação DEPOIS do ACK → ocorrência nova (não reabre a fechada)
    engine.consume(sample(80));
    await flush();
    expect(prisma.events).toHaveLength(2);
    expect(prisma.events[1].state).toBe('ACTIVE');
    expect(first.state).toBe('NORMALIZED_ACK'); // intocada
  });

  it('ACK que chega entre a consulta e a reativação: não sobrescreve, cria linha nova', async () => {
    const prisma = new FakePrisma();
    prisma.rules = [RULE];
    const { engine } = makeEngine(prisma);
    await engine.reload();

    engine.consume(sample(60));
    await flush();
    const evt = prisma.events[0];
    engine.consume(sample(40));
    await flush();
    expect(evt.state).toBe('NORMALIZED_UNACK');

    // Simula ACK vencendo a corrida: o findFirst devolve a pendente, mas o
    // updateMany condicional (state ainda NORMALIZED_UNACK) não casa mais.
    const origFindFirst = prisma.alarmEvent.findFirst;
    prisma.alarmEvent.findFirst = async (args: any) => {
      const found = await origFindFirst(args);
      if (found) found.state = 'NORMALIZED_ACK'; // ACK "chegou" logo após a consulta
      return found;
    };

    engine.consume(sample(70));
    await flush();

    expect(evt.state).toBe('NORMALIZED_ACK'); // ACK preservado
    expect(prisma.events).toHaveLength(2); // criou ocorrência nova
    expect(prisma.events[1].state).toBe('ACTIVE');
  });
});

describe('AlarmEngineService — reconciliação de duplicatas no reload', () => {
  it('regra com ACTIVE + NORMALIZED_UNACK simultâneas: encerra a pendente como absorvida', async () => {
    const prisma = new FakePrisma();
    prisma.rules = [RULE];
    // Estado legado no banco: duas linhas da mesma regra
    prisma.events = [
      {
        id: 'old-pending',
        alarmRuleId: 'rule-1',
        tenantId: 'tenant-1',
        kind: 'ALARM',
        state: 'NORMALIZED_UNACK',
        valueAtTrigger: 55,
        activatedAt: new Date('2026-07-01T10:00:00Z'),
        normalizedAt: new Date('2026-07-01T11:00:00Z'),
        acknowledgedAt: null,
        acknowledgedBy: null,
        ackNote: null,
        createdAt: new Date('2026-07-01T10:00:00Z'),
      },
      {
        id: 'current-active',
        alarmRuleId: 'rule-1',
        tenantId: 'tenant-1',
        kind: 'ALARM',
        state: 'ACTIVE',
        valueAtTrigger: 62,
        activatedAt: new Date('2026-07-01T12:00:00Z'),
        normalizedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        ackNote: null,
        createdAt: new Date('2026-07-01T12:00:00Z'),
      },
    ];

    const { engine } = makeEngine(prisma);
    await engine.reload();

    const pending = prisma.events.find((e) => e.id === 'old-pending')!;
    const active = prisma.events.find((e) => e.id === 'current-active')!;
    expect(pending.state).toBe('NORMALIZED_ACK'); // absorvida/encerrada
    expect(pending.ackNote).toContain('reativação');
    expect(pending.acknowledgedAt).not.toBeNull();
    expect(active.state).toBe('ACTIVE'); // a linha ativa permanece

    // Runtime re-hidratado com a ocorrência ativa: normalizar funciona normalmente
    engine.consume(sample(40));
    await flush();
    expect(active.state).toBe('NORMALIZED_UNACK');
  });

  it('regra com DUAS ocorrências ACTIVE (corrida antiga): mantém a mais recente e absorve a outra', async () => {
    const prisma = new FakePrisma();
    prisma.rules = [RULE];
    prisma.events = [
      {
        id: 'older-active',
        alarmRuleId: 'rule-1',
        tenantId: 'tenant-1',
        kind: 'ALARM',
        state: 'ACTIVE',
        valueAtTrigger: 58,
        activatedAt: new Date('2026-07-01T11:59:00Z'),
        normalizedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        ackNote: null,
        createdAt: new Date('2026-07-01T11:59:00Z'),
      },
      {
        id: 'newer-active',
        alarmRuleId: 'rule-1',
        tenantId: 'tenant-1',
        kind: 'ALARM',
        state: 'ACTIVE',
        valueAtTrigger: 62,
        activatedAt: new Date('2026-07-01T12:00:00Z'),
        normalizedAt: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        ackNote: null,
        createdAt: new Date('2026-07-01T12:00:00Z'),
      },
    ];

    const { engine } = makeEngine(prisma);
    await engine.reload();

    const older = prisma.events.find((e) => e.id === 'older-active')!;
    const newer = prisma.events.find((e) => e.id === 'newer-active')!;
    expect(older.state).toBe('NORMALIZED_ACK'); // absorvida
    expect(older.normalizedAt).not.toBeNull();
    expect(older.ackNote).toContain('duplicada');
    expect(newer.state).toBe('ACTIVE'); // a mais recente permanece no runtime

    // O runtime aponta para a mais recente: normalizar fecha ELA
    engine.consume(sample(40));
    await flush();
    expect(newer.state).toBe('NORMALIZED_UNACK');
    expect(older.state).toBe('NORMALIZED_ACK'); // intocada
  });

  it('sem ocorrência aberta, pendentes de ACK NÃO são tocadas no reload', async () => {
    const prisma = new FakePrisma();
    prisma.rules = [RULE];
    prisma.events = [
      {
        id: 'only-pending',
        alarmRuleId: 'rule-1',
        tenantId: 'tenant-1',
        kind: 'ALARM',
        state: 'NORMALIZED_UNACK',
        valueAtTrigger: 55,
        activatedAt: new Date('2026-07-01T10:00:00Z'),
        normalizedAt: new Date('2026-07-01T11:00:00Z'),
        acknowledgedAt: null,
        acknowledgedBy: null,
        ackNote: null,
        createdAt: new Date('2026-07-01T10:00:00Z'),
      },
    ];

    const { engine } = makeEngine(prisma);
    await engine.reload();

    expect(prisma.events[0].state).toBe('NORMALIZED_UNACK'); // segue aguardando ACK

    // E uma reativação reusa exatamente essa pendente
    engine.consume(sample(70));
    await flush();
    expect(prisma.events).toHaveLength(1);
    expect(prisma.events[0].state).toBe('ACTIVE');
  });
});
