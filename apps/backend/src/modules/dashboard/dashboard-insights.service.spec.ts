import { DashboardInsightsService, attentionScore } from './dashboard-insights.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DeviceStatusService } from '../mqtt/device-status.service.js';

/**
 * Agregados novos do dashboard:
 * - topOffenders SEMPRE consulta escopado ao tenant informado (cliente nunca
 *   vê regras de outro cliente) e ordena por contagem de ativações;
 * - tenantAttention ordena por score composto (críticos em falha pesam mais
 *   que alarmes comuns) e só lista clientes com score > 0;
 * - adminTrend agrega em buckets e propaga a exclusão de tenants inativos.
 */
describe('DashboardInsightsService', () => {
  const NOW = Date.now();
  const T = (msAgo: number) => new Date(NOW - msAgo);
  const window = { from: T(24 * 3600_000), to: new Date(NOW) };

  const statusOf = (onlineIds: Set<string>) =>
    ({
      getStatus: (id: string) => (onlineIds.has(id) ? 'online' : 'offline'),
    }) as unknown as DeviceStatusService;

  describe('attentionScore', () => {
    it('pesa críticos > gateways > alarmes > offline/ACK', () => {
      // 1 crítico em falha (5) supera 1 alarme comum (3) + 1 device offline (1).
      expect(attentionScore({ activeAlarms: 0, offlineDevices: 0, criticalFaults: 1, offlineGateways: 0, pendingAck: 0 }))
        .toBeGreaterThan(attentionScore({ activeAlarms: 1, offlineDevices: 1, criticalFaults: 0, offlineGateways: 0, pendingAck: 0 }));
      expect(attentionScore({ activeAlarms: 2, offlineDevices: 3, criticalFaults: 1, offlineGateways: 1, pendingAck: 4 }))
        .toBe(2 * 3 + 3 + 5 + 4 + 4);
    });
  });

  describe('topOffenders', () => {
    it('escopa por tenant, ordena por ativações e devolve deep-link', async () => {
      const seenWheres: any[] = [];
      const prisma = {
        alarmEvent: {
          groupBy: jest.fn(async (q: any) => {
            seenWheres.push(q.where);
            return [
              { alarmRuleId: 'r1', _count: { _all: 7 } },
              { alarmRuleId: 'r2', _count: { _all: 3 } },
            ];
          }),
          findFirst: jest.fn(async (q: any) => {
            seenWheres.push(q.where);
            return { id: `ev-${q.where.alarmRuleId}`, activatedAt: T(3600_000) };
          }),
        },
        alarmRule: {
          findMany: jest.fn(async () => [
            {
              id: 'r1', name: 'Temp alta', severity: 'HIGH',
              point: { tag: 'TEMP', objectName: 'Temperatura', device: { id: 'd1', name: 'Chiller', site: { name: 'Sede' } } },
            },
            {
              id: 'r2', name: 'Porta aberta', severity: 'LOW',
              point: { tag: 'DOOR', objectName: null, device: { id: 'd2', name: 'Rack', site: null } },
            },
          ]),
        },
      } as unknown as PrismaService;

      const svc = new DashboardInsightsService(prisma, statusOf(new Set()));
      const out = await svc.topOffenders({ tenantId: 't1', ...window });

      // TODA query de eventos leva o tenant do cliente (nunca escopo global).
      expect(seenWheres.length).toBeGreaterThan(0);
      for (const w of seenWheres) expect(w.tenantId).toBe('t1');

      expect(out.map((o) => o.ruleId)).toEqual(['r1', 'r2']);
      expect(out[0]).toMatchObject({
        ruleName: 'Temp alta', count: 7, deviceName: 'Chiller',
        pointName: 'Temperatura', siteName: 'Sede', lastEventId: 'ev-r1',
      });
      expect(out[1].pointName).toBe('DOOR'); // fallback tag sem objectName
      expect(out[1].siteName).toBeNull();
    });

    it('aplica o filtro de site quando informado', async () => {
      const prisma = {
        alarmEvent: { groupBy: jest.fn(async () => []), findFirst: jest.fn() },
        alarmRule: { findMany: jest.fn(async () => []) },
      } as unknown as PrismaService;
      const svc = new DashboardInsightsService(prisma, statusOf(new Set()));
      await svc.topOffenders({ tenantId: 't1', siteId: 's1', ...window });
      const where = (prisma.alarmEvent.groupBy as jest.Mock).mock.calls[0][0].where;
      expect(where.alarmRule.point.device.siteId).toBe('s1');
    });
  });

  describe('tenantAttention', () => {
    it('ordena por score composto e omite clientes sem anomalias', async () => {
      const prisma = {
        tenant: {
          findMany: jest.fn(async () => [
            { id: 'tA', name: 'A' },
            { id: 'tB', name: 'B' },
            { id: 'tC', name: 'C (limpo)' },
          ]),
        },
        alarmEvent: {
          groupBy: jest.fn(async (q: any) =>
            q.where.state === 'NORMALIZED_UNACK'
              ? [{ tenantId: 'tA', _count: { _all: 2 } }]
              // tA: 4 alarmes ativos comuns; tB: 1 alarme ativo.
              : [
                  { tenantId: 'tA', _count: { _all: 4 } },
                  { tenantId: 'tB', _count: { _all: 1 } },
                ],
          ),
          // 3 alarmes ativos em ativos críticos do tB.
          findMany: jest.fn(async () => [
            { tenantId: 'tB' }, { tenantId: 'tB' }, { tenantId: 'tB' },
          ]),
        },
        device: {
          findMany: jest.fn(async () => [
            { id: 'devA', tenantId: 'tA' },
            { id: 'devB', tenantId: 'tB' },
          ]),
        },
        gateway: { findMany: jest.fn(async () => [{ id: 'gwB', tenantId: 'tB' }]) },
      } as unknown as PrismaService;

      // Só devA online: devB offline (tB) e gwB offline (tB).
      const svc = new DashboardInsightsService(prisma, statusOf(new Set(['devA'])));
      const out = await svc.tenantAttention();

      // tB: 1*3 + 1 offline + 3*5 + 1 gateway*4 = 23 > tA: 4*3 + 2 ACK = 14.
      expect(out.map((t) => t.tenantId)).toEqual(['tB', 'tA']);
      expect(out[0]).toMatchObject({ criticalFaults: 3, offlineGateways: 1, offlineDevices: 1, activeAlarms: 1, score: 23 });
      expect(out[1]).toMatchObject({ activeAlarms: 4, pendingAck: 2, score: 14 });
      // Cliente sem anomalias fica fora do ranking.
      expect(out.find((t) => t.tenantId === 'tC')).toBeUndefined();
    });
  });

  describe('adminTrend', () => {
    it('agrega em buckets e exclui tenants inativos', async () => {
      const from = new Date('2026-08-09T00:00:00Z');
      const to = new Date('2026-08-10T00:00:00Z');
      const prisma = {
        alarmEvent: {
          findMany: jest.fn(async () => [
            { activatedAt: new Date('2026-08-09T00:30:00Z') },
            { activatedAt: new Date('2026-08-09T00:45:00Z') },
            { activatedAt: new Date('2026-08-09T23:59:00Z') },
          ]),
        },
        statusEvent: {
          findMany: jest.fn(async () => [
            {
              entityType: 'gateway',
              entityId: 'gw1',
              tenantId: 'tA',
              at: new Date('2026-08-09T05:10:00Z'),
            },
          ]),
        },
        device: { findMany: jest.fn(async () => []) },
        tenant: { findMany: jest.fn(async () => [{ id: 'tA', name: 'Tenant A' }]) },
      } as unknown as PrismaService;

      const svc = new DashboardInsightsService(prisma, statusOf(new Set()));
      const trend = await svc.adminTrend({ from, to, period: '24h', excludeTenantIds: ['dead'] });

      expect(trend.bucketMs).toBe(3600_000);
      expect(trend.buckets).toHaveLength(24);
      expect(trend.buckets[0].activated).toBe(2);
      expect(trend.buckets[5].offlineTransitions).toBe(1);
      expect(trend.buckets[23].activated).toBe(1);

      // Identidade por trás da queda: gateway sem Device próprio cai em
      // 'devices' e resolve o nome do tenant a partir do lote de tenants.
      expect(trend.buckets[5].offlineBreakdown).toEqual([
        {
          tenantId: 'tA',
          tenantName: 'Tenant A',
          siteName: null,
          entityType: 'gateway',
          entityId: 'gw1',
          entityName: 'Gateway gw1',
          category: 'devices',
          count: 1,
        },
      ]);
      // Buckets sem queda continuam com a quebra vazia (nunca undefined).
      expect(trend.buckets[0].offlineBreakdown).toEqual([]);

      const alarmWhere = (prisma.alarmEvent.findMany as jest.Mock).mock.calls[0][0].where;
      const statusWhere = (prisma.statusEvent.findMany as jest.Mock).mock.calls[0][0].where;
      expect(alarmWhere.tenantId).toEqual({ notIn: ['dead'] });
      expect(alarmWhere.kind).toBe('ALARM');
      expect(statusWhere.tenantId).toEqual({ notIn: ['dead'] });
      expect(statusWhere.status).toBe('offline');
      // Sem device envolvido (só gateway) -> não busca devices no Prisma.
      expect(prisma.device.findMany).not.toHaveBeenCalled();
      expect(prisma.tenant.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['tA'] } },
        select: { id: true, name: true },
      });
    });

    it('usa buckets diários fora de 24h', async () => {
      const from = new Date('2026-08-03T00:00:00Z');
      const to = new Date('2026-08-10T00:00:00Z');
      const prisma = {
        alarmEvent: { findMany: jest.fn(async () => []) },
        statusEvent: { findMany: jest.fn(async () => []) },
        device: { findMany: jest.fn(async () => []) },
        tenant: { findMany: jest.fn(async () => []) },
      } as unknown as PrismaService;
      const svc = new DashboardInsightsService(prisma, statusOf(new Set()));
      const trend = await svc.adminTrend({ from, to, period: '7d', excludeTenantIds: [] });
      expect(trend.bucketMs).toBe(24 * 3600_000);
      expect(trend.buckets).toHaveLength(7);
      // Sem nenhum evento offline, nenhuma consulta de identidade é disparada.
      expect(prisma.device.findMany).not.toHaveBeenCalled();
      expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    });

    it('classifica câmera/switch/NVR em cftv e controladora de acesso em sca', async () => {
      const from = new Date('2026-08-09T00:00:00Z');
      const to = new Date('2026-08-10T00:00:00Z');
      const prisma = {
        alarmEvent: { findMany: jest.fn(async () => []) },
        statusEvent: {
          findMany: jest.fn(async () => [
            { entityType: 'camera', entityId: 'cam1', tenantId: 'tA', at: new Date('2026-08-09T05:10:00Z') },
            { entityType: 'device', entityId: 'sca1', tenantId: 'tA', at: new Date('2026-08-09T05:15:00Z') },
            { entityType: 'device', entityId: 'bms1', tenantId: 'tA', at: new Date('2026-08-09T05:20:00Z') },
          ]),
        },
        device: {
          findMany: jest.fn(async () => [
            { id: 'cam1', name: 'Camera 1', monitoredDeviceType: null, site: { name: 'Site A' } },
            { id: 'sca1', name: 'Catraca 1', monitoredDeviceType: 'ACCESS_CONTROLLER', site: { name: 'Site A' } },
            { id: 'bms1', name: 'Chiller 1', monitoredDeviceType: 'HVAC', site: { name: 'Site A' } },
          ]),
        },
        tenant: { findMany: jest.fn(async () => [{ id: 'tA', name: 'Tenant A' }]) },
      } as unknown as PrismaService;

      const svc = new DashboardInsightsService(prisma, statusOf(new Set()));
      const trend = await svc.adminTrend({ from, to, period: '24h', excludeTenantIds: [] });

      const byEntity = new Map(trend.buckets[5].offlineBreakdown.map((e) => [e.entityId, e]));
      expect(byEntity.get('cam1')).toMatchObject({ category: 'cftv', entityName: 'Camera 1' });
      expect(byEntity.get('sca1')).toMatchObject({ category: 'sca', entityName: 'Catraca 1' });
      expect(byEntity.get('bms1')).toMatchObject({ category: 'devices', entityName: 'Chiller 1' });

      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['cam1', 'sca1', 'bms1'] } },
        select: { id: true, name: true, monitoredDeviceType: true, site: { select: { name: true } } },
      });
    });

    it('agrega flapping da mesma entidade no mesmo bucket em um único item', async () => {
      const from = new Date('2026-08-09T00:00:00Z');
      const to = new Date('2026-08-10T00:00:00Z');
      const prisma = {
        alarmEvent: { findMany: jest.fn(async () => []) },
        statusEvent: {
          findMany: jest.fn(async () => [
            { entityType: 'gateway', entityId: 'gw1', tenantId: 'tA', at: new Date('2026-08-09T05:01:00Z') },
            { entityType: 'gateway', entityId: 'gw1', tenantId: 'tA', at: new Date('2026-08-09T05:20:00Z') },
            { entityType: 'gateway', entityId: 'gw1', tenantId: 'tA', at: new Date('2026-08-09T05:40:00Z') },
          ]),
        },
        device: { findMany: jest.fn(async () => []) },
        tenant: { findMany: jest.fn(async () => [{ id: 'tA', name: 'Tenant A' }]) },
      } as unknown as PrismaService;

      const svc = new DashboardInsightsService(prisma, statusOf(new Set()));
      const trend = await svc.adminTrend({ from, to, period: '24h', excludeTenantIds: [] });

      expect(trend.buckets[5].offlineTransitions).toBe(3);
      expect(trend.buckets[5].offlineBreakdown).toHaveLength(1);
      expect(trend.buckets[5].offlineBreakdown[0]).toMatchObject({ entityId: 'gw1', count: 3 });
    });

    it('cliente/dispositivo não encontrado cai em rótulo de fallback sem quebrar', async () => {
      const from = new Date('2026-08-09T00:00:00Z');
      const to = new Date('2026-08-10T00:00:00Z');
      const prisma = {
        alarmEvent: { findMany: jest.fn(async () => []) },
        statusEvent: {
          findMany: jest.fn(async () => [
            { entityType: 'device', entityId: 'orphan-device-id', tenantId: 'orphan-tenant', at: new Date('2026-08-09T05:10:00Z') },
          ]),
        },
        device: { findMany: jest.fn(async () => []) },
        tenant: { findMany: jest.fn(async () => []) },
      } as unknown as PrismaService;

      const svc = new DashboardInsightsService(prisma, statusOf(new Set()));
      const trend = await svc.adminTrend({ from, to, period: '24h', excludeTenantIds: [] });

      expect(trend.buckets[5].offlineBreakdown[0]).toMatchObject({
        tenantId: 'orphan-tenant',
        tenantName: '—',
        entityName: '#orphan-d',
        category: 'devices',
      });
    });
  });
});
