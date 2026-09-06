/**
 * Regressão da task 1060 (vínculo SCADA de equipamentos): pontos SNMP de
 * memória duplicados em controladoras SCA (alias legado `metric: 'memory'`
 * divergindo do canônico `memory_available` — ambos mapeando para a mesma
 * tag MEMORIA) não podem voltar a ser criados nem persistir duplicados na
 * listagem.
 */

import { ScaController } from './sca.controller.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';

const ADMIN_USER: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: '',
  email: 'admin@test.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  tenantId: 'tenant-1',
};

function legacyMemoryPoint() {
  return {
    id: 'pt-mem-legacy',
    tag: 'MEMORIA',
    objectName: 'Memória disponível',
    objectType: 'snmp',
    instance: 2,
    unit: 'kB',
    binding: { metric: 'memory', oid: null, unsupported: true },
    lastValue: null,
    lastValueAt: null,
    lastValueState: 'waiting_event',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };
}

function canonicalMemoryPointNoOid() {
  return {
    id: 'pt-mem-canonical',
    tag: 'MEMORIA',
    objectName: 'Memória disponível',
    objectType: 'snmp',
    instance: 3,
    unit: 'kB',
    binding: { metric: 'memory_available', oid: null, unsupported: true },
    lastValue: null,
    lastValueAt: null,
    lastValueState: 'waiting_event',
    createdAt: new Date('2024-02-01T00:00:00Z'),
  };
}

function canonicalMemoryPointWithOid() {
  return {
    id: 'pt-mem-working',
    tag: 'MEMORIA',
    objectName: 'Memória disponível',
    objectType: 'snmp',
    instance: 4,
    unit: 'kB',
    binding: { metric: 'memory_available', oid: '1.3.6.1.4.1.9999.1.1.1', unsupported: false },
    lastValue: 61028,
    lastValueAt: new Date('2024-03-01T00:00:00Z'),
    lastValueState: null,
    createdAt: new Date('2024-03-01T00:00:00Z'),
  };
}

function ramTotalPoint() {
  return {
    id: 'pt-ram-total',
    tag: 'MEMORIA_TOTAL',
    objectName: 'Memória RAM total',
    objectType: 'snmp',
    instance: 1,
    unit: 'bytes',
    binding: { metric: 'ram_total', oid: null, unsupported: false },
    lastValue: null,
    lastValueAt: null,
    lastValueState: 'waiting_event',
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };
}

function fakeDevice(points: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-1',
    name: 'Controladora Teste',
    protocol: 'snmp',
    ip: '10.0.0.1',
    port: 161,
    critical: false,
    gatewayId: 'gw-1',
    tenantId: 'tenant-1',
    siteId: null,
    monitoredDeviceType: 'ACCESS_CONTROLLER',
    config: {},
    points,
    site: null,
    snmpCredential: null,
    snmpMib: null,
    snmpMibId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildPrisma(devices: Array<ReturnType<typeof fakeDevice>>) {
  const trend = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
  const alarmRule = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
  const devicePoint = {
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'new-pt',
      createdAt: new Date(),
      ...data,
    })),
    findMany: jest.fn().mockResolvedValue(devices.flatMap((d) => d.points)),
  };
  return {
    device: {
      findMany: jest.fn().mockResolvedValue(devices),
      findFirst: jest.fn().mockResolvedValue(devices[0]),
      findUniqueOrThrow: jest.fn().mockResolvedValue(devices[0]),
      update: jest.fn().mockResolvedValue({}),
    },
    devicePoint,
    trend,
    alarmRule,
    // Modo array do $transaction — as operações já foram criadas (mocks
    // resolvidos individualmente); só precisa aguardá-las na ordem certa.
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
}

const configPublisher = () => ({ publishForDevice: jest.fn().mockResolvedValue(undefined) });
const deviceStatus = () => ({
  getStatus: jest.fn().mockReturnValue('offline'),
  resolveLastSeen: jest.fn().mockResolvedValue(null),
  resolveLastSeenMany: jest.fn().mockResolvedValue(new Map()),
});

function buildController(prisma: ReturnType<typeof buildPrisma>) {
  return new ScaController(
    prisma as never,
    configPublisher() as never,
    /* snmpHealthTest  */ {} as never,
    /* snmpDiagnose    */ {} as never,
    /* capabilityProbe */ {} as never,
    deviceStatus() as never,
    /* snmpMib         */ {} as never,
  );
}

describe('SCA — higienização de pontos de memória duplicados (GET /sca/controllers)', () => {
  it('consolida MEMORIA duplicada (legado "memory" + canônico "memory_available") em um só ponto', async () => {
    const device = fakeDevice([
      ramTotalPoint(),
      legacyMemoryPoint(),
      canonicalMemoryPointWithOid(),
    ]);
    const prisma = buildPrisma([device]);
    const controller = buildController(prisma);

    const result = await controller.listControllers(ADMIN_USER);

    // Só um ponto MEMORIA sobrevive na resposta — o que tem OID funcional.
    const memoriaPoints = result[0].points.filter((p: { tag: string }) => p.tag === 'MEMORIA');
    expect(memoriaPoints).toHaveLength(1);
    expect(memoriaPoints[0].id).toBe('pt-mem-working');

    // Perdedor (o legado, sem OID) removido do banco; trends/alarmes migrados
    // para o sobrevivente com OID funcional.
    expect(prisma.devicePoint.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['pt-mem-legacy'] } },
    });
    expect(prisma.trend.updateMany).toHaveBeenCalledWith({
      where: { pointId: { in: ['pt-mem-legacy'] } },
      data: { pointId: 'pt-mem-working' },
    });
    expect(prisma.alarmRule.updateMany).toHaveBeenCalledWith({
      where: { pointId: { in: ['pt-mem-legacy'] } },
      data: { pointId: 'pt-mem-working' },
    });
  });

  it('é idempotente: sem duplicatas, não toca no banco', async () => {
    const device = fakeDevice([ramTotalPoint(), canonicalMemoryPointWithOid()]);
    const prisma = buildPrisma([device]);
    const controller = buildController(prisma);

    await controller.listControllers(ADMIN_USER);

    expect(prisma.devicePoint.deleteMany).not.toHaveBeenCalled();
    expect(prisma.trend.updateMany).not.toHaveBeenCalled();
    expect(prisma.alarmRule.updateMany).not.toHaveBeenCalled();
  });

  it('quando nenhum duplicado tem OID, mantém o de leitura mais recente como canônico', async () => {
    const device = fakeDevice([
      ramTotalPoint(),
      legacyMemoryPoint(),
      canonicalMemoryPointNoOid(),
    ]);
    const prisma = buildPrisma([device]);
    const controller = buildController(prisma);

    const result = await controller.listControllers(ADMIN_USER);

    const memoriaPoints = result[0].points.filter((p: { tag: string }) => p.tag === 'MEMORIA');
    expect(memoriaPoints).toHaveLength(1);
    // Sem OID funcional nem lastValueAt em nenhum dos dois, o desempate final
    // é o mais antigo (createdAt) — o registro original do cadastro.
    expect(memoriaPoints[0].id).toBe('pt-mem-legacy');
  });
});

describe('SCA — apply-snmp-oids não recria MEMORIA sob o alias canônico', () => {
  function buildApplyPrisma(device: ReturnType<typeof fakeDevice>) {
    return {
      device: {
        findFirst: jest.fn().mockResolvedValue(device),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...device, points: device.points, site: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      devicePoint: {
        findMany: jest.fn().mockResolvedValue(device.points),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'new-pt',
          instance: 99,
          ...data,
        })),
      },
    };
  }

  it('diagnóstico propondo "memory_available" atualiza o ponto legado "memory" pela tag, sem criar duplicata', async () => {
    const device = fakeDevice([legacyMemoryPoint()], { config: { snmpUnconfirmedOids: [] } });
    const prisma = buildApplyPrisma(device);
    const controller = buildController(prisma as never);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      oids: { memory_available: '1.3.6.1.4.1.9999.1.1.1' },
    });

    expect(prisma.devicePoint.create).not.toHaveBeenCalled();
    expect(prisma.devicePoint.update).toHaveBeenCalledTimes(1);
    const arg = prisma.devicePoint.update.mock.calls[0][0] as {
      where: { id: string };
      data: { binding: Record<string, unknown> };
    };
    expect(arg.where.id).toBe('pt-mem-legacy');
    expect(arg.data.binding.metric).toBe('memory_available');
    expect(arg.data.binding.oid).toBe('1.3.6.1.4.1.9999.1.1.1');
  });
});
