import { Prisma, TrendQuality } from '@prisma/client';
import {
  TrendRecorderService,
  FLUSH_INTERVAL_MS,
  MAX_BATCH_SIZE,
  MAX_PENDING_RECORDS,
  MAX_WRITE_ATTEMPTS,
  RETRY_BACKOFF_MS,
} from './trend-recorder.service.js';

// ─── Harness ─────────────────────────────────────────────────────────────────

interface PrismaMock {
  trend: { findMany: jest.Mock };
  trendRecord: { createMany: jest.Mock };
}

function makePrisma(trends: unknown[] = []): PrismaMock {
  return {
    trend: { findMany: jest.fn().mockResolvedValue(trends) },
    trendRecord: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
}

/** Uma trend ON_CHANGE (deadband 0 = grava qualquer mudança) num ponto fixo. */
const TREND_ON_CHANGE = {
  id: 'trend-1',
  tenantId: 'tenant-1',
  mode: 'ON_CHANGE',
  intervalSeconds: 60,
  covThreshold: 0,
  maxIntervalSeconds: 0,
  point: { deviceId: 'dev-1', tag: 'temp' },
};

async function makeService(trends: unknown[] = [TREND_ON_CHANGE]) {
  const prisma = makePrisma(trends);
  const service = new TrendRecorderService(prisma as never);
  await service.reload();
  return { prisma, service };
}

function record(i: number): Prisma.TrendRecordCreateManyInput {
  return {
    trendId: 'trend-1',
    tenantId: 'tenant-1',
    timestamp: new Date(1_700_000_000_000 + i * 1000),
    value: i,
    quality: TrendQuality.GOOD,
  };
}

/** Acesso ao enqueue privado — para testes de tamanho/teto sem montar N trends. */
function enqueue(service: TrendRecorderService, records: Prisma.TrendRecordCreateManyInput[]): void {
  (service as unknown as { enqueue(r: Prisma.TrendRecordCreateManyInput[]): void }).enqueue(records);
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─── Batching por janela ─────────────────────────────────────────────────────

describe('TrendRecorderService — batching por janela', () => {
  it('acumula várias mensagens e grava UM lote após a janela', async () => {
    const { prisma, service } = await makeService();

    // 3 mensagens MQTT distintas (valores diferentes → todas qualificam).
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 1 }] });
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 2 }] });
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 3 }] });

    // Nada gravado antes da janela.
    expect(prisma.trendRecord.createMany).not.toHaveBeenCalled();
    expect(service.getWriterStats().pending).toBe(3);

    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

    expect(prisma.trendRecord.createMany).toHaveBeenCalledTimes(1);
    const args = prisma.trendRecord.createMany.mock.calls[0][0] as { data: unknown[] };
    expect(args.data).toHaveLength(3);

    const stats = service.getWriterStats();
    expect(stats.batchesWritten).toBe(1);
    expect(stats.recordsWritten).toBe(3);
    expect(stats.pending).toBe(0);
    expect(stats.recordsDropped).toBe(0);
    expect(stats.lastFlushAt).not.toBeNull();
  });

  it('preserva o deadband: valor repetido em ON_CHANGE não enfileira', async () => {
    const { service } = await makeService();

    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 5 }] });
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 5 }] });

    expect(service.getWriterStats().pending).toBe(1);
  });

  it('ignora pontos sem trend configurada', async () => {
    const { service } = await makeService();
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'outra', value: 1 }] });
    service.consume({ deviceId: 'dev-2', points: [{ tag: 'temp', value: 1 }] });
    expect(service.getWriterStats().pending).toBe(0);
  });
});

// ─── Flush por tamanho ───────────────────────────────────────────────────────

describe('TrendRecorderService — flush por tamanho', () => {
  it('grava imediatamente ao atingir o tamanho máximo do lote', async () => {
    const { prisma, service } = await makeService();

    enqueue(service, Array.from({ length: MAX_BATCH_SIZE }, (_, i) => record(i)));
    // Sem avançar a janela — o flush por tamanho é imediato (microtask).
    await jest.advanceTimersByTimeAsync(0);

    expect(prisma.trendRecord.createMany).toHaveBeenCalledTimes(1);
    const args = prisma.trendRecord.createMany.mock.calls[0][0] as { data: unknown[] };
    expect(args.data).toHaveLength(MAX_BATCH_SIZE);
  });

  it('drena a fila em lotes sucessivos quando excede o tamanho máximo', async () => {
    const { prisma, service } = await makeService();

    enqueue(service, Array.from({ length: MAX_BATCH_SIZE + 500 }, (_, i) => record(i)));
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);

    expect(prisma.trendRecord.createMany).toHaveBeenCalledTimes(2);
    const first = prisma.trendRecord.createMany.mock.calls[0][0] as { data: unknown[] };
    const second = prisma.trendRecord.createMany.mock.calls[1][0] as { data: unknown[] };
    expect(first.data).toHaveLength(MAX_BATCH_SIZE);
    expect(second.data).toHaveLength(500);
    expect(service.getWriterStats().recordsWritten).toBe(MAX_BATCH_SIZE + 500);
  });
});

// ─── Teto de fila ────────────────────────────────────────────────────────────

describe('TrendRecorderService — teto de fila', () => {
  it('descarta os mais antigos contabilizando quando a fila atinge o teto', async () => {
    const { service } = await makeService();
    const errorSpy = jest
      .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    // Simula gravação em andamento travada (banco indisponível prolongado).
    (service as unknown as { flushing: boolean }).flushing = true;

    enqueue(service, Array.from({ length: MAX_PENDING_RECORDS }, (_, i) => record(i)));
    expect(service.getWriterStats().pending).toBe(MAX_PENDING_RECORDS);
    expect(service.getWriterStats().recordsDropped).toBe(0);

    enqueue(service, Array.from({ length: 500 }, (_, i) => record(MAX_PENDING_RECORDS + i)));

    const stats = service.getWriterStats();
    expect(stats.pending).toBe(MAX_PENDING_RECORDS);
    expect(stats.recordsDropped).toBe(500);
    expect(stats.lastError).toContain('teto');
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ─── Falha, retry e descarte contabilizado ───────────────────────────────────

describe('TrendRecorderService — falha e retry', () => {
  it('retenta com backoff e grava o MESMO lote após falha transitória', async () => {
    const { prisma, service } = await makeService();
    prisma.trendRecord.createMany
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ count: 3 });

    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 1 }] });
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 2 }] });
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 3 }] });

    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS); // janela → 1ª tentativa falha
    await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]); // backoff → 2ª tentativa OK

    expect(prisma.trendRecord.createMany).toHaveBeenCalledTimes(2);
    // Mesmo lote nas duas tentativas — nada se perde na falha transitória.
    const attempt1 = prisma.trendRecord.createMany.mock.calls[0][0] as { data: unknown[] };
    const attempt2 = prisma.trendRecord.createMany.mock.calls[1][0] as { data: unknown[] };
    expect(attempt2.data).toEqual(attempt1.data);

    const stats = service.getWriterStats();
    expect(stats.retries).toBe(1);
    expect(stats.batchesWritten).toBe(1);
    expect(stats.recordsWritten).toBe(3);
    expect(stats.recordsDropped).toBe(0);
  });

  it('após esgotar as tentativas, descarta contabilizando e loga em erro', async () => {
    const { prisma, service } = await makeService();
    prisma.trendRecord.createMany.mockRejectedValue(new Error('db down'));
    const errorSpy = jest
      .spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error')
      .mockImplementation(() => undefined);

    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 1 }] });
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 2 }] });

    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    for (const backoff of RETRY_BACKOFF_MS) {
      await jest.advanceTimersByTimeAsync(backoff);
    }
    await jest.advanceTimersByTimeAsync(0);

    expect(prisma.trendRecord.createMany).toHaveBeenCalledTimes(MAX_WRITE_ATTEMPTS);

    const stats = service.getWriterStats();
    expect(stats.retries).toBe(MAX_WRITE_ATTEMPTS - 1);
    expect(stats.batchesWritten).toBe(0);
    expect(stats.recordsWritten).toBe(0);
    expect(stats.recordsDropped).toBe(2);
    expect(stats.lastError).toBe('db down');
    expect(stats.lastErrorAt).not.toBeNull();

    // Log de erro com contexto: quantidade e faixa de tempo.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DESCARTADO'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('2 registro(s)'));
  });

  it('mensagens novas seguem acumulando durante o retry e saem no lote seguinte', async () => {
    const { prisma, service } = await makeService();
    prisma.trendRecord.createMany
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ count: 1 });

    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 1 }] });
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS); // 1ª tentativa falha

    // Chega telemetria nova enquanto o lote anterior aguarda o backoff.
    service.consume({ deviceId: 'dev-1', points: [{ tag: 'temp', value: 2 }] });

    await jest.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]); // retry do lote 1 OK
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS); // janela do lote 2

    expect(prisma.trendRecord.createMany).toHaveBeenCalledTimes(3);
    const stats = service.getWriterStats();
    expect(stats.recordsWritten).toBe(2);
    expect(stats.batchesWritten).toBe(2);
    expect(stats.recordsDropped).toBe(0);
    expect(stats.pending).toBe(0);
  });
});
