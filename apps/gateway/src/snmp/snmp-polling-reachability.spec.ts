/**
 * SnmpPollingService — pontos sintéticos de alcançabilidade.
 *
 * Trava o contrato:
 *  1. Ponto metric='reachability'         → value = successPercent() (0–100).
 *  2. Ponto metric='reachability_latency' → value = latência em ms (null offline).
 *  3. Ponto metric='reachability_failure_rate' → value = failurePercent() (0–100).
 *  4. Cada ponto publicado apenas se EXPLICITAMENTE configurado (não assume tag).
 *  5. Device sem pontos sintéticos → nenhum ponto extra.
 *  6. restrictToBindings=true preservado — reachability ainda funciona.
 *  7. Device offline → reachability=0%, latency=null, failure_rate=100%.
 *  8. Mix online/offline → successPercent e failurePercent corretos.
 *  9. reachability_latency NÃO publicado quando não configurado.
 * 10. Múltiplos pontos sintéticos configurados simultaneamente.
 */

jest.mock('./snmp-read.util', () => ({
  readSnmpOids: jest.fn(),
  readSnmpStrings: jest.fn(),
  readSnmpTable: jest.fn(),
}));

import { SnmpPollingService } from './snmp-polling.service';
import { readSnmpOids } from './snmp-read.util';
import { SnmpDriver } from '../drivers/snmp.driver';
import { ReachabilityTracker } from './reachability-tracker';

const readSnmpOidsMock = readSnmpOids as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildService() {
  const published: Array<{ topic: string; payload: any }> = [];
  const mqttService = { publish: (t: string, p: unknown) => published.push({ topic: t, payload: p }) };
  const configService = { get: (_k: string, d: string) => d };
  const pollingMetrics = { record: jest.fn(), recordSkipped: jest.fn() };
  const service = new SnmpPollingService(mqttService as any, configService as any, pollingMetrics as any);
  return { service, published };
}

function makeIo(online: boolean) {
  return {
    readStrings: jest.fn().mockResolvedValue([null, null]),
    readNumbers: jest.fn().mockResolvedValue(online ? new Array(10).fill(null).map((_, i) => i) : null),
    pingLoss: jest.fn().mockResolvedValue(null),
    isapiUptime: jest.fn().mockResolvedValue(null),
  };
}

function buildState(online = true) {
  const tracker = new ReachabilityTracker(5 * 60 * 1000);
  return {
    polling: false,
    driver: new SnmpDriver(makeIo(online)),
    reachabilityTracker: tracker,
    configKey: 'test',
    handle: null as any,
    startTimeout: null,
  };
}

const DEVICE_BASE = {
  deviceId: 'cam-1',
  name: 'Camera',
  protocol: 'snmp' as const,
  ip: '10.0.0.1',
  port: 161,
  snmpVersion: '2c' as const,
  community: 'public',
  pollingIntervalMs: 30_000,
};

// ─── Testes ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  readSnmpOidsMock.mockReset();
});

describe('SnmpPollingService — pontos sintéticos de alcançabilidade', () => {

  it('1. ponto metric=reachability → value=successPercent (100% após 1 sucesso)', async () => {
    readSnmpOidsMock.mockResolvedValue([1, 2, 3, 4, 5]);
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
        { tag: 'REACH', metric: 'reachability', oid: null, scale: 1, unit: '%' },
      ],
    };

    const state = buildState(true);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    expect(points).toBeDefined();
    const reachPt = points.find((p: any) => p.tag === 'REACH');
    expect(reachPt).toBeDefined();
    expect(reachPt.value).toBe(100); // 1 sucesso / 1 total = 100%
    expect(reachPt.source).toBe('reachability');
    expect(reachPt.unit).toBe('%');
  });

  it('2. metric=reachability_latency → value=número (ms) quando online', async () => {
    readSnmpOidsMock.mockResolvedValue([1, 2, 3, 4, 5]);
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'REACH', metric: 'reachability', oid: null, scale: 1, unit: '%' },
        { tag: 'LAT', metric: 'reachability_latency', oid: null, scale: 1, unit: 'ms' },
      ],
    };

    const state = buildState(true);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    const latPt = points.find((p: any) => p.tag === 'LAT');
    expect(latPt).toBeDefined();
    expect(latPt.unit).toBe('ms');
    // Online: latência é número (tempo real do ciclo)
    expect(typeof latPt.value).toBe('number');
    expect(latPt.value).toBeGreaterThanOrEqual(0);
  });

  it('3. metric=reachability_failure_rate → value=failurePercent (0% após 1 sucesso)', async () => {
    readSnmpOidsMock.mockResolvedValue([1, 2, 3]);
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'FAIL_RATE', metric: 'reachability_failure_rate', oid: null, scale: 1, unit: '%' },
      ],
    };

    const state = buildState(true);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    const failPt = points.find((p: any) => p.tag === 'FAIL_RATE');
    expect(failPt).toBeDefined();
    expect(failPt.value).toBe(0); // 1 sucesso / 1 total = 0% falha
    expect(failPt.unit).toBe('%');
    expect(failPt.source).toBe('reachability');
  });

  it('4. cada métrica publicada apenas com tag configurada (não assume nomenclatura)', async () => {
    readSnmpOidsMock.mockResolvedValue([1, 2, 3]);
    const { service, published } = buildService();

    // Tags arbitrárias — NÃO seguem convenção _latency/_failure_rate
    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'DISPONIBILIDADE', metric: 'reachability',          oid: null, scale: 1, unit: '%' },
        { tag: 'LATENCIA_SNMP',   metric: 'reachability_latency',  oid: null, scale: 1, unit: 'ms' },
        { tag: 'TAXA_FALHA',      metric: 'reachability_failure_rate', oid: null, scale: 1, unit: '%' },
      ],
    };

    const state = buildState(true);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    expect(points.find((p: any) => p.tag === 'DISPONIBILIDADE')).toBeDefined();
    expect(points.find((p: any) => p.tag === 'LATENCIA_SNMP')).toBeDefined();
    expect(points.find((p: any) => p.tag === 'TAXA_FALHA')).toBeDefined();
  });

  it('5. device SEM pontos sintéticos → nenhum ponto extra publicado', async () => {
    readSnmpOidsMock.mockResolvedValue([1, 2, 3, 4]);
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
        { tag: 'CPU', metric: 'cpu', oid: '1.1', scale: 1, unit: '%' },
      ],
    };

    const state = buildState(true);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    const reachPts = points.filter((p: any) => p.source === 'reachability');
    expect(reachPts).toHaveLength(0);
  });

  it('6. restrictToBindings=true preservado — reachability ainda funciona', async () => {
    readSnmpOidsMock.mockResolvedValue([1, 2]);
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      restrictToBindings: true,
      points: [
        { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
        { tag: 'REACH', metric: 'reachability', oid: null, scale: 1, unit: '%' },
      ],
    };

    const state = buildState(true);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    const reachPt = points.find((p: any) => p.tag === 'REACH');
    expect(reachPt).toBeDefined();
    expect(reachPt.value).toBe(100);
  });

  it('7. device OFFLINE → reachability=0%, latency=null, failure_rate=100%', async () => {
    readSnmpOidsMock.mockResolvedValue(null); // timeout
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'REACH',    metric: 'reachability',          oid: null, scale: 1, unit: '%' },
        { tag: 'LAT',      metric: 'reachability_latency',  oid: null, scale: 1, unit: 'ms' },
        { tag: 'FAIL',     metric: 'reachability_failure_rate', oid: null, scale: 1, unit: '%' },
      ],
    };

    const state = buildState(false);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    const reachPt = points.find((p: any) => p.tag === 'REACH');
    const latPt   = points.find((p: any) => p.tag === 'LAT');
    const failPt  = points.find((p: any) => p.tag === 'FAIL');

    expect(reachPt?.value).toBe(0);    // 1 falha / 1 total = 0%
    expect(latPt?.value).toBeNull();   // offline: latência não é publicada como timeout
    expect(failPt?.value).toBe(100);   // 100% falha
  });

  it('8. mix online/offline → successPercent e failurePercent corretos', async () => {
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'REACH',    metric: 'reachability',             oid: null, scale: 1, unit: '%' },
        { tag: 'FAIL',     metric: 'reachability_failure_rate', oid: null, scale: 1, unit: '%' },
      ],
    };

    const ioReadNumbers = jest.fn();
    const tracker = new ReachabilityTracker(5 * 60 * 1000);
    const driver = new SnmpDriver({
      readStrings: jest.fn().mockResolvedValue([null, null]),
      readNumbers: ioReadNumbers,
      pingLoss: jest.fn().mockResolvedValue(null),
      isapiUptime: jest.fn().mockResolvedValue(null),
    });
    const state = { polling: false, driver, reachabilityTracker: tracker, configKey: 'test', handle: null as any, startTimeout: null };

    // 2 ciclos bem-sucedidos.
    ioReadNumbers.mockResolvedValue([1, 2, 3]);
    await (service as any).pollDevice(state, device);
    await (service as any).pollDevice(state, device);

    // 3 ciclos offline (timeout → null).
    ioReadNumbers.mockResolvedValue(null);
    await (service as any).pollDevice(state, device);
    await (service as any).pollDevice(state, device);
    await (service as any).pollDevice(state, device);

    // Último ciclo: 2/5 = 40% sucesso, 60% falha.
    const lastPoints = published[published.length - 1]?.payload?.points as any[];
    const reachPt = lastPoints.find((p: any) => p.tag === 'REACH');
    const failPt  = lastPoints.find((p: any) => p.tag === 'FAIL');
    expect(reachPt.value).toBeCloseTo(40);
    expect(failPt.value).toBeCloseTo(60);
  });

  it('9. reachability_latency NÃO publicado quando não configurado', async () => {
    readSnmpOidsMock.mockResolvedValue([1, 2, 3, 4, 5]);
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'REACH', metric: 'reachability', oid: null, scale: 1, unit: '%' },
        // SEM reachability_latency configurado
      ],
    };

    const state = buildState(true);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    // Não deve haver nenhum ponto de latência sintético
    const latPts = points.filter((p: any) => p.metric === 'reachability_latency' || p.source === 'reachability_latency');
    // O único ponto de reachability source deve ser o success %
    const synthPts = points.filter((p: any) => p.source === 'reachability');
    expect(synthPts).toHaveLength(1);
    expect(synthPts[0].tag).toBe('REACH');
  });

  it('10. múltiplos pontos sintéticos configurados simultaneamente', async () => {
    readSnmpOidsMock.mockResolvedValue([1, 2, 3]);
    const { service, published } = buildService();

    const device = {
      ...DEVICE_BASE,
      points: [
        { tag: 'CPU', metric: 'cpu', oid: '1.3.6.1.4.1.39165.1.7.0', scale: 1, unit: '%' },
        { tag: 'REACH',   metric: 'reachability',             oid: null, scale: 1, unit: '%' },
        { tag: 'LAT',     metric: 'reachability_latency',     oid: null, scale: 1, unit: 'ms' },
        { tag: 'FAILURE', metric: 'reachability_failure_rate', oid: null, scale: 1, unit: '%' },
      ],
    };

    const state = buildState(true);
    await (service as any).pollDevice(state, device);

    const points = published[0]?.payload?.points as any[];
    const synthPts = points.filter((p: any) => p.source === 'reachability');
    expect(synthPts).toHaveLength(3);
    const tags = synthPts.map((p: any) => p.tag);
    expect(tags).toContain('REACH');
    expect(tags).toContain('LAT');
    expect(tags).toContain('FAILURE');
  });

});
