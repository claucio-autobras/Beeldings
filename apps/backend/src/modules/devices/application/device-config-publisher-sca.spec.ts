/**
 * Teste de regressão: controladoras SCA criadas com monitoredDeviceType='ACCESS_CONTROLLER'
 * devem ter esse campo explicitamente presente no bloco de config publicado para o gateway.
 *
 * Contexto: DeviceConfigPublisherService.buildDeviceBlock() usava um cast de tipo para
 * acessar monitoredDeviceType (campo fora do tipo declarado do parâmetro). Sem o campo
 * no tipo, o compilador não garante que o select do Prisma o inclua — o dado chega por
 * sorte via runtime. Este teste trava o contrato.
 */

import { DeviceConfigPublisherService } from './device-config-publisher.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Ponto de saúde mínimo de uma controladora SCA. */
function fakePoint(tag: string, metric: string) {
  return {
    tag,
    objectType: 'AV',
    instance: 0,
    unit: '%',
    binding: { metric, oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1 },
  };
}

/** Device fake representando uma controladora SCA. */
function fakeScaDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ctrl-1',
    name: 'Controladora Recepção',
    protocol: 'snmp' as const,
    ip: '192.168.0.100',
    port: 161,
    tenantId: 'tenant-1',
    gatewayId: 'gw-1',
    monitoredDeviceType: 'ACCESS_CONTROLLER' as const,
    config: { snmpVersion: '2c', community: 'public', manufacturer: null },
    points: [
      fakePoint('STATUS', 'status'),
      fakePoint('CPU', 'cpu'),
      fakePoint('MEM', 'memory'),
    ],
    ...overrides,
  };
}

/** PrismaService mínimo — findMany retorna os devices fornecidos. */
function buildPrismaMock(devices: ReturnType<typeof fakeScaDevice>[]) {
  return {
    device: {
      findMany: jest.fn().mockResolvedValue(devices),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
}

/** MqttService mínimo — captura os payloads publicados. */
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

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('DeviceConfigPublisherService — SCA (ACCESS_CONTROLLER)', () => {
  it('publica monitoredDeviceType="ACCESS_CONTROLLER" no bloco de config da controladora', async () => {
    const device = fakeScaDevice();
    const prisma = buildPrismaMock([device]);
    const { mock: published, service: mqtt } = buildMqttMock();

    const publisher = new DeviceConfigPublisherService(
      prisma as never,
      mqtt as never,
    );

    await publisher.publishForGateway('tenant-1', 'gw-1');

    expect(published).toHaveLength(1);
    const payload = published[0].payload as {
      devices: Array<Record<string, unknown>>;
    };
    expect(payload.devices).toHaveLength(1);

    const block = payload.devices[0];
    expect(block.protocol).toBe('snmp');
    expect(block.monitoredDeviceType).toBe('ACCESS_CONTROLLER');
  });

  it('controladora SCA com monitoredDeviceType null usa "CAMERA" como fallback', async () => {
    // Fallback defensivo: devices sem monitoredDeviceType (e.g. pré-migração) não
    // devem quebrar o gateway — 'CAMERA' é o padrão histórico.
    const device = fakeScaDevice({ monitoredDeviceType: null });
    const prisma = buildPrismaMock([device as ReturnType<typeof fakeScaDevice>]);
    const { mock: published, service: mqtt } = buildMqttMock();

    const publisher = new DeviceConfigPublisherService(
      prisma as never,
      mqtt as never,
    );

    await publisher.publishForGateway('tenant-1', 'gw-1');

    const payload = published[0].payload as {
      devices: Array<Record<string, unknown>>;
    };
    expect(payload.devices[0].monitoredDeviceType).toBe('CAMERA');
  });

  it('controladora SCA satisfaz ONLY_ACCESS_CONTROLLER_DEVICES se filtro for aplicado', () => {
    // Este teste documenta a integração do campo com os filtros Prisma —
    // não chama Prisma real; apenas verifica a constante do filtro.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ONLY_ACCESS_CONTROLLER_DEVICES } = require('../../prisma/device-filters.js') as {
      ONLY_ACCESS_CONTROLLER_DEVICES: { monitoredDeviceType: string };
    };
    expect(ONLY_ACCESS_CONTROLLER_DEVICES.monitoredDeviceType).toBe('ACCESS_CONTROLLER');
  });
});
