import { CriticalAssetsService } from './critical-assets.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DeviceStatusService } from '../mqtt/device-status.service.js';

/**
 * Card Ativos Críticos — regra "todo estrelado aparece, com estado claro":
 * - ponto de status ligado (>=0.5) com device online → state 'running', com
 *   activeSince derivado da última transição off→on da trend;
 * - alarme ativo → state 'fault' (comportamento atual preservado);
 * - ponto com papel 'fault' com valor ativo → state 'fault' MESMO sem regra de
 *   alarme, com duração pela última transição off→on da trend (sem trend =
 *   faultMs null, nunca 0 fake);
 * - device offline → state 'no_response' (não some do card);
 * - ponto de status desligado → state 'stopped' (com stoppedSince quando há trend);
 * - sem ponto de status/sem valor → state 'unknown' (aparece como sem dados);
 * - ordenação: falha > sem resposta > ligado > desligado > sem dados.
 */
describe('CriticalAssetsService (papéis claros e itens sempre visíveis)', () => {
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

  const makePrisma = (devices: unknown[], alarms: unknown[] = [], points: unknown[] = []) =>
    ({
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      device: { findMany: jest.fn().mockResolvedValue(devices) },
      devicePoint: { findMany: jest.fn().mockResolvedValue(points) },
      alarmEvent: { findMany: jest.fn().mockResolvedValue(alarms) },
      scadaScreen: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      trendRecord: {
        // Emula os findFirst/findMany usados por computeRuntime/computeActiveSince/computeStoppedSince.
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

  const statusOffline = {
    getStatus: () => 'offline',
    resolveLastSeenMany: async () => new Map<string, string>(),
  } as unknown as DeviceStatusService;

  const window = { from: T(24 * 3600_000), to: new Date(NOW) };

  it('mostra item ligado (running) com activeSince da última transição off→on', async () => {
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
    expect(a.state).toBe('running');
    expect(a.activeNow).toBe(true);
    expect(a.activeSince).toBe(T(3 * 3600_000).toISOString());
    expect(a.activeMs).toBeGreaterThan(2.9 * 3600_000);
    expect(a.activeMs).toBeLessThan(3.1 * 3600_000);
  });

  it('todo estrelado aparece: desligado, sem dados e em alarme — ordenados por criticidade', async () => {
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
    // Falha primeiro, depois desligado, depois sem dados — ninguém some.
    expect(data.assets.map((a) => a.id)).toEqual(['devAl', 'off1', 'nodata']);
    expect(data.assets.map((a) => a.state)).toEqual(['fault', 'stopped', 'unknown']);
    expect(data.assets[0].status).toBe('fault');
    expect(data.assets[0].faultSource).toBe('alarm');
    // Desligado sem trend: sem duração fake.
    expect(data.assets[1].stoppedSince).toBeNull();
    expect(data.assets[1].stoppedMs).toBeNull();
  });

  it('desligado com trend mostra stoppedSince da última transição on→off', async () => {
    trendRecords = [
      { trendId: 'tr1', timestamp: T(10 * 3600_000), value: 1 },
      { trendId: 'tr1', timestamp: T(5 * 3600_000), value: 0 }, // desligou → stoppedSince
      { trendId: 'tr1', timestamp: T(2 * 3600_000), value: 0 },
    ];
    const prisma = makePrisma([
      device({ points: [{
        id: 'p1', tag: 'ST', objectName: 'Status', opRole: 'status',
        lastValue: 0, lastValueAt: T(60_000),
        trends: [{ id: 'tr1', enabled: true }],
      }] }),
    ]);
    const svc = new CriticalAssetsService(prisma, statusOnline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].state).toBe('stopped');
    expect(data.assets[0].stoppedSince).toBe(T(5 * 3600_000).toISOString());
    expect(data.assets[0].stoppedMs).toBeGreaterThan(4.9 * 3600_000);
    expect(data.assets[0].stoppedMs).toBeLessThan(5.1 * 3600_000);
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
    expect(data.assets[0].state).toBe('running');
    expect(data.assets[0].activeNow).toBe(true);
    expect(data.assets[0].activeSince).toBeNull();
    expect(data.assets[0].activeMs).toBeNull();
  });

  it('device offline aparece como no_response (não some), sem virar "ativo" por valor stale', async () => {
    trendRecords = [{ trendId: 'tr1', timestamp: T(3600_000), value: 1 }];
    const prisma = makePrisma([
      device({ points: [{
        id: 'p1', tag: 'ST', objectName: 'Status', opRole: 'status',
        lastValue: 1, lastValueAt: T(60_000),
        trends: [{ id: 'tr1', enabled: true }],
      }] }),
    ]);
    const svc = new CriticalAssetsService(prisma, statusOffline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].state).toBe('no_response');
    expect(data.assets[0].status).toBe('offline');
    expect(data.assets[0].activeNow).toBe(false);
  });

  it('ponto com papel fault ativo aparece em falha MESMO sem regra de alarme, com duração da trend', async () => {
    trendRecords = [
      { trendId: 'trF', timestamp: T(8 * 3600_000), value: 0 },
      { trendId: 'trF', timestamp: T(4 * 3600_000), value: 1 }, // entrou em falha → faultSince
    ];
    const points = [{
      id: 'pf1', tag: 'FALHA_B1', objectName: 'Falha Bomba 1', opRole: 'fault',
      critical: true, lastValue: 1, lastValueAt: T(60_000), deviceId: 'dev1',
      trends: [{ id: 'trF', enabled: true }],
      device: device({ points: [] }),
    }];
    const prisma = makePrisma([], [], points);
    const svc = new CriticalAssetsService(prisma, statusOnline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(1);
    const a = data.assets[0];
    expect(a.state).toBe('fault');
    expect(a.status).toBe('fault');
    expect(a.faultSource).toBe('fault_point');
    expect(a.pointRole).toBe('fault');
    expect(a.faultAlarmEventId).toBeNull();
    expect(a.faultRuleName).toBe('Falha Bomba 1');
    expect(a.faultSince).toBe(T(4 * 3600_000).toISOString());
    expect(a.faultMs).toBeGreaterThan(3.9 * 3600_000);
    expect(a.faultMs).toBeLessThan(4.1 * 3600_000);
  });

  it('ponto fault ativo sem trend: em falha com faultMs null (nunca 0 fake)', async () => {
    trendRecords = [];
    const points = [{
      id: 'pf1', tag: 'FALHA_B1', objectName: 'Falha Bomba 1', opRole: 'fault',
      critical: true, lastValue: 1, lastValueAt: T(60_000), deviceId: 'dev1',
      trends: [],
      device: device({ points: [] }),
    }];
    const prisma = makePrisma([], [], points);
    const svc = new CriticalAssetsService(prisma, statusOnline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].state).toBe('fault');
    expect(data.assets[0].faultSince).toBeNull();
    expect(data.assets[0].faultMs).toBeNull();
  });

  it('ponto fault com valor inativo não é falha (fica como sem dados)', async () => {
    trendRecords = [];
    const points = [{
      id: 'pf1', tag: 'FALHA_B1', objectName: 'Falha Bomba 1', opRole: 'fault',
      critical: true, lastValue: 0, lastValueAt: T(60_000), deviceId: 'dev1',
      trends: [],
      device: device({ points: [] }),
    }];
    const prisma = makePrisma([], [], points);
    const svc = new CriticalAssetsService(prisma, statusOnline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].state).toBe('unknown');
    expect(data.assets[0].faultSource).toBeNull();
  });

  it('device com ponto fault ativo (papel no ponto do device) entra em falha sem alarme', async () => {
    trendRecords = [];
    const prisma = makePrisma([
      device({ points: [{
        id: 'pf1', tag: 'FALHA', objectName: 'Falha Chiller', opRole: 'fault',
        lastValue: 1, lastValueAt: T(60_000), trends: [],
      }] }),
    ]);
    const svc = new CriticalAssetsService(prisma, statusOnline);
    const data = await svc.compute(window);
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].state).toBe('fault');
    expect(data.assets[0].faultSource).toBe('fault_point');
    expect(data.assets[0].faultRuleName).toBe('Falha Chiller');
  });
});
