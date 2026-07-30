import { CriticalAssetsService } from './critical-assets.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DeviceStatusService } from '../mqtt/device-status.service.js';

/**
 * Card Ativos Críticos — regra "só ativos ou em alarme":
 * - item com ponto de status ligado (>=0.5) e device online → aparece como ativo,
 *   com activeSince derivado da última transição off→on da trend;
 * - item em alarme → aparece (comportamento atual preservado);
 * - estrelado parado (status desligado) ou sem dados → fica fora da lista;
 * - sem amostras de trend → activeMs null (nunca 0 fake), mas o item ativo aparece.
 */
describe('CriticalAssetsService (só ativos ou em alarme)', () => {
  const NOW = Date.now();
  const T = (msAgo: number) => new Date(NOW - msAgo);

  type Rec = { trendId: string; timestamp: Date; value: number };
  let trendRecords: Rec[] = [];

  const device = (over: Record<string, unknown>) => ({
    id: 'dev1',
    name: 'Chiller',
    protocol: 'bacnet',
    tenantId: 't1',
    siteId: 's1',
    site: { id: 's1', name: 'Site' },
    tenant: { id: 't1', name: 'Tenant' },
    points: [],
    ...over,
  });

  const makePrisma = (devices: unknown[], alarms: unknown[] = []) =>
    ({
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      device: { findMany: jest.fn().mockResolvedValue(devices) },
      devicePoint: { findMany: jest.fn().mockResolvedValue([]) },
      alarmEvent: { findMany: jest.fn().mockResolvedValue(alarms) },
      scadaScreen: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      trendRecord: {
        // Emula os findFirst/findMany usados por computeRuntime/computeActiveSince.
        findFirst: jest.fn(async (q: any) => {
          const where = q.where ?? {};
          let list = trendRecords.filter((r) => (where.trendId?.in ?? []).includes(r.trendId));
          if (where.value?.lt !== undefined) list = list.filter((r) => r.value < where.value.lt);
          if (where.value?.gte !== undefined) list = list.filter((r) => r.value >= where.value.gte);
          const ts = where.timestamp ?? {};
          if (ts.lt) list = list.filter((r) => r.timestamp < ts.lt);
          if (ts.lte) list = list.filter((r) => r.timestamp <= ts.lte);
          if (ts.gt) list = list.filter((r) => r.timestamp > ts.gt);
          list.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
          if (q.orderBy?.timestamp === 'desc') list.reverse();
          return list[0] ?? null;
        }),
        findMany: jest.fn(async (q: any) => {
          const where = q.where ?? {};
          let list = trendRecords.filter((r) => (where.trendId?.in ?? []).includes(r.trendId));
          const ts = where.timestamp ?? {};
          if (ts.gte) list = list.filter((r) => r.timestamp >= ts.gte);
          if (ts.lte) list = list.filter((r) => r.timestamp <= ts.lte);
          return list.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        }),
      },
    }) as unknown as PrismaService;

  const statusOnline = {
    getStatus: () => 'online',
    resolveLastSeenMany: async () => new Map<string, string>(),
  } as unknown as DeviceStatusService;

  const window = { from: T(24 * 3600_000), to: new Date(NOW) };

  it('mostra item ativo com activeSince da última transição off→on', async () => {
    trendRecords = [
      { trendId: 'tr1', timestamp: T(10 * 3600_000), value: 1 },
      { trendId: 'tr1', timestamp: T(6 * 3600_000), value: 0 }, // desligou
      { trendId: 'tr1', timestamp: T(3 * 3600_000), value: 1 }, // religou → activeSince
      { trendId: 'tr1', timestamp: T(1 * 3600_000), value: 1 },
    ];
    const prisma = makePrisma([
      device({
        points: [{
          id: 'p1', tag: 'ST', objectName: 'Status', opRole: 'status',
          lastValue: 1, lastValueAt: T(60_000),
          trends: [{ id: 'tr1', enabled: true }],
        }],
      }),
    ]);
    const svc = new CriticalAssetsService(prisma, statusOnline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(1);
    const a = data.assets[0];
    expect(a.activeNow).toBe(true);
    expect(a.activeSince).toBe(T(3 * 3600_000).toISOString());
    expect(a.activeMs).toBeGreaterThan(2.9 * 3600_000);
    expect(a.activeMs).toBeLessThan(3.1 * 3600_000);
  });

  it('exclui estrelado desligado e sem dados; mantém item em alarme', async () => {
    trendRecords = [];
    const prisma = makePrisma(
      [
        device({ id: 'off1', name: 'Bomba parada', points: [{
          id: 'p2', tag: 'ST', objectName: 'Status', opRole: 'status',
          lastValue: 0, lastValueAt: T(60_000), trends: [],
        }] }),
        device({ id: 'nodata', name: 'Sem ponto de status', points: [] }),
        device({ id: 'devAl', name: 'AHU em alarme', points: [] }),
      ],
      [{
        id: 'ev1', activatedAt: T(3600_000),
        alarmRule: { name: 'Falha', severity: 'HIGH', pointId: 'px', point: { deviceId: 'devAl' } },
      }],
    );
    const svc = new CriticalAssetsService(prisma, statusOnline);
    const data = await svc.compute(window);
    expect(data.assets.map((a) => a.id)).toEqual(['devAl']);
    expect(data.assets[0].status).toBe('fault');
  });

  it('ativo sem trend aparece com activeMs null (nunca 0 fake)', async () => {
    trendRecords = [];
    const prisma = makePrisma([
      device({ points: [{
        id: 'p1', tag: 'ST', objectName: 'Status', opRole: 'status',
        lastValue: 1, lastValueAt: T(60_000), trends: [],
      }] }),
    ]);
    const svc = new CriticalAssetsService(prisma, statusOnline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].activeNow).toBe(true);
    expect(data.assets[0].activeSince).toBeNull();
    expect(data.assets[0].activeMs).toBeNull();
  });

  it('device offline com último valor ligado (stale) não conta como ativo', async () => {
    trendRecords = [{ trendId: 'tr1', timestamp: T(3600_000), value: 1 }];
    const prisma = makePrisma([
      device({ points: [{
        id: 'p1', tag: 'ST', objectName: 'Status', opRole: 'status',
        lastValue: 1, lastValueAt: T(60_000),
        trends: [{ id: 'tr1', enabled: true }],
      }] }),
    ]);
    const statusOffline = {
      getStatus: () => 'offline',
      resolveLastSeenMany: async () => new Map<string, string>(),
    } as unknown as DeviceStatusService;
    const svc = new CriticalAssetsService(prisma, statusOffline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(0);
  });
});
