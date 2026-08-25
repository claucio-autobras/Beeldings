import { ControlIdOidMigrationService } from './control-id-oid-migration.service.js';

describe('ControlIdOidMigrationService', () => {
  it('corrige fontes existentes preservando os IDs dos pontos e do binding', async () => {
    const prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'ac-1',
          config: { manufacturer: 'Control iD' },
          points: [
            {
              id: 'temp-1',
              binding: { metric: 'temperature', oid: '1.3.6.1.4.1.49617.1.1.5.0' },
            },
            {
              id: 'cpu-1',
              binding: { metric: 'cpu', oid: '1.3.6.1.4.1.49617.1.1.4.0' },
            },
          ],
          metricBindings: [{
            id: 'binding-cpu',
            metricKey: 'cpu_usage',
            oid: '1.3.6.1.4.1.49617.1.1.4.0',
          }],
        }]),
      },
      devicePoint: { update: jest.fn().mockResolvedValue({}) },
      deviceMetricBinding: {
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const publisher = { publishForDevice: jest.fn().mockResolvedValue(undefined) };
    const service = new ControlIdOidMigrationService(prisma as never, publisher as never);

    await service.migrate();

    expect(prisma.devicePoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'temp-1' },
      data: expect.objectContaining({
        binding: expect.objectContaining({
          oid: null,
          unsupported: true,
          healthState: 'unsupported',
        }),
      }),
    }));
    expect(prisma.devicePoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cpu-1' },
      data: expect.objectContaining({
        binding: expect.objectContaining({
          metric: 'cpu_usage',
          oid: '1.3.6.1.2.1.25.3.3.1.2.1',
        }),
      }),
    }));
    expect(prisma.deviceMetricBinding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'binding-cpu' },
      data: expect.objectContaining({
        oid: '1.3.6.1.2.1.25.3.3.1.2.1',
        source: 'profile',
      }),
    }));
    expect(publisher.publishForDevice).toHaveBeenCalledWith('ac-1');
  });

  it('converte memória legada para disponibilidade recuperável e invalida o seed antigo', async () => {
    const prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'ac-memory',
          config: { manufacturer: 'iDFlex' },
          points: [{
            id: 'memory-1',
            lastValue: 73,
            lastValueAt: new Date('2026-08-24T10:00:00Z'),
            binding: { metric: 'memory', oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1 },
          }, {
            id: 'ram-1',
            lastValue: 119400,
            lastValueAt: new Date('2026-08-24T10:00:00Z'),
            binding: { metric: 'memory_total', oid: '1.3.6.1.4.1.2021.4.5.0', scale: 1 },
          }],
          metricBindings: [{
            id: 'binding-memory',
            metricKey: 'memory',
            oid: '1.3.6.1.4.1.2021.4.6.0',
            memberOids: [],
          }],
        }]),
      },
      devicePoint: { update: jest.fn().mockResolvedValue({}) },
      deviceMetricBinding: {
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const publisher = { publishForDevice: jest.fn().mockResolvedValue(undefined) };

    await new ControlIdOidMigrationService(prisma as never, publisher as never).migrate();

    expect(prisma.devicePoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'memory-1' },
      data: expect.objectContaining({
        unit: 'bytes',
        binding: expect.objectContaining({
          metric: 'memory_available',
          oid: '1.3.6.1.4.1.2021.4.6.0',
          scale: 1024,
        }),
        lastValue: null,
        lastValueAt: null,
      }),
    }));
    expect(prisma.devicePoint.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ram-1' },
      data: expect.objectContaining({
        binding: expect.objectContaining({ metric: 'ram_total', scale: 1024 }),
        lastValue: null,
      }),
    }));
    expect(prisma.deviceMetricBinding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'binding-memory' },
      data: expect.objectContaining({
        metricKey: 'memory_available',
        memberOids: expect.arrayContaining([
          '1.3.6.1.4.1.2021.4.14.0',
          '1.3.6.1.4.1.2021.4.15.0',
        ]),
      }),
    }));
    expect(publisher.publishForDevice).toHaveBeenCalledWith('ac-memory');
  });

  it('não republica uma controladora já reconciliada', async () => {
    const prisma = {
      device: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'ac-clean',
          config: { profileId: 'control-id', manufacturer: 'Control iD' },
          points: [{
            id: 'memory-clean',
            lastValue: null,
            binding: { metric: 'memory_available', oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1024, unsupported: false },
          }, {
            id: 'temp-clean',
            binding: { metric: 'temperature', oid: null, unsupported: true, healthState: 'unsupported' },
          }],
          metricBindings: [{
            id: 'binding-clean',
            metricKey: 'memory_available',
            oid: '1.3.6.1.4.1.2021.4.6.0',
            memberOids: [
              '1.3.6.1.4.1.2021.4.6.0',
              '1.3.6.1.4.1.2021.4.14.0',
              '1.3.6.1.4.1.2021.4.15.0',
              '1.3.6.1.4.1.2021.4.5.0',
            ],
          }],
        }]),
      },
      devicePoint: { update: jest.fn().mockResolvedValue({}) },
      deviceMetricBinding: { update: jest.fn().mockResolvedValue({}), delete: jest.fn() },
    };
    const publisher = { publishForDevice: jest.fn().mockResolvedValue(undefined) };

    await new ControlIdOidMigrationService(prisma as never, publisher as never).migrate();

    expect(prisma.devicePoint.update).not.toHaveBeenCalled();
    expect(prisma.deviceMetricBinding.update).not.toHaveBeenCalled();
    expect(publisher.publishForDevice).not.toHaveBeenCalled();
  });
});