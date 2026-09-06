import { AlarmEventsService } from './alarm-events.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AlarmEngineService } from './alarm-engine.service.js';

describe('AlarmEventsService recent active feed', () => {
  const event = (over: Record<string, unknown>) => ({
    id: 'event',
    alarmRuleId: 'rule',
    tenantId: 'tenant-1',
    kind: 'ALARM',
    state: 'ACTIVE',
    valueAtTrigger: 1,
    activatedAt: new Date('2026-08-31T10:00:00.000Z'),
    normalizedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ackNote: null,
    reactivationCount: 0,
    lastReactivatedAt: null,
    createdAt: new Date('2026-08-31T10:00:00.000Z'),
    alarmRule: {
      id: 'rule',
      name: 'Falha',
      message: 'Falha ativa',
      severity: 'LOW',
      point: {
        id: 'point',
        tag: 'FAIL',
        objectName: 'Falha da bomba',
        objectType: 'binaryInput',
        instance: 1,
        unit: null,
        deviceId: 'device',
        device: {
          id: 'device',
          name: 'Bomba 1',
          siteId: 'site-1',
          site: { name: 'Casa de máquinas' },
          tenant: { name: 'Cliente A' },
        },
      },
    },
    ...over,
  });

  it('escopa ativos por site, ordena por criticidade/atividade e só então limita', async () => {
    const findMany = jest.fn().mockResolvedValue([
      event({ id: 'low-new', activatedAt: new Date('2026-08-31T12:00:00.000Z') }),
      event({
        id: 'high-old',
        activatedAt: new Date('2026-08-31T09:00:00.000Z'),
        alarmRule: {
          ...event({}).alarmRule,
          severity: 'HIGH',
        },
      }),
      event({
        id: 'high-reactivated',
        activatedAt: new Date('2026-08-31T08:00:00.000Z'),
        lastReactivatedAt: new Date('2026-08-31T11:30:00.000Z'),
        alarmRule: {
          ...event({}).alarmRule,
          severity: 'HIGH',
        },
      }),
    ]);
    const prisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      alarmEvent: { findMany },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new AlarmEventsService(
      prisma,
      { syncAcknowledged: jest.fn() } as unknown as AlarmEngineService,
    );

    const result = await service.findAll({ siteId: 'site-1', open: true, limit: 2 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        kind: 'ALARM',
        state: { in: ['ACTIVE', 'ACTIVE_ACK'] },
        alarmRule: { point: { device: { siteId: 'site-1' } } },
      }),
    }));
    expect(result.map((row) => row.id)).toEqual(['high-reactivated', 'high-old']);
    expect(result[0]).toMatchObject({
      pointId: 'point',
      deviceId: 'device',
      siteId: 'site-1',
      tenantId: 'tenant-1',
      state: 'ACTIVE',
    });
  });
});