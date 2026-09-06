import { AutomationRunnerService } from './automation-runner.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BacnetWriteService } from '../../devices/application/bacnet-write.service.js';
import type { ModbusWriteService } from '../../devices/application/modbus-write.service.js';
import type { MqttWriteService } from '../../devices/application/mqtt-write.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { ClusterService } from '../../cluster/cluster.service.js';
import type { PointValueCacheService } from './point-value-cache.service.js';

/**
 * Testes do ramo Modbus do AutomationRunnerService: escrita holding/coil via
 * ModbusWriteService (mesmo caminho do POST /devices/modbus/write), falha com
 * binding incompleto/registrador somente-leitura, idempotência CONTINUOUS,
 * reverse de coil no término e auditoria de FAILURE quando o gateway responde
 * erro (success:false em HTTP 200).
 */
describe('AutomationRunnerService — escrita Modbus', () => {
  let service: AutomationRunnerService;
  let prismaMock: Record<string, any>;
  let modbusWriteMock: { writeModbus: jest.Mock };
  let mqttWriteMock: { writeMqtt: jest.Mock };
  let bacnetWriteMock: { writeBacnet: jest.Mock };
  let auditMock: { record: jest.Mock };
  let cacheMock: { get: jest.Mock };
  let clusterMock: { publish: jest.Mock };

  const tenantId = 'tenant-a';

  const makeDevice = (overrides: Record<string, unknown> = {}) => ({
    id: 'dev-1',
    tenantId,
    name: 'CLP Chiller',
    protocol: 'modbus',
    gatewayId: 'gw-1',
    ip: '10.0.0.10',
    port: 502,
    config: { connectionType: 'tcp', unitId: 3 },
    ...overrides,
  });

  const makePoint = (overrides: Record<string, unknown> = {}) => ({
    id: 'pt-1',
    deviceId: 'dev-1',
    tag: 'setpoint_temp',
    unit: '°C',
    instance: 100,
    objectType: 'holding',
    binding: {
      register: 100,
      registerType: 'holding',
      dataType: 'float32',
      endianness: 'big',
      scale: 1,
      offset: 0,
    },
    ...overrides,
  });

  const makeAutomation = (overrides: Record<string, unknown> = {}) => ({
    id: 'auto-1',
    tenantId,
    name: 'Ajuste Temperatura',
    enabled: true,
    mode: 'ONESHOT',
    priority: 8,
    condition: null,
    actions: [
      {
        id: 'act-1',
        type: 'WRITE_POINT',
        branch: 'ALWAYS',
        order: 0,
        targetPointId: 'pt-1',
        value: 22.5,
        delaySeconds: 0,
        config: null,
      },
    ],
    ...overrides,
  });

  let automation: ReturnType<typeof makeAutomation>;
  let point: ReturnType<typeof makePoint>;

  beforeEach(() => {
    automation = makeAutomation();
    point = { ...makePoint(), device: makeDevice() } as any;

    prismaMock = {
      automation: {
        findUnique: jest.fn(async () => automation),
        update: jest.fn(async () => ({})),
      },
      devicePoint: {
        findUnique: jest.fn(async () => point),
      },
      automationRun: {
        create: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({})),
      },
      alarmEvent: {
        create: jest.fn(async () => ({
          id: 'evt-1',
          tenantId,
          state: 'ACTIVE',
          activatedAt: new Date(),
        })),
      },
    };
    modbusWriteMock = {
      writeModbus: jest.fn(async () => ({ success: true, command_id: 'cmd-1' })),
    };
    mqttWriteMock = {
      writeMqtt: jest.fn(async () => ({ success: true, command_id: 'cmd-m1', confirmed: true })),
    };
    bacnetWriteMock = { writeBacnet: jest.fn() };
    auditMock = { record: jest.fn(async () => undefined) };
    cacheMock = { get: jest.fn() };
    clusterMock = { publish: jest.fn(async () => undefined) };

    service = new AutomationRunnerService(
      prismaMock as unknown as PrismaService,
      bacnetWriteMock as unknown as BacnetWriteService,
      modbusWriteMock as unknown as ModbusWriteService,
      mqttWriteMock as unknown as MqttWriteService,
      auditMock as unknown as AuditService,
      cacheMock as unknown as PointValueCacheService,
      clusterMock as unknown as ClusterService,
    );
  });

  it('escreve holding register via ModbusWriteService com valor de engenharia', async () => {
    await service.run('auto-1', 'agenda');

    expect(modbusWriteMock.writeModbus).toHaveBeenCalledTimes(1);
    const req = modbusWriteMock.writeModbus.mock.calls[0][0];
    expect(req).toMatchObject({
      tenantId,
      gatewayId: 'gw-1',
      deviceId: 'dev-1',
      connectionType: 'tcp',
      unitId: 3,
      register: 100,
      registerType: 'holding',
      dataType: 'float32',
      value: 22.5,
      pointTag: 'setpoint_temp',
    });
    expect(bacnetWriteMock.writeBacnet).not.toHaveBeenCalled();
    // Auditoria de sucesso, igual ao ramo BACnet.
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COMMAND', result: 'SUCCESS', entityName: 'setpoint_temp' }),
    );
    expect(prismaMock.automation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastRunResult: 'SUCCESS' }) }),
    );
    expect(prismaMock.automationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ result: 'SUCCESS' }) }),
    );
  });

  it('escreve coil (digital) e inverte no término (reverse)', async () => {
    automation.actions[0].value = true as any;
    point.binding = { register: 5, registerType: 'coil' } as any;

    await service.run('auto-1', 'término', true);

    const req = modbusWriteMock.writeModbus.mock.calls[0][0];
    expect(req.registerType).toBe('coil');
    // reverse de digital: true → 0
    expect(req.value).toBe(0);
  });

  it('reverse NÃO escreve em holding (analógico) — ação é pulada', async () => {
    await service.run('auto-1', 'término', true);
    expect(modbusWriteMock.writeModbus).not.toHaveBeenCalled();
  });

  it('propaga config RTU (serial) do device', async () => {
    (point as any).device = makeDevice({
      config: {
        connectionType: 'rtu',
        unitId: 7,
        serial: { path: '/dev/ttyUSB0', baudRate: 9600, parity: 'none', dataBits: 8, stopBits: 1 },
      },
    });

    await service.run('auto-1', 'agenda');

    const req = modbusWriteMock.writeModbus.mock.calls[0][0];
    expect(req.connectionType).toBe('rtu');
    expect(req.unitId).toBe(7);
    expect(req.serial).toMatchObject({ path: '/dev/ttyUSB0', baudRate: 9600 });
  });

  it('falha com mensagem clara e audita FAILURE em registrador somente-leitura', async () => {
    point.binding = { register: 1, registerType: 'input' } as any;

    await service.run('auto-1', 'agenda');

    expect(modbusWriteMock.writeModbus).not.toHaveBeenCalled();
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'FAILURE',
        change: expect.stringContaining('somente leitura'),
      }),
    );
    expect(prismaMock.automation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastRunResult: 'FAILURE' }) }),
    );
  });

  it('falha com cadastro incompleto: RTU sem serial', async () => {
    (point as any).device = makeDevice({ config: { connectionType: 'rtu', unitId: 1 } });

    await service.run('auto-1', 'agenda');

    expect(modbusWriteMock.writeModbus).not.toHaveBeenCalled();
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'FAILURE',
        change: expect.stringContaining('porta serial'),
      }),
    );
  });

  it('audita FAILURE quando o gateway responde success:false (HTTP 200)', async () => {
    modbusWriteMock.writeModbus.mockResolvedValueOnce({
      success: false,
      error: 'Timeout - gateway nao respondeu em 20s',
    });

    await service.run('auto-1', 'agenda');

    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'FAILURE',
        change: expect.stringContaining('Timeout'),
      }),
    );
    expect(prismaMock.automation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastRunResult: 'FAILURE' }) }),
    );
  });

  it('CONTINUOUS é idempotente: só escreve quando o valor-alvo muda', async () => {
    automation = makeAutomation({
      mode: 'CONTINUOUS',
      condition: { pointId: 'pt-cond', operator: 'GT', value: 25 },
      actions: [
        {
          id: 'act-1',
          type: 'WRITE_POINT',
          branch: 'ON_TRUE',
          order: 0,
          targetPointId: 'pt-1',
          value: 22.5,
          delaySeconds: 0,
          config: null,
        },
      ],
    });
    // Condição: ponto de condição existe e o cache devolve valor > 25 (TRUE).
    prismaMock.devicePoint.findUnique = jest.fn(async ({ where }: any) =>
      where.id === 'pt-cond'
        ? { id: 'pt-cond', deviceId: 'dev-c', objectType: 'holding', instance: 0, tag: 'temp' }
        : point,
    );
    cacheMock.get.mockReturnValue(30);

    await service.run('auto-1', 'enquanto');
    await service.run('auto-1', 'enquanto');

    // Segunda execução com o mesmo valor-alvo é pulada (idempotência).
    expect(modbusWriteMock.writeModbus).toHaveBeenCalledTimes(1);
  });

  /**
   * Ramo MQTT: escrita via MqttWriteService (mesmo caminho do POST
   * /devices/mqtt/write), binding de escrita obrigatório, valueType respeitado
   * (boolean vs number), idempotência CONTINUOUS, reverse de boolean no término
   * e auditoria de FAILURE quando o gateway responde erro/timeout.
   */
  describe('escrita MQTT', () => {
    const makeMqttDevice = (overrides: Record<string, unknown> = {}) =>
      makeDevice({
        id: 'dev-m',
        name: 'Relé Shelly',
        protocol: 'mqtt',
        gatewayId: 'gw-1',
        config: {},
        ...overrides,
      });

    const mqttBinding = (overrides: Record<string, unknown> = {}) => ({
      valueType: 'boolean',
      write: {
        commandTopic: 'bluebee/tenant-a/gateway/gw-1/sensors/shelly/rpc',
        payloadTemplate: '{"id":{{id}},"method":"Switch.Set","params":{"id":0,"on":{{value}}}}',
        responseTopic: 'bluebee/tenant-a/gateway/gw-1/sensors/shelly/rpc/resp',
      },
      ...overrides,
    });

    beforeEach(() => {
      point = {
        ...makePoint({ id: 'pt-1', tag: 'rele_01', unit: null, binding: mqttBinding() }),
        device: makeMqttDevice(),
      } as any;
      automation.actions[0].value = true as any;
    });

    it('escreve boolean via MqttWriteService respeitando o valueType', async () => {
      await service.run('auto-1', 'agenda');

      expect(mqttWriteMock.writeMqtt).toHaveBeenCalledTimes(1);
      const req = mqttWriteMock.writeMqtt.mock.calls[0][0];
      expect(req).toMatchObject({
        tenantId,
        gatewayId: 'gw-1',
        deviceId: 'dev-m',
        valueType: 'boolean',
        value: true,
        pointTag: 'rele_01',
      });
      expect(req.write.commandTopic).toContain('/sensors/shelly/rpc');
      expect(modbusWriteMock.writeModbus).not.toHaveBeenCalled();
      expect(bacnetWriteMock.writeBacnet).not.toHaveBeenCalled();
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'COMMAND', result: 'SUCCESS', entityName: 'rele_01' }),
      );
      expect(prismaMock.automationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ result: 'SUCCESS' }) }),
      );
    });

    it('escreve number quando o valueType do binding é number', async () => {
      point.binding = mqttBinding({ valueType: 'number' }) as any;
      automation.actions[0].value = 75 as any;

      await service.run('auto-1', 'agenda');

      const req = mqttWriteMock.writeMqtt.mock.calls[0][0];
      expect(req.valueType).toBe('number');
      expect(req.value).toBe(75);
    });

    it('reverse inverte boolean no término (true → false)', async () => {
      await service.run('auto-1', 'término', true);

      const req = mqttWriteMock.writeMqtt.mock.calls[0][0];
      expect(req.value).toBe(false);
    });

    it('reverse NÃO escreve em ponto number (analógico) — ação é pulada', async () => {
      point.binding = mqttBinding({ valueType: 'number' }) as any;
      automation.actions[0].value = 75 as any;

      await service.run('auto-1', 'término', true);
      expect(mqttWriteMock.writeMqtt).not.toHaveBeenCalled();
    });

    it('falha com mensagem clara e audita FAILURE quando o ponto não tem binding de escrita', async () => {
      point.binding = { valueType: 'boolean' } as any;

      await service.run('auto-1', 'agenda');

      expect(mqttWriteMock.writeMqtt).not.toHaveBeenCalled();
      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'FAILURE',
          change: expect.stringContaining('não é comandável'),
        }),
      );
      expect(prismaMock.automation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastRunResult: 'FAILURE' }) }),
      );
    });

    it('audita FAILURE quando o gateway responde success:false (HTTP 200 / timeout)', async () => {
      mqttWriteMock.writeMqtt.mockResolvedValueOnce({
        success: false,
        error: 'Timeout - gateway nao respondeu em 20s',
      });

      await service.run('auto-1', 'agenda');

      expect(auditMock.record).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'FAILURE',
          change: expect.stringContaining('Timeout'),
        }),
      );
      expect(prismaMock.automation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastRunResult: 'FAILURE' }) }),
      );
    });

    it('CONTINUOUS é idempotente: só escreve quando o valor-alvo muda', async () => {
      automation = makeAutomation({
        mode: 'CONTINUOUS',
        condition: { pointId: 'pt-cond', operator: 'GT', value: 25 },
        actions: [
          {
            id: 'act-m1',
            type: 'WRITE_POINT',
            branch: 'ON_TRUE',
            order: 0,
            targetPointId: 'pt-1',
            value: true,
            delaySeconds: 0,
            config: null,
          },
        ],
      });
      prismaMock.devicePoint.findUnique = jest.fn(async ({ where }: any) =>
        where.id === 'pt-cond'
          ? { id: 'pt-cond', deviceId: 'dev-c', objectType: 'holding', instance: 0, tag: 'temp' }
          : point,
      );
      cacheMock.get.mockReturnValue(30);

      await service.run('auto-1', 'enquanto');
      await service.run('auto-1', 'enquanto');

      expect(mqttWriteMock.writeMqtt).toHaveBeenCalledTimes(1);
    });
  });
});
