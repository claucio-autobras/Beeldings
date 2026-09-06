import { SnmpDiagnoseService } from './snmp-diagnose.service.js';
import type { MqttService } from '../../mqtt/mqtt.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Progresso e resolução do diagnóstico SNMP entre instâncias.
 *
 * O progresso vive num Map em memória alimentado pelo MQTT — que chega em
 * TODAS as instâncias do backend. As regras testadas aqui:
 *  - progresso "unknown" (null) antes de qualquer registro;
 *  - progresso inicial disponível na instância que originou o POST;
 *  - progresso vindo do MQTT fica disponível mesmo SEM pendência local
 *    (instância que não originou o POST);
 *  - o resultado marca done=true em toda instância (com ou sem pendência)
 *    e resolve a pendência na instância de origem;
 *  - progresso atrasado não "revive" um diagnóstico concluído.
 */
describe('SnmpDiagnoseService (backend) — progresso e resultado', () => {
  let service: SnmpDiagnoseService;
  let publishedTopics: string[];
  let messageHandler: (topic: string, payload: Buffer) => void;

  const mqttMock = () =>
    ({
      subscribe: jest.fn(),
      onMessage: jest.fn((h: (t: string, p: Buffer) => void) => {
        messageHandler = h;
      }),
      publish: jest.fn((topic: string) => {
        publishedTopics.push(topic);
        return Promise.resolve();
      }),
    }) as unknown as MqttService;

  const emitProgress = (commandId: string, tested: number, total: number) =>
    messageHandler(
      'bluebee/t1/gateway/gw1/discovery/snmp-diagnose-progress',
      Buffer.from(
        JSON.stringify({ command_id: commandId, phase: 'oids', tested, total }),
      ),
    );

  const emitResult = (commandId: string, extra: Record<string, unknown> = {}) =>
    messageHandler(
      'bluebee/t1/gateway/gw1/discovery/snmp-diagnose-result',
      Buffer.from(
        JSON.stringify({
          command_id: commandId,
          success: true,
          reachable: true,
          oidResults: {},
          walk: [],
          durationMs: 10,
          ...extra,
        }),
      ),
    );

  const baseDto = {
    tenantId: 't1',
    gatewayId: 'gw1',
    ip: '10.0.0.5',
    port: 161,
    snmpVersion: '2c' as const,
    community: 'public',
    current: [],
    candidates: [],
  };

  /**
   * Store em memória simulando a tabela snmp_diagnose_job — permite testar
   * createJob/completeJobSuccess/completeJobError/getJobStatus/sweep contra
   * comportamento real (não só chamadas de mock), incluindo o filtro
   * status='pending' + createdAt do sweep de órfãos.
   */
  interface FakeJobRow {
    id: string;
    tenantId: string;
    deviceId: string;
    status: 'pending' | 'done' | 'error';
    result: unknown;
    error: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }

  const prismaMock = () => {
    const rows = new Map<string, FakeJobRow>();
    return {
      __rows: rows,
      snmpDiagnoseJob: {
        deleteMany: jest.fn(({ where }: { where: { deviceId: string; id: { not: string } } }) => {
          let count = 0;
          for (const [id, row] of rows) {
            if (row.deviceId === where.deviceId && id !== where.id.not) {
              rows.delete(id);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        }),
        upsert: jest.fn(
          ({
            where,
            create,
          }: {
            where: { id: string };
            create: { id: string; tenantId: string; deviceId: string; status: 'pending' };
          }) => {
            rows.set(where.id, {
              id: create.id,
              tenantId: create.tenantId,
              deviceId: create.deviceId,
              status: 'pending',
              result: null,
              error: null,
              createdAt: new Date(),
              completedAt: null,
            });
            return Promise.resolve(rows.get(where.id));
          },
        ),
        update: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<FakeJobRow>;
          }) => {
            const row = rows.get(where.id);
            if (!row) return Promise.reject(new Error('Record to update not found.'));
            Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: { status: 'pending'; createdAt: { lt: Date } };
            data: Partial<FakeJobRow>;
          }) => {
            let count = 0;
            for (const row of rows.values()) {
              if (row.status === where.status && row.createdAt < where.createdAt.lt) {
                Object.assign(row, data);
                count += 1;
              }
            }
            return Promise.resolve({ count });
          },
        ),
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(rows.get(where.id) ?? null),
        ),
      },
    } as unknown as PrismaService & { __rows: Map<string, FakeJobRow> };
  };

  beforeEach(() => {
    publishedTopics = [];
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    service = new SnmpDiagnoseService(mqttMock(), prismaMock());
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('progresso desconhecido retorna null', () => {
    expect(service.getProgress('nao-existe')).toBeNull();
  });

  it('registra progresso inicial (0/0) na instância que originou o POST', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-1' });
    expect(service.getProgress('diag-1')).toEqual({
      phase: 'oids',
      tested: 0,
      total: 0,
      done: false,
      tenantId: 't1',
    });
    emitResult('diag-1');
    await promise;
  });

  it('progresso via MQTT fica disponível mesmo sem pendência local (outra instância)', () => {
    // Nenhum diagnose() chamado nesta "instância": só a mensagem MQTT chega.
    emitProgress('diag-remoto', 3, 50);
    expect(service.getProgress('diag-remoto')).toEqual({
      phase: 'oids',
      tested: 3,
      total: 50,
      done: false,
      tenantId: 't1',
    });
  });

  it('resultado resolve a pendência da instância de origem e marca done', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-2' });
    emitProgress('diag-2', 10, 50);
    emitResult('diag-2');
    const result = await promise;
    expect(result.success).toBe(true);
    expect(service.getProgress('diag-2')).toMatchObject({ done: true });
  });

  it('resultado marca done mesmo em instância SEM pendência', () => {
    emitProgress('diag-3', 5, 50);
    emitResult('diag-3');
    expect(service.getProgress('diag-3')).toMatchObject({ done: true });
  });

  it('resultado sem progresso prévio ainda cria entrada done (instância sem histórico)', () => {
    emitResult('diag-4');
    expect(service.getProgress('diag-4')).toMatchObject({ done: true });
  });

  it('progresso atrasado não revive um diagnóstico concluído', () => {
    emitResult('diag-5');
    emitProgress('diag-5', 40, 50);
    expect(service.getProgress('diag-5')).toMatchObject({ done: true });
  });

  it('resultado alcançável tem cause=null', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-c1' });
    emitResult('diag-c1');
    const result = await promise;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.reachable).toBe(true);
      expect(result.cause).toBeNull();
    }
  });

  it('resultado inalcançável propaga cause=community do gateway', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-c2' });
    emitResult('diag-c2', { reachable: false, cause: 'community' });
    const result = await promise;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.reachable).toBe(false);
      expect(result.cause).toBe('community');
    }
  });

  it('resultado inalcançável sem cause explícita cai em no_response', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-c3' });
    emitResult('diag-c3', { reachable: false });
    const result = await promise;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.cause).toBe('no_response');
    }
  });

  it('resultado de falha (gateway ocupado) resolve com o erro do gateway', async () => {
    const promise = service.diagnose({ ...baseDto, diagnoseId: 'diag-6' });
    emitResult('diag-6', {
      success: false,
      busy: true,
      error: 'Já existe um diagnóstico SNMP em andamento neste gateway',
    });
    const result = await promise;
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('em andamento');
    }
  });
});

/**
 * Job durável (Postgres) — status via polling do frontend.
 *
 * Cobre o ciclo completo pedido na revisão: criação, consulta enquanto
 * pending, persistência de done/error, escopo por tenant, e a varredura de
 * jobs órfãos (instância que originou o POST caiu antes de concluir).
 */
describe('SnmpDiagnoseService (backend) — job durável e varredura de órfãos', () => {
  let service: SnmpDiagnoseService;

  const mqttMock = () =>
    ({
      subscribe: jest.fn(),
      onMessage: jest.fn(),
      publish: jest.fn(() => Promise.resolve()),
    }) as unknown as MqttService;

  interface FakeJobRow {
    id: string;
    tenantId: string;
    deviceId: string;
    status: 'pending' | 'done' | 'error';
    result: unknown;
    error: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }

  let rows: Map<string, FakeJobRow>;

  const prismaMock = () => {
    rows = new Map<string, FakeJobRow>();
    return {
      snmpDiagnoseJob: {
        deleteMany: jest.fn(({ where }: { where: { deviceId: string; id: { not: string } } }) => {
          for (const [id, row] of rows) {
            if (row.deviceId === where.deviceId && id !== where.id.not) rows.delete(id);
          }
          return Promise.resolve({ count: 0 });
        }),
        upsert: jest.fn(
          ({ where, create }: { where: { id: string }; create: FakeJobRow }) => {
            rows.set(where.id, {
              id: create.id,
              tenantId: create.tenantId,
              deviceId: create.deviceId,
              status: 'pending',
              result: null,
              error: null,
              createdAt: new Date(),
              completedAt: null,
            });
            return Promise.resolve(rows.get(where.id));
          },
        ),
        update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<FakeJobRow> }) => {
          const row = rows.get(where.id);
          if (!row) return Promise.reject(new Error('Record to update not found.'));
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: { status: 'pending'; createdAt: { lt: Date } };
            data: Partial<FakeJobRow>;
          }) => {
            let count = 0;
            for (const row of rows.values()) {
              if (row.status === where.status && row.createdAt < where.createdAt.lt) {
                Object.assign(row, data);
                count += 1;
              }
            }
            return Promise.resolve({ count });
          },
        ),
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(rows.get(where.id) ?? null),
        ),
      },
    } as unknown as PrismaService;
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    service = new SnmpDiagnoseService(mqttMock(), prismaMock());
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('job inexistente retorna unknown', async () => {
    expect(await service.getJobStatus('nao-existe', undefined)).toEqual({ status: 'unknown' });
  });

  it('createJob fica pending e getJobStatus reflete o progresso em memória', async () => {
    await service.createJob({ diagnoseId: 'job-1', tenantId: 't1', deviceId: 'dev-1' });
    const status = await service.getJobStatus('job-1', undefined);
    expect(status).toEqual({
      status: 'pending',
      progress: { phase: 'oids', tested: 0, total: 0, done: false },
    });
  });

  it('completeJobSuccess persiste o resultado e getJobStatus devolve done', async () => {
    await service.createJob({ diagnoseId: 'job-2', tenantId: 't1', deviceId: 'dev-2' });
    await service.completeJobSuccess('job-2', { reachable: true, oidResults: {} });
    expect(await service.getJobStatus('job-2', undefined)).toEqual({
      status: 'done',
      result: { reachable: true, oidResults: {} },
    });
  });

  it('completeJobError persiste a mensagem e getJobStatus devolve error', async () => {
    await service.createJob({ diagnoseId: 'job-3', tenantId: 't1', deviceId: 'dev-3' });
    await service.completeJobError('job-3', 'Gateway offline');
    expect(await service.getJobStatus('job-3', undefined)).toEqual({
      status: 'error',
      error: 'Gateway offline',
    });
  });

  it('getJobStatus nega acesso a job de outro tenant (retorna unknown)', async () => {
    await service.createJob({ diagnoseId: 'job-4', tenantId: 'tenant-dono', deviceId: 'dev-4' });
    expect(await service.getJobStatus('job-4', 'outro-tenant')).toEqual({ status: 'unknown' });
    expect(await service.getJobStatus('job-4', 'tenant-dono')).toMatchObject({ status: 'pending' });
  });

  it('createJob remove jobs antigos do mesmo equipamento', async () => {
    await service.createJob({ diagnoseId: 'job-old', tenantId: 't1', deviceId: 'dev-5' });
    await service.createJob({ diagnoseId: 'job-new', tenantId: 't1', deviceId: 'dev-5' });
    expect(await service.getJobStatus('job-old', undefined)).toEqual({ status: 'unknown' });
    expect(await service.getJobStatus('job-new', undefined)).toMatchObject({ status: 'pending' });
  });

  it('varredura de órfãos marca error um job pending além do timeout + margem, sem tocar jobs recentes', async () => {
    await service.createJob({ diagnoseId: 'job-orfao', tenantId: 't1', deviceId: 'dev-6' });
    // Simula que o job ficou 'pending' há mais tempo que DIAGNOSE_TIMEOUT_MS
    // + margem (a instância que o criou caiu antes de resolver via MQTT).
    rows.get('job-orfao')!.createdAt = new Date(Date.now() - 200_000);
    await service.createJob({ diagnoseId: 'job-recente', tenantId: 't1', deviceId: 'dev-7' });

    // Avança o relógio até a próxima varredura periódica rodar.
    await jest.advanceTimersByTimeAsync(20_000);

    expect(await service.getJobStatus('job-orfao', undefined)).toMatchObject({
      status: 'error',
    });
    expect(await service.getJobStatus('job-recente', undefined)).toMatchObject({
      status: 'pending',
    });
  });
});
