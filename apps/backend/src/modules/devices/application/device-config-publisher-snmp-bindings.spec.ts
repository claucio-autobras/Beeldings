/**
 * Testes de regressão da fase 2 do SNMP: a coleta é governada pela tabela
 * `device_metric_binding`, sincronizada DENTRO da mesma publicação de config.
 *
 * Casos travados:
 * 1. Primeira publicação de um device novo (sem linhas na tabela): o sync cria
 *    os bindings E o payload da MESMA publicação já sai com os OIDs pós-sync +
 *    `restrictToBindings: true` (sem esperar um segundo publish).
 * 2. OID alterado no ponto: o sync atualiza a linha e o payload emite o OID novo.
 * 3. Sync falhou: o payload usa o estado ATUAL do banco (linhas carregadas na
 *    query), nunca o espelho em memória — banco governa a coleta.
 */

import { DeviceConfigPublisherService } from './device-config-publisher.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fakePoint(tag: string, binding: Record<string, unknown> | null) {
  return { tag, objectType: 'AV', instance: 0, unit: null, binding };
}

function fakeSnmpDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cam-1',
    name: 'Câmera Portaria',
    protocol: 'snmp' as const,
    ip: '10.0.0.10',
    port: 161,
    tenantId: 'tenant-1',
    gatewayId: 'gw-1',
    monitoredDeviceType: 'CAMERA' as const,
    config: { snmpVersion: '2c', community: 'public', manufacturer: null },
    points: [
      // 'status' é derivado (sem OID) — nunca vira binding nem bloqueia o modo restrito.
      fakePoint('STATUS', { metric: 'status' }),
      fakePoint('CPU', { metric: 'cpu', oid: '1.3.6.1.4.1.99.1.0', scale: 1, unsupported: false }),
      fakePoint('MEM', { metric: 'memory', oid: '1.3.6.1.4.1.99.2.0', scale: 1, unsupported: false }),
    ],
    snmpCredential: null,
    metricBindings: [] as Array<{
      id: string; metricKey: string; oid: string; source: string; memberOids?: unknown;
    }>,
    ...overrides,
  };
}

function buildPrismaMock(devices: ReturnType<typeof fakeSnmpDevice>[]) {
  return {
    device: {
      findMany: jest.fn().mockResolvedValue(devices),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    deviceMetricBinding: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function buildMqttMock() {
  const published: Array<{ topic: string; payload: unknown }> = [];
  return {
    mock: published,
    service: {
      publish: jest.fn(async (topic: string, payload: unknown) => {
        published.push({ topic, payload });
      }),
    },
  };
}

type PublishedBlock = {
  restrictToBindings?: boolean;
  points: Array<{ tag: string; metric: string; oid: string | null; memberOids?: string[] }>;
};

function firstBlock(published: Array<{ payload: unknown }>): PublishedBlock {
  const payload = published[0].payload as { devices: PublishedBlock[] };
  return payload.devices[0];
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('DeviceConfigPublisherService — coleta governada por device_metric_binding', () => {
  it('primeira publicação: cria os bindings e o MESMO payload sai com OIDs pós-sync + restrictToBindings', async () => {
    const device = fakeSnmpDevice();
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    // Sync criou uma linha por ponto com OID resolvido (status derivado fica fora).
    expect(prisma.deviceMetricBinding.create).toHaveBeenCalledTimes(2);
    const createdKeys = prisma.deviceMetricBinding.create.mock.calls.map(
      (c) => (c[0] as { data: { metricKey: string } }).data.metricKey,
    );
    expect(createdKeys.sort()).toEqual(['cpu_usage', 'memory_used_percent']);

    // O payload desta MESMA publicação já reflete o estado pós-sync.
    const block = firstBlock(published);
    expect(block.restrictToBindings).toBe(true);
    const byTag = new Map(block.points.map((p) => [p.tag, p]));
    expect(byTag.get('CPU')?.oid).toBe('1.3.6.1.4.1.99.1.0');
    expect(byTag.get('MEM')?.oid).toBe('1.3.6.1.4.1.99.2.0');
    expect(byTag.get('STATUS')?.oid).toBeNull();
  });

  it('OID alterado no ponto: atualiza a linha e o payload emite o OID novo', async () => {
    const device = fakeSnmpDevice({
      metricBindings: [
        { id: 'b-cpu', metricKey: 'cpu_usage', oid: '1.3.6.1.4.1.99.OLD', source: 'point' },
        { id: 'b-mem', metricKey: 'memory_used_percent', oid: '1.3.6.1.4.1.99.2.0', source: 'point' },
      ],
    });
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    // Só o binding divergente é atualizado (diff-only) e o flag broken é limpo.
    expect(prisma.deviceMetricBinding.create).not.toHaveBeenCalled();
    expect(prisma.deviceMetricBinding.update).toHaveBeenCalledTimes(1);
    const updateArg = prisma.deviceMetricBinding.update.mock.calls[0][0] as {
      where: { id: string };
      data: { oid: string; broken: boolean };
    };
    expect(updateArg.where.id).toBe('b-cpu');
    expect(updateArg.data.oid).toBe('1.3.6.1.4.1.99.1.0');
    expect(updateArg.data.broken).toBe(false);

    const block = firstBlock(published);
    expect(block.restrictToBindings).toBe(true);
    expect(block.points.find((p) => p.tag === 'CPU')?.oid).toBe('1.3.6.1.4.1.99.1.0');
  });

  it('sync falhou: o payload usa o estado atual do banco, nunca o espelho em memória', async () => {
    // Banco tem um OID antigo; o ponto aponta para um novo, mas o write falha.
    const device = fakeSnmpDevice({
      metricBindings: [
        { id: 'b-cpu', metricKey: 'cpu_usage', oid: '1.3.6.1.4.1.99.DB', source: 'point' },
        { id: 'b-mem', metricKey: 'memory_used_percent', oid: '1.3.6.1.4.1.99.2.0', source: 'point' },
      ],
    });
    const prisma = buildPrismaMock([device]);
    prisma.deviceMetricBinding.update.mockRejectedValue(new Error('db down'));
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    // Config ainda é publicada (falha de sync não derruba o publish)…
    expect(published).toHaveLength(1);
    const block = firstBlock(published);
    // …mas o OID emitido é o do BANCO (estado real), não o do espelho falho.
    expect(block.points.find((p) => p.tag === 'CPU')?.oid).toBe('1.3.6.1.4.1.99.DB');
  });

  it('switch só-tabela: bindings por porta com OID completo coluna.índice e modo restrito ativo', async () => {
    const device = fakeSnmpDevice({
      id: 'sw-1',
      monitoredDeviceType: 'SWITCH',
      points: [
        fakePoint('STATUS', { metric: 'status' }),
        fakePoint('PORTA_1_LINK', {
          metric: 'if_oper_status',
          oid: '1.3.6.1.2.1.2.2.1.8',
          ifIndex: 1,
          collectionType: 'table',
        }),
        fakePoint('PORTA_2_LINK', {
          metric: 'if_oper_status',
          oid: '1.3.6.1.2.1.2.2.1.8',
          ifIndex: 2,
          collectionType: 'table',
        }),
      ],
    });
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    // Um binding POR PORTA (tag), com o OID completo coluna.índice.
    expect(prisma.deviceMetricBinding.create).toHaveBeenCalledTimes(2);
    const created = prisma.deviceMetricBinding.create.mock.calls.map(
      (c) => (c[0] as { data: { metricKey: string; oid: string } }).data,
    );
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricKey: 'PORTA_1_LINK', oid: '1.3.6.1.2.1.2.2.1.8.1' }),
        expect.objectContaining({ metricKey: 'PORTA_2_LINK', oid: '1.3.6.1.2.1.2.2.1.8.2' }),
      ]),
    );

    // Device só de tabela ENTRA em modo restrito; pontos emitem prefixo de coluna.
    const block = firstBlock(published);
    expect(block.restrictToBindings).toBe(true);
    const byTag = new Map(block.points.map((p) => [p.tag, p]));
    expect(byTag.get('PORTA_1_LINK')?.oid).toBe('1.3.6.1.2.1.2.2.1.8');
    expect(byTag.get('PORTA_2_LINK')?.oid).toBe('1.3.6.1.2.1.2.2.1.8');
  });

  it('ponto de tabela sem OID resolvido mantém GET-only e publica OID nulo', async () => {
    const device = fakeSnmpDevice({
      id: 'sw-2',
      monitoredDeviceType: 'SWITCH',
      points: [
        fakePoint('STATUS', { metric: 'status' }),
        fakePoint('PORTA_1_LINK', {
          metric: 'if_oper_status',
          oid: null, // resolve por perfil no gateway
          ifIndex: 1,
          collectionType: 'table',
        }),
        fakePoint('CPU', { metric: 'cpu', oid: '1.3.6.1.4.1.99.1.0', scale: 1 }),
      ],
    });
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    const block = firstBlock(published);
    expect(block.restrictToBindings).toBe(true);
    expect(block.points.find((p) => p.tag === 'PORTA_1_LINK')?.oid).toBeNull();
  });

  it('materializa no backend um binding legado de controladora antes do primeiro polling', async () => {
    const genericCpu = '1.3.6.1.2.1.25.3.3.1.2.1';
    const controlIdCpu = '1.3.6.1.2.1.25.3.3.1.2.1';
    const device = fakeSnmpDevice({
      id: 'ac-1',
      monitoredDeviceType: 'ACCESS_CONTROLLER',
      config: { snmpVersion: '2c', community: 'public', manufacturer: 'Control iD' },
      points: [
        fakePoint('STATUS', { metric: 'status' }),
        // Seed antigo, sem marca manual/diagnóstico: deve ser substituído pelo
        // perfil já conhecido no backend, nunca pelo gateway durante polling.
        fakePoint('CPU', { metric: 'cpu', oid: genericCpu, scale: 1 }),
      ],
    });
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    expect(prisma.deviceMetricBinding.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ metricKey: 'cpu_usage', oid: controlIdCpu }),
    }));
    const block = firstBlock(published);
    expect(block.restrictToBindings).toBe(true);
    expect(block.points.find((p) => p.tag === 'CPU')?.oid).toBe(controlIdCpu);
  });

  it('materializa no backend o prefixo legado de tabela NVR em OID completo', async () => {
    const diskStatus = '1.3.6.1.4.1.50001.1.241.1.3';
    const device = fakeSnmpDevice({
      id: 'nvr-1',
      monitoredDeviceType: 'NVR',
      points: [
        fakePoint('STATUS', { metric: 'status' }),
        fakePoint('DISCO_2_STATUS', {
          metric: 'disk_status',
          collectionType: 'table',
          slotIndex: 2,
          tableOidPrefix: diskStatus,
        }),
      ],
    });
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    expect(prisma.deviceMetricBinding.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metricKey: 'DISCO_2_STATUS',
        oid: `${diskStatus}.2`,
      }),
    }));
    expect(firstBlock(published).points.find((p) => p.tag === 'DISCO_2_STATUS')?.oid)
      .toBe(diskStatus);
  });

  it('métrica agregada: memberOids do banco são anexados ao ponto escalar correspondente', async () => {
    const CPU_MEMBERS = [
      '1.3.6.1.2.1.25.3.3.1.2.1',
      '1.3.6.1.2.1.25.3.3.1.2.2',
      '1.3.6.1.2.1.25.3.3.1.2.3',
      '1.3.6.1.2.1.25.3.3.1.2.4',
    ];
    const device = fakeSnmpDevice({
      points: [
        fakePoint('STATUS', { metric: 'status' }),
        // Ponto legado `cpu`; o publisher normaliza para o binding canônico
        // `cpu_usage` antes de anexar os OIDs membros.
        fakePoint('CPU', { metric: 'cpu', oid: CPU_MEMBERS[0], scale: 1 }),
      ],
      metricBindings: [
        {
          id: 'b-cpu',
          metricKey: 'cpu_usage',
          oid: CPU_MEMBERS[0],
          source: 'diagnose',
          memberOids: CPU_MEMBERS,
        },
      ],
    });
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    const block = firstBlock(published);
    expect(block.restrictToBindings).toBe(true);
    const cpu = block.points.find((p) => p.tag === 'CPU');
    // TODOS os OIDs membros vão para o payload (batch de GET no gateway) — sem walk.
    expect(cpu?.memberOids).toEqual(CPU_MEMBERS);
    // O ponto escalar único NÃO é o único OID; ele mais os membros vão ao GET.
    expect(cpu?.oid).toBe(CPU_MEMBERS[0]);
  });

  it('CPU peak reutiliza o binding cpu_usage sem criar um segundo binding', async () => {
    const CPU_MEMBERS = [
      '1.3.6.1.2.1.25.3.3.1.2.1',
      '1.3.6.1.2.1.25.3.3.1.2.2',
    ];
    const device = fakeSnmpDevice({
      points: [
        fakePoint('STATUS', { metric: 'status' }),
        fakePoint('CPU', { metric: 'cpu_usage', oid: CPU_MEMBERS[0], scale: 1 }),
        fakePoint('CPU_USAGE_PEAK', {
          metric: 'cpu_usage_peak',
          oid: CPU_MEMBERS[0],
          scale: 1,
          memberOids: CPU_MEMBERS,
        }),
      ],
      metricBindings: [{
        id: 'b-cpu',
        metricKey: 'cpu_usage',
        oid: CPU_MEMBERS[0],
        source: 'diagnose',
        memberOids: CPU_MEMBERS,
      }],
    });
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    expect(prisma.deviceMetricBinding.create).not.toHaveBeenCalled();
    const block = firstBlock(published);
    const peak = block.points.find((point) => point.tag === 'CPU_USAGE_PEAK');
    expect(peak?.metric).toBe('cpu_usage_peak');
    expect(peak?.oid).toBe(CPU_MEMBERS[0]);
    expect(peak?.memberOids).toEqual(CPU_MEMBERS);
  });

  it('device novo com sync falhando: mantém GET-only e OIDs escalares nulos', async () => {
    const device = fakeSnmpDevice(); // metricBindings vazio
    const prisma = buildPrismaMock([device]);
    prisma.deviceMetricBinding.create.mockRejectedValue(new Error('db down'));
    const { mock: published, service: mqtt } = buildMqttMock();
    const publisher = new DeviceConfigPublisherService(prisma as never, mqtt as never);

    await publisher.publishForGateway('tenant-1', 'gw-1');

    const block = firstBlock(published);
    // Sem binding persistido, o ponto fica nulo; polling nunca volta ao perfil/walk.
    expect(block.restrictToBindings).toBe(true);
    expect(block.points.find((p) => p.tag === 'CPU')?.oid).toBeNull();
  });
});
