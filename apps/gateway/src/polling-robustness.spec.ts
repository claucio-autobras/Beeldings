import { ConfigService } from '@nestjs/config';
import { BacnetPollingService } from './bacnet/application/bacnet-polling.service';
import { ModbusPollingService } from './modbus/modbus-polling.service';
import { SnmpPollingService } from './snmp/snmp-polling.service';
import { OnvifPollingService } from './onvif/onvif-polling.service';
import type ModbusRTU from 'modbus-serial';

/**
 * Prova de robustez dos loops de polling: uma exceção inesperada no meio de um
 * ciclo (driver que lança) é logada e NÃO escapa como unhandled rejection —
 * o guard de busy é sempre liberado e o próximo ciclo roda normalmente.
 */

const configStub = {
  get: (_key: string, def?: string) => def,
} as unknown as ConfigService;

const metricsStub = {
  record: jest.fn(),
  recordSkipped: jest.fn(),
} as never;

const mqttStub = { publish: jest.fn() } as never;

describe('Isolamento dos ciclos de polling', () => {
  beforeEach(() => jest.clearAllMocks());

  it('BACnet: exceção no meio do ciclo não rejeita e libera o busy', async () => {
    const bacnetClient = {
      readPropertyMultipleSafe: jest.fn().mockImplementation(() => {
        throw new Error('driver explodiu no meio do ciclo');
      }),
      readPropertySafe: jest.fn().mockRejectedValue(new Error('boom')),
    } as never;
    const svc = new BacnetPollingService(bacnetClient, mqttStub, configStub, metricsStub);

    const state = { busy: false };
    const device = {
      id: 'dev-1',
      name: 'CLP',
      deviceInstance: 1,
      ipAddress: '10.0.0.5',
      port: 47808,
      net: null,
      adr: null,
      pollingIntervalMs: 15_000,
      objects: [],
      covSubscriptions: [],
    };
    const objects = [
      { tag: 'temp', objectType: 0, objectInstance: 1, property: 85, unit: null, useCov: false },
    ];

    const pollDevice = (
      svc as unknown as {
        pollDevice(s: typeof state, d: typeof device, o: typeof objects): Promise<void>;
      }
    ).pollDevice.bind(svc);

    // Não pode rejeitar (o disparo real é `void pollDevice(...)`).
    await expect(pollDevice(state, device, objects)).resolves.toBeUndefined();
    expect(state.busy).toBe(false);

    // Próximo ciclo roda normalmente (busy não ficou preso).
    await expect(pollDevice(state, device, objects)).resolves.toBeUndefined();
    expect(state.busy).toBe(false);
  });

  it('SNMP: driver que lança não rejeita e libera o polling', async () => {
    const svc = new SnmpPollingService(mqttStub, configStub, metricsStub);
    const state = {
      handle: undefined as never,
      startTimeout: null,
      polling: false,
      driver: {
        runCycle: jest.fn().mockRejectedValue(new Error('driver explodiu')),
        dispose: jest.fn(),
        profileId: null,
      },
    };
    const device = {
      deviceId: 'snmp-1',
      name: 'Câmera',
      ip: '10.0.0.9',
      port: 161,
      snmpVersion: '2c' as const,
      community: 'public',
      pollingIntervalMs: 30_000,
      points: [],
    };

    const pollDevice = (
      svc as unknown as {
        pollDevice(s: unknown, d: typeof device): Promise<void>;
      }
    ).pollDevice.bind(svc);

    await expect(pollDevice(state, device)).resolves.toBeUndefined();
    expect(state.polling).toBe(false);
    await expect(pollDevice(state, device)).resolves.toBeUndefined();
    expect(state.polling).toBe(false);
  });

  it('ONVIF: collect() que rejeita não derruba o ciclo e libera o polling', async () => {
    const svc = new OnvifPollingService(mqttStub, configStub, metricsStub);
    const state = {
      handle: null,
      startTimeout: null,
      polling: false,
      driver: {
        disposed: false,
        deviceId: 'cam-1',
        collect: jest.fn().mockRejectedValue(new Error('callback pendurado estourou timeout')),
        dispose: jest.fn(),
      },
      intervalMs: 30_000,
      configKey: 'k',
    };

    const pollDevice = (
      svc as unknown as { pollDevice(s: unknown): Promise<void> }
    ).pollDevice.bind(svc);

    await expect(pollDevice(state)).resolves.toBeUndefined();
    expect(state.polling).toBe(false);
    // Próximo ciclo volta a tentar (câmera não fica presa em busy).
    await expect(pollDevice(state)).resolves.toBeUndefined();
    expect(state.driver.collect).toHaveBeenCalledTimes(2);
  });
});

describe('Modbus TCP — invalidação da conexão após timeout', () => {
  const serialStub = { acquire: jest.fn(), release: jest.fn(), run: jest.fn() } as never;

  const makeDevice = () => ({
    deviceId: 'plc-1',
    name: 'CLP',
    protocol: 'modbus',
    ip: '10.0.0.20',
    port: 502,
    unitId: 1,
    pollingIntervalMs: 15_000,
    registers: [
      {
        tag: 'temp',
        register: 40001,
        registerType: 'holding' as const,
        dataType: 'uint16' as const,
        endianness: 'big' as const,
        scale: 1,
        offset: 0,
        unit: null,
      },
    ],
  });

  const makeState = (client: unknown) => ({
    client: client as ModbusRTU,
    handle: undefined as never,
    startTimeout: null,
    connecting: false,
    busy: false,
  });

  const runCycle = (svc: ModbusPollingService, state: unknown, device: unknown) =>
    (
      svc as unknown as {
        runPollCycle(s: unknown, d: unknown): Promise<void>;
      }
    ).runPollCycle(state, device);

  it('timeout de leitura fecha e descarta o client (próximo ciclo reconecta limpo)', async () => {
    const svc = new ModbusPollingService(mqttStub, configStub, metricsStub, serialStub);
    let closed = false;
    const zombieClient = {
      isOpen: true, // socket zumbi: parece aberto mas não responde
      readHoldingRegisters: jest.fn().mockRejectedValue(new Error('Timed out')),
      close: (cb: () => void) => {
        closed = true;
        cb();
      },
    };
    const state = makeState(zombieClient);

    await runCycle(svc, state, makeDevice());

    expect(closed).toBe(true);
    // Client foi substituído — o próximo ensureConnected reconecta do zero.
    expect(state.client).not.toBe(zombieClient);
    expect(state.client.isOpen).toBe(false);
  });

  it('exceção Modbus de dados (illegal address) NÃO invalida a conexão', async () => {
    const svc = new ModbusPollingService(mqttStub, configStub, metricsStub, serialStub);
    const client = {
      isOpen: true,
      readHoldingRegisters: jest
        .fn()
        .mockRejectedValue(new Error('Modbus exception 2: Illegal data address')),
      close: jest.fn(),
    };
    const state = makeState(client);

    await runCycle(svc, state, makeDevice());

    // Split-on-error atual preservado: registrador é pulado, conexão mantida.
    expect(client.close).not.toHaveBeenCalled();
    expect(state.client).toBe(client as unknown as ModbusRTU);
  });
});
