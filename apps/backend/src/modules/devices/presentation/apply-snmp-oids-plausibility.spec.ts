/**
 * Regressão de segurança do apply de OIDs (CFTV e SCA): OID reprovado na
 * validação de plausibilidade do último diagnóstico (persistido em
 * device.config.snmpUnconfirmedOids) NUNCA pode virar métrica canônica —
 * nem via payload direto/forjado no corpo de body.oids, nem via customPoints
 * com rótulo semântico. Protege contra o cenário Control iD de árvore
 * deslocada entre firmwares gravando rótulo errado no banco.
 */

import { CftvController } from './cftv.controller.js';
import { ScaController } from './sca.controller.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';

const REPROVED_OID = '1.3.6.1.4.1.49617.1.1.4.0';

const ADMIN_USER: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: '',
  email: 'admin@test.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  tenantId: 'tenant-1',
};

function fakeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-1',
    name: 'Equipamento Teste',
    protocol: 'snmp',
    ip: '10.0.0.1',
    port: 161,
    status: 'offline',
    tenantId: 'tenant-1',
    siteId: null,
    gatewayId: 'gw-1',
    monitoredDeviceType: 'ACCESS_CONTROLLER',
    config: { snmpUnconfirmedOids: [REPROVED_OID] },
    points: [],
    site: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildPrismaMock(device: Record<string, unknown>, points: Array<Record<string, unknown>>) {
  return {
    device: {
      findFirst: jest.fn().mockResolvedValue(device),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...device, points, site: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    devicePoint: {
      findMany: jest.fn().mockResolvedValue(points),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-pt',
        instance: 99,
        ...data,
      })),
    },
  };
}

const configPublisher = () => ({ publishForDevice: jest.fn().mockResolvedValue(undefined) });
const deviceStatus = () => ({
  getStatus: jest.fn().mockReturnValue('offline'),
  resolveLastSeen: jest.fn().mockResolvedValue(null),
  resolveLastSeenMany: jest.fn().mockResolvedValue(new Map()),
});

function cpuPoint() {
  return {
    id: 'pt-cpu',
    tag: 'CPU',
    objectName: 'Uso de CPU',
    objectType: 'snmp',
    instance: 1,
    unit: '%',
    binding: { metric: 'cpu', oid: null, unsupported: true },
  };
}

describe('SCA — apply-snmp-oids honra a plausibilidade', () => {
  function buildController(prisma: ReturnType<typeof buildPrismaMock>) {
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

  it('payload direto com OID reprovado como "cpu" NÃO atualiza/cria ponto canônico', async () => {
    const prisma = buildPrismaMock(fakeDevice(), [cpuPoint()]);
    const controller = buildController(prisma);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      oids: { cpu: REPROVED_OID },
    });

    expect(prisma.devicePoint.update).not.toHaveBeenCalled();
    expect(prisma.devicePoint.create).not.toHaveBeenCalled();
  });

  it('customPoint reprovado entra como custom neutro, nunca repontando o canônico', async () => {
    const prisma = buildPrismaMock(fakeDevice(), [cpuPoint()]);
    const controller = buildController(prisma);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      customPoints: [{ oid: REPROVED_OID, name: 'Uso de CPU', unit: '%' }],
    });

    // Ponto canônico intocado.
    expect(prisma.devicePoint.update).not.toHaveBeenCalled();
    // Criado como custom com nome neutro (rótulo semântico bloqueado).
    expect(prisma.devicePoint.create).toHaveBeenCalledTimes(1);
    const arg = prisma.devicePoint.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect((arg.data.binding as Record<string, unknown>).metric).toBe('custom');
    expect(arg.data.objectName).toBe(`OID ${REPROVED_OID}`);
  });

  it('controle: OID confirmado (fora da lista) continua aplicável como canônico', async () => {
    const prisma = buildPrismaMock(fakeDevice({ config: { snmpUnconfirmedOids: [] } }), [
      cpuPoint(),
    ]);
    const controller = buildController(prisma);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      oids: { cpu: REPROVED_OID },
    });

    expect(prisma.devicePoint.update).toHaveBeenCalledTimes(1);
    const arg = prisma.devicePoint.update.mock.calls[0][0] as {
      data: { binding: Record<string, unknown> };
    };
    expect(arg.data.binding.metric).toBe('cpu_usage');
    expect(arg.data.binding.oid).toBe(REPROVED_OID);
  });

  it('mesmo OID em oids E customPoints repontá o canônico UMA vez, sem ponto duplicado', async () => {
    const CONFIRMED_OID = '1.3.6.1.4.1.49617.1.1.4.0';
    const prisma = buildPrismaMock(fakeDevice({ config: { snmpUnconfirmedOids: [] } }), [
      cpuPoint(),
    ]);
    const controller = buildController(prisma);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      oids: { cpu: CONFIRMED_OID },
      customPoints: [{ oid: CONFIRMED_OID, name: 'Uso de CPU', unit: '%' }],
    });

    // Snapshot em memória atualizado no loop de oids → o custom acha o ponto
    // pelo binding.oid e NÃO cria um segundo ponto lendo o mesmo OID.
    expect(prisma.devicePoint.create).not.toHaveBeenCalled();
    const updatedIds = prisma.devicePoint.update.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id,
    );
    expect(updatedIds).toContain('pt-cpu');
    for (const call of prisma.devicePoint.update.mock.calls) {
      const data = (call[0] as { data: { binding?: Record<string, unknown> } }).data;
      if (data.binding) expect(data.binding.metric).toBe('cpu_usage');
    }
  });
});

describe('CFTV — apply-snmp-oids honra a plausibilidade', () => {
  function buildController(prisma: ReturnType<typeof buildPrismaMock>) {
    return new CftvController(
      prisma as never,
      configPublisher() as never,
      /* snmpScan        */ {} as never,
      /* onvifProbe      */ {} as never,
      /* onvifScan       */ {} as never,
      /* snmpHealthTest  */ {} as never,
      /* snmpDiagnose    */ {} as never,
      /* capabilityProbe */ {} as never,
      deviceStatus() as never,
      /* liveView        */ {} as never,
      /* switchPortSync  */ {} as never,
      /* nvrTableSync    */ {} as never,
      /* snmpMib         */ {} as never,
    );
  }

  it('payload direto com OID reprovado como "cpu" NÃO atualiza/cria ponto canônico', async () => {
    const prisma = buildPrismaMock(fakeDevice({ monitoredDeviceType: 'CAMERA' }), [cpuPoint()]);
    const controller = buildController(prisma);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      oids: { cpu: REPROVED_OID },
    });

    expect(prisma.devicePoint.update).not.toHaveBeenCalled();
    expect(prisma.devicePoint.create).not.toHaveBeenCalled();
  });

  it('customPoint reprovado entra como custom neutro, nunca repontando o canônico', async () => {
    const prisma = buildPrismaMock(fakeDevice({ monitoredDeviceType: 'CAMERA' }), [cpuPoint()]);
    const controller = buildController(prisma);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      customPoints: [{ oid: REPROVED_OID, name: 'Uso de CPU', unit: '%' }],
    });

    expect(prisma.devicePoint.update).not.toHaveBeenCalled();
    expect(prisma.devicePoint.create).toHaveBeenCalledTimes(1);
    const arg = prisma.devicePoint.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect((arg.data.binding as Record<string, unknown>).metric).toBe('custom');
    expect(arg.data.objectName).toBe(`OID ${REPROVED_OID}`);
  });

  it('controle: OID confirmado (fora da lista) continua aplicável como canônico', async () => {
    const prisma = buildPrismaMock(
      fakeDevice({ monitoredDeviceType: 'CAMERA', config: { snmpUnconfirmedOids: [] } }),
      [cpuPoint()],
    );
    const controller = buildController(prisma);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      oids: { cpu: REPROVED_OID },
    });

    expect(prisma.devicePoint.update).toHaveBeenCalledTimes(1);
    const arg = prisma.devicePoint.update.mock.calls[0][0] as {
      data: { binding: Record<string, unknown> };
    };
    expect(arg.data.binding.metric).toBe('cpu_usage');
    expect(arg.data.binding.oid).toBe(REPROVED_OID);
  });

  it('mesmo OID em oids E customPoints repontá o canônico UMA vez, sem ponto duplicado', async () => {
    const CONFIRMED_OID = '1.3.6.1.4.1.49617.1.1.4.0';
    const prisma = buildPrismaMock(
      fakeDevice({ monitoredDeviceType: 'CAMERA', config: { snmpUnconfirmedOids: [] } }),
      [cpuPoint()],
    );
    const controller = buildController(prisma);

    await controller.applySnmpOids(ADMIN_USER, 'dev-1', {
      oids: { cpu: CONFIRMED_OID },
      customPoints: [{ oid: CONFIRMED_OID, name: 'Uso de CPU', unit: '%' }],
    });

    expect(prisma.devicePoint.create).not.toHaveBeenCalled();
    const updatedIds = prisma.devicePoint.update.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id,
    );
    expect(updatedIds).toContain('pt-cpu');
    for (const call of prisma.devicePoint.update.mock.calls) {
      const data = (call[0] as { data: { binding?: Record<string, unknown> } }).data;
      if (data.binding) expect(data.binding.metric).toBe('cpu_usage');
    }
  });
});
