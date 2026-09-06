import { CftvController } from './cftv.controller.js';

const HIK_CPU = '1.3.6.1.4.1.39165.1.7.0';
const HIK_MEMORY = '1.3.6.1.4.1.39165.1.11.0';
const HIK_RAM_TOTAL = '1.3.6.1.4.1.39165.1.10.0';
const HIK_STORAGE = '1.3.6.1.4.1.39165.1.9.0';

function point(
  id: string,
  tag: string,
  instance: number,
  binding: Record<string, unknown>,
) {
  return { id, tag, instance, binding };
}

function canonical(key: string, oid: string, value: number, unit: string) {
  return {
    canonicalKey: key,
    selectedOid: oid,
    value,
    unit,
    confidence: 'exact' as const,
    label: key,
    source: 'fixture',
  };
}

function buildController(points: ReturnType<typeof point>[] = []) {
  const prisma = {
    device: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    devicePoint: {
      findMany: jest.fn().mockResolvedValue(points),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    snmpCredential: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const publisher = { publishForDevice: jest.fn().mockResolvedValue(undefined) };
  const diagnose = { diagnose: jest.fn() };
  const discovery = {
    canRunAutoDiscovery: jest.fn().mockResolvedValue(true),
    recordRun: jest.fn().mockResolvedValue({}),
  };
  const healthTest = { test: jest.fn() };
  const metric = { persistAutoResolvedBindings: jest.fn().mockResolvedValue(0) };
  const status = { getStatus: jest.fn().mockReturnValue('online') };
  const controller = new CftvController(
    prisma as never,
    publisher as never,
    {} as never,
    {} as never,
    {} as never,
    healthTest as never,
    diagnose as never,
    {} as never,
    status as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    discovery as never,
    metric as never,
  );
  return { controller, prisma, publisher, diagnose, discovery, healthTest, metric };
}

describe('CftvController — reconciliação automática SNMP de câmera', () => {
  const device = {
    id: 'camera-1',
    tenantId: 'tenant-1',
    gatewayId: 'gateway-1',
    ip: '10.0.0.20',
    port: 161,
    monitoredDeviceType: 'CAMERA',
    config: { snmpVersion: '2c', community: 'public', profileId: null },
  };

  const hikvisionResult = {
    success: true as const,
    reachable: true,
    sysObjectId: '1.3.6.1.4.1.39165.1',
    sysDescr: 'Hikvision DS-2CD',
    walk: [],
    canonicalMetrics: {
      cpu_usage: canonical('cpu_usage', HIK_CPU, 34, '%'),
      memory_used_percent: canonical('memory_used_percent', HIK_MEMORY, 45, '%'),
      ram_total: canonical('ram_total', HIK_RAM_TOTAL, 256 * 1024 * 1024, 'bytes'),
      storage_used_percent: canonical('storage_used_percent', HIK_STORAGE, 0, '%'),
    },
  };

  it('substitui os seeds genéricos, cria RAM/armazenamento e republica o plano Hikvision', async () => {
    const { controller, prisma, diagnose, discovery, publisher, metric } = buildController([
      point('cpu', 'CPU', 0, { metric: 'cpu', oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1 }),
      point('memory', 'MEMORIA_LIVRE', 1, { metric: 'memory', oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1 }),
    ]);
    prisma.device.findUnique.mockResolvedValue(device);
    diagnose.diagnose.mockResolvedValue(hikvisionResult);

    await (controller as any).runAutoDiscovery(device.id, 'registration');

    expect(discovery.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: device.id,
      result: hikvisionResult,
    }));
    expect(diagnose.diagnose).toHaveBeenCalledWith(expect.objectContaining({
      manufacturer: undefined,
      deviceType: 'CAMERA',
    }));
    expect(prisma.devicePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'cpu' }),
      data: expect.objectContaining({
        unit: '%',
        binding: expect.objectContaining({ metric: 'cpu_usage', oid: HIK_CPU }),
      }),
    }));
    expect(prisma.devicePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'memory' }),
      data: expect.objectContaining({
        binding: expect.objectContaining({ metric: 'memory_used_percent', oid: HIK_MEMORY }),
      }),
    }));
    expect(prisma.devicePoint.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tag: 'RAM_TOTAL',
        unit: 'bytes',
        binding: expect.objectContaining({ oid: HIK_RAM_TOTAL, scale: 1024 * 1024 }),
      }),
    }));
    expect(prisma.devicePoint.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tag: 'ARMAZENAMENTO',
        binding: expect.objectContaining({ oid: HIK_STORAGE }),
      }),
    }));
    expect(prisma.device.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        config: expect.objectContaining({ profileId: 'hikvision', profileSource: 'detected' }),
      }),
    }));
    expect(metric.persistAutoResolvedBindings).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: device.id,
      onlyIfMissing: true,
      resolved: expect.arrayContaining([
        expect.objectContaining({
          metricKey: 'ram_total',
          oid: HIK_RAM_TOTAL,
          scale: 1024 * 1024,
          unit: 'bytes',
        }),
        expect.objectContaining({ metricKey: 'storage_used_percent', oid: HIK_STORAGE }),
      ]),
    }));
    expect(publisher.publishForDevice).toHaveBeenCalledWith(device.id);
  });

  it('preserva a fonte selecionada manualmente', async () => {
    const { controller, prisma } = buildController([
      point('cpu', 'CPU', 0, {
        metric: 'cpu',
        oid: '1.3.6.1.4.1.999.1.0',
        scale: 1,
        unsupported: false,
      }),
    ]);

    await (controller as any).reconcileAutoDiscoveredCameraMetrics(device, hikvisionResult);

    expect(prisma.devicePoint.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cpu' },
    }));
  });

  it('semeia somente valores das fontes efetivamente publicadas e ignora OIDs indisponíveis', async () => {
    const effectivePoints = [
      point('cpu', 'CPU', 0, { metric: 'cpu_usage', oid: HIK_CPU, scale: 1 }),
      point('ram', 'RAM_TOTAL', 1, { metric: 'ram_total', oid: HIK_RAM_TOTAL, scale: 1 }),
      point('storage', 'ARMAZENAMENTO', 2, { metric: 'storage_used_percent', oid: HIK_STORAGE, scale: 1 }),
      point('temp', 'TEMPERATURA', 3, {
        metric: 'temperature',
        oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1',
        unsupported: true,
      }),
    ];
    const { controller, healthTest, prisma } = buildController();
    healthTest.test.mockResolvedValue({
      success: true,
      reachable: true,
      values: { cpu: 34, ram: 256, storage: 0 },
    });

    await (controller as any).seedCameraFromEffectivePlan({
      ...device,
      points: effectivePoints,
    });

    expect(healthTest.test).toHaveBeenCalledWith(expect.objectContaining({
      oids: {
        cpu: HIK_CPU,
        ram: HIK_RAM_TOTAL,
        storage: HIK_STORAGE,
      },
    }));
    expect(prisma.devicePoint.updateMany).toHaveBeenCalledTimes(3);
    expect(prisma.devicePoint.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'storage', lastValueAt: null },
      data: expect.objectContaining({ lastValue: 0 }),
    }));
  });
});