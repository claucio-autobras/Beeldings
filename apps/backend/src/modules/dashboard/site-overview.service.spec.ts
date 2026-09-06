import { SiteOverviewService } from './site-overview.service.js';

const from = new Date('2026-08-30T00:00:00.000Z');
const to = new Date('2026-08-31T00:00:00.000Z');

function point(overrides: Record<string, unknown>) {
  return {
    id: 'point',
    tag: 'TAG',
    objectName: 'Ponto',
    objectType: 'AI',
    unit: 'kWh',
    binding: {},
    siteMetric: 'energy',
    siteMetricMode: 'cumulative',
    device: {
      id: 'device',
      name: 'Equipamento',
      protocol: 'bacnet',
      tenantId: 'tenant-a',
      siteId: 'site-a',
      site: { id: 'site-a', name: 'Site A' },
    },
    trends: [{ id: 'trend' }],
    ...overrides,
  };
}

function makeService(points: unknown[], records: unknown[], previous: unknown[] = []) {
  const prisma = {
    devicePoint: { findMany: jest.fn().mockResolvedValue(points) },
    trendRecord: { findMany: jest.fn().mockResolvedValue(records) },
    $queryRaw: jest.fn().mockResolvedValue(previous),
  };
  return { service: new SiteOverviewService(prisma as never), prisma };
}

describe('SiteOverviewService', () => {
  it('soma somente deltas positivos e trata reset de medidor acumulativo', async () => {
    const records = [
      { trendId: 'trend', timestamp: new Date('2026-08-30T01:00:00Z'), value: 100 },
      { trendId: 'trend', timestamp: new Date('2026-08-30T02:00:00Z'), value: 110 },
      { trendId: 'trend', timestamp: new Date('2026-08-30T03:00:00Z'), value: 2 },
      { trendId: 'trend', timestamp: new Date('2026-08-30T04:00:00Z'), value: 5 },
      { trendId: 'trend', timestamp: new Date('2026-08-30T12:00:00Z'), value: 5 },
      { trendId: 'trend', timestamp: new Date('2026-08-30T22:00:00Z'), value: 5 },
    ];
    const { service } = makeService([point({})], records);
    const result = await service.compute({ tenantId: 'tenant-a', from, to, period: '24h' });
    expect(result.energy.status).toBe('ready');
    expect(result.energy.total).toBe(15);
  });

  it('distingue consumo zero com cobertura de ausência de dados', async () => {
    const records = [
      { trendId: 'trend', timestamp: new Date('2026-08-30T01:00:00Z'), value: 10 },
      { trendId: 'trend', timestamp: new Date('2026-08-30T02:00:00Z'), value: 10 },
      { trendId: 'trend', timestamp: new Date('2026-08-30T12:00:00Z'), value: 10 },
      { trendId: 'trend', timestamp: new Date('2026-08-30T22:00:00Z'), value: 10 },
    ];
    const { service } = makeService([point({})], records);
    const result = await service.compute({ tenantId: 'tenant-a', from, to, period: '24h' });
    expect(result.energy.status).toBe('ready');
    expect(result.energy.total).toBe(0);
  });

  it.each([
    ['24h', new Date('2026-08-30T00:00:00Z'), new Date('2026-08-31T00:00:00Z')],
    ['7d', new Date('2026-08-24T00:00:00Z'), new Date('2026-08-31T00:00:00Z')],
    ['30d', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z')],
  ] as const)('não publica acumulativo antigo como total de %s', async (period, windowFrom, windowTo) => {
    const records = [
      { trendId: 'trend', timestamp: new Date(windowFrom.getTime() + 30 * 60_000), value: 100 },
      { trendId: 'trend', timestamp: new Date(windowFrom.getTime() + 60 * 60_000), value: 105 },
    ];
    const { service } = makeService([point({})], records);
    const result = await service.compute({
      tenantId: 'tenant-a',
      from: windowFrom,
      to: windowTo,
      period,
    });
    expect(result.energy.status).toBe('no_data');
    expect(result.energy.total).toBeNull();
  });

  it('totaliza horas de um estado digital e mantém equipamento parado como zero real', async () => {
    const running = point({
      id: 'runtime-on',
      objectType: 'BI',
      unit: null,
      siteMetric: 'runtime',
      siteMetricMode: 'state',
      trends: [{ id: 'runtime-trend' }],
    });
    const stopped = point({
      id: 'runtime-off',
      objectType: 'BI',
      unit: null,
      siteMetric: 'runtime',
      siteMetricMode: 'state',
      trends: [{ id: 'stopped-trend' }],
    });
    const records = [
      { trendId: 'runtime-trend', timestamp: new Date('2026-08-30T02:00:00Z'), value: 0 },
      { trendId: 'runtime-trend', timestamp: new Date('2026-08-30T11:00:00Z'), value: 0 },
      { trendId: 'runtime-trend', timestamp: new Date('2026-08-30T21:00:00Z'), value: 0 },
      { trendId: 'stopped-trend', timestamp: new Date('2026-08-30T02:00:00Z'), value: 0 },
      { trendId: 'stopped-trend', timestamp: new Date('2026-08-30T11:00:00Z'), value: 0 },
      { trendId: 'stopped-trend', timestamp: new Date('2026-08-30T21:00:00Z'), value: 0 },
    ];
    const previous = [
      { trendId: 'runtime-trend', timestamp: new Date('2026-08-29T23:00:00Z'), value: 1 },
      { trendId: 'stopped-trend', timestamp: new Date('2026-08-29T23:00:00Z'), value: 0 },
    ];
    const { service } = makeService([running, stopped], records, previous);
    const result = await service.compute({ tenantId: 'tenant-a', from, to, period: '24h' });
    expect(result.runtime.status).toBe('ready');
    expect(result.runtime.totalHours).toBe(2);
    expect(result.runtime.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ pointId: 'runtime-on', runtimeHours: 2 }),
      expect.objectContaining({ pointId: 'runtime-off', runtimeHours: 0 }),
    ]));
  });

  it('aplica tenant e site na consulta de pontos, sem misturar clientes', async () => {
    const { service, prisma } = makeService([], []);
    const result = await service.compute({
      tenantId: 'tenant-a',
      siteId: 'site-a',
      from,
      to,
      period: '7d',
    });
    expect(prisma.devicePoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        device: expect.objectContaining({ tenantId: 'tenant-a', siteId: 'site-a' }),
      }),
    }));
    expect(result.energy.status).toBe('not_configured');
    expect(result.water.status).toBe('not_configured');
    expect(result.runtime.status).toBe('not_configured');
  });

  it('não transforma uma longa lacuna de comunicação em horas ligadas', async () => {
    const runtime = point({
      objectType: 'BI',
      unit: null,
      siteMetric: 'runtime',
      siteMetricMode: 'state',
      trends: [{ id: 'runtime-trend' }],
    });
    const records = [
      { trendId: 'runtime-trend', timestamp: new Date('2026-08-30T20:00:00Z'), value: 0 },
    ];
    const previous = [
      { trendId: 'runtime-trend', timestamp: new Date('2026-08-29T23:00:00Z'), value: 1 },
    ];
    const { service } = makeService([runtime], records, previous);
    const result = await service.compute({ tenantId: 'tenant-a', from, to, period: '24h' });
    expect(result.runtime.status).toBe('no_data');
    expect(result.runtime.totalHours).toBeNull();
  });

  it('não publica runtime de uma janela longa com cobertura mínima', async () => {
    const runtime = point({
      objectType: 'BI',
      unit: null,
      siteMetric: 'runtime',
      siteMetricMode: 'state',
      trends: [{ id: 'runtime-trend' }],
    });
    const records = [
      { trendId: 'runtime-trend', timestamp: new Date('2026-08-25T01:00:00Z'), value: 1 },
      { trendId: 'runtime-trend', timestamp: new Date('2026-08-25T02:00:00Z'), value: 0 },
    ];
    const { service } = makeService([runtime], records);
    const result = await service.compute({
      tenantId: 'tenant-a',
      from: new Date('2026-08-24T00:00:00Z'),
      to: new Date('2026-08-31T00:00:00Z'),
      period: '7d',
    });
    expect(result.runtime.status).toBe('no_data');
    expect(result.runtime.totalHours).toBeNull();
  });

  it('contabiliza rollups horários densos totalmente contidos na janela', async () => {
    const rate = point({
      siteMetricMode: 'rate',
      unit: 'kW',
      trends: [{ id: 'rate-trend', intervalSeconds: 900, maxIntervalSeconds: null }],
    });
    const prisma = {
      devicePoint: { findMany: jest.fn().mockResolvedValue([rate]) },
      trendRecord: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([
          ...Array.from({ length: 10 }, (_, hour) => ({
            trendId: 'rate-trend',
            timestamp: new Date(`2026-08-29T${String(hour + 13).padStart(2, '0')}:00:00Z`),
            value: 2,
            count: 4,
          })),
        ])
        .mockResolvedValueOnce([]),
    };
    const service = new SiteOverviewService(prisma as never);
    const result = await service.compute({
      tenantId: 'tenant-a',
      from: new Date('2026-08-29T12:00:00Z'),
      to: new Date('2026-08-30T00:00:00Z'),
      period: '30d',
    });
    expect(result.energy.total).toBe(20);
    expect(prisma.trendRecord.findMany).not.toHaveBeenCalled();
  });

  it('não extrapola um rollup esparso como cobertura contínua', async () => {
    const rate = point({
      siteMetricMode: 'rate',
      unit: 'kW',
      trends: [{ id: 'rate-trend', intervalSeconds: 900, maxIntervalSeconds: null }],
    });
    const prisma = {
      devicePoint: { findMany: jest.fn().mockResolvedValue([rate]) },
      trendRecord: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValueOnce([
        { trendId: 'rate-trend', timestamp: new Date('2026-08-29T00:00:00Z'), value: 2, count: 1 },
      ]),
    };
    const service = new SiteOverviewService(prisma as never);
    const result = await service.compute({
      tenantId: 'tenant-a',
      from: new Date('2026-08-29T00:00:00Z'),
      to: new Date('2026-08-30T00:00:00Z'),
      period: '30d',
    });
    expect(result.energy.status).toBe('no_data');
    expect(result.energy.total).toBeNull();
  });

  it('não publica como ready uma janela longa com pouca cobertura bruta', async () => {
    const rate = point({
      siteMetricMode: 'rate',
      unit: 'kW',
      trends: [{ id: 'rate-trend', intervalSeconds: null, maxIntervalSeconds: null }],
    });
    const records = [
      { trendId: 'rate-trend', timestamp: new Date('2026-08-25T01:00:00Z'), value: 2 },
      { trendId: 'rate-trend', timestamp: new Date('2026-08-25T02:00:00Z'), value: 2 },
    ];
    const { service } = makeService([rate], records);
    const result = await service.compute({
      tenantId: 'tenant-a',
      from: new Date('2026-08-24T00:00:00Z'),
      to: new Date('2026-08-31T00:00:00Z'),
      period: '7d',
    });
    expect(result.energy.status).toBe('no_data');
    expect(result.energy.total).toBeNull();
  });
});