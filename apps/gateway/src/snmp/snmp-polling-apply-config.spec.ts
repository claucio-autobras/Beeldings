/**
 * SnmpPollingService.applyConfig — diff de config e primeira leitura pronta.
 *
 * Regras verificadas:
 *  1. Config inicial (retida, pós-boot) usa jitter CHEIO (janela = intervalo)
 *     — restart do gateway com muitos devices não vira rajada.
 *  2. Republicar a MESMA config não reinicia o poll (preserva o estado do
 *     driver: cache de identificação, amostras de counter, fase do jitter).
 *  3. Device NOVO ou ALTERADO após a config inicial parte com jitter numa
 *     janela curta (≤ 5s) — a primeira leitura chega em segundos.
 *  4. Device removido da config tem o poll encerrado.
 */

jest.mock('./snmp-read.util', () => ({
  readSnmpOids: jest.fn(),
  readSnmpStrings: jest.fn(),
  readSnmpTable: jest.fn(),
}));

jest.mock('../observability/poll-jitter.util', () => ({
  computeStartJitterMs: jest.fn(() => 1_000),
}));

import { SnmpPollingService } from './snmp-polling.service';
import { computeStartJitterMs } from '../observability/poll-jitter.util';

const jitterMock = computeStartJitterMs as jest.Mock;

function buildService() {
  const mqttService = { publish: jest.fn() };
  const configService = { get: (_k: string, d: string) => d };
  const pollingMetrics = { record: jest.fn(), recordSkipped: jest.fn() };
  return new SnmpPollingService(
    mqttService as any,
    configService as any,
    pollingMetrics as any,
  );
}

function deviceBlock(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: 'ctrl-1',
    name: 'Controladora',
    protocol: 'snmp',
    ip: '10.0.0.50',
    port: 161,
    snmpVersion: '2c' as const,
    community: 'public',
    pollingIntervalMs: 30_000,
    monitoredDeviceType: 'ACCESS_CONTROLLER',
    manufacturer: 'Control iD',
    points: [
      { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
      { tag: 'CPU', metric: 'cpu', oid: null, scale: 1, unit: '%' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jitterMock.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SnmpPollingService.applyConfig — diff + primeira leitura pronta', () => {
  it('config inicial usa jitter cheio (janela = intervalo do device)', () => {
    const service = buildService();

    (service as any).applyConfig([deviceBlock()]);

    expect(jitterMock).toHaveBeenCalledTimes(1);
    expect(jitterMock).toHaveBeenCalledWith('ctrl-1', 30_000);

    (service as any).onModuleDestroy();
  });

  it('mesma config republicada NÃO reinicia o poll (estado preservado)', () => {
    const service = buildService();

    (service as any).applyConfig([deviceBlock()]);
    const stateBefore = (service as any).activePolls.get('ctrl-1');

    (service as any).applyConfig([deviceBlock()]);
    const stateAfter = (service as any).activePolls.get('ctrl-1');

    expect(stateAfter).toBe(stateBefore); // mesmo objeto — não reiniciou
    expect(jitterMock).toHaveBeenCalledTimes(1);

    (service as any).onModuleDestroy();
  });

  it('device NOVO após a config inicial parte com janela curta (≤5s)', () => {
    const service = buildService();

    (service as any).applyConfig([deviceBlock()]);
    jitterMock.mockClear();

    (service as any).applyConfig([
      deviceBlock(),
      deviceBlock({ deviceId: 'ctrl-2', ip: '10.0.0.51' }),
    ]);

    // Só o novo device (re)inicia — e com a janela encurtada de 5s.
    expect(jitterMock).toHaveBeenCalledTimes(1);
    expect(jitterMock).toHaveBeenCalledWith('ctrl-2', 5_000);

    (service as any).onModuleDestroy();
  });

  it('device ALTERADO reinicia com janela curta; intervalo menor que 5s usa o intervalo', () => {
    const service = buildService();

    (service as any).applyConfig([deviceBlock()]);
    jitterMock.mockClear();

    // Mudança real de config (ponto novo) → reinicia prontamente.
    (service as any).applyConfig([
      deviceBlock({
        points: [
          { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
          { tag: 'CPU', metric: 'cpu', oid: null, scale: 1, unit: '%' },
          { tag: 'TEMPERATURA', metric: 'temperature', oid: null, scale: 1, unit: '°C' },
        ],
      }),
    ]);
    expect(jitterMock).toHaveBeenCalledWith('ctrl-1', 5_000);

    jitterMock.mockClear();
    // Intervalo de 3s < janela de 5s → usa o próprio intervalo.
    (service as any).applyConfig([deviceBlock({ pollingIntervalMs: 3_000 })]);
    expect(jitterMock).toHaveBeenCalledWith('ctrl-1', 3_000);

    (service as any).onModuleDestroy();
  });

  it('device removido da config tem o poll encerrado', () => {
    const service = buildService();

    (service as any).applyConfig([
      deviceBlock(),
      deviceBlock({ deviceId: 'ctrl-2', ip: '10.0.0.51' }),
    ]);
    expect((service as any).activePolls.has('ctrl-2')).toBe(true);

    (service as any).applyConfig([deviceBlock()]);
    expect((service as any).activePolls.has('ctrl-2')).toBe(false);
    expect((service as any).activePolls.has('ctrl-1')).toBe(true);

    (service as any).onModuleDestroy();
  });
});
