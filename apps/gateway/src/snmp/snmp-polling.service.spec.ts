/**
 * SnmpPollingService — exclusão de pontos `unsupported` do GET.
 *
 * Pontos com OID sabidamente não suportado (marcados pelo diagnóstico) NÃO
 * entram no GET em lote (em SNMP v1 um único OID inválido derruba a
 * requisição inteira), mas continuam publicados como null na telemetria
 * para o frontend seguir mostrando "não suportado". O STATUS nunca é
 * afetado por ponto unsupported.
 *
 * Com o motor de 3 camadas, o GET em lote passa a incluir também os OIDs
 * MIB-II da Camada 1 (sysUpTime/ifInDiscards/ifInErrors) — sempre à frente
 * dos OIDs dos pontos.
 */

jest.mock('./snmp-read.util', () => ({
  readSnmpOids: jest.fn(),
  readSnmpStrings: jest.fn(),
}));

import { SnmpPollingService } from './snmp-polling.service';
import { readSnmpOids } from './snmp-read.util';
import { SnmpDriver } from '../drivers/snmp.driver';
import { LAYER1_OIDS } from '../cameras/provider-registry';

const readSnmpOidsMock = readSnmpOids as jest.Mock;

function buildService() {
  const published: Array<{ topic: string; payload: any }> = [];
  const mqttService = {
    publish: (topic: string, payload: unknown) => {
      published.push({ topic, payload });
    },
  };
  const configService = { get: (_k: string, d: string) => d };
  const pollingMetrics = { record: jest.fn() };
  const service = new SnmpPollingService(
    mqttService as any,
    configService as any,
    pollingMetrics as any,
  );
  return { service, published };
}

/** Estado de poll com um driver cujas dependências de IO são mockadas. */
function buildState() {
  return {
    polling: false,
    driver: new SnmpDriver({
      readNumbers: readSnmpOidsMock as any,
      // Identificação: câmera respondeu mas sem sysDescr/sysObjectId úteis.
      readStrings: jest.fn().mockResolvedValue([null, null]),
      pingLoss: jest.fn().mockResolvedValue(null),
      isapiUptime: jest.fn().mockResolvedValue(null),
    }),
  };
}

const DEVICE = {
  deviceId: 'cam-1',
  name: 'Câmera genérica',
  protocol: 'snmp',
  ip: '10.0.0.5',
  port: 161,
  snmpVersion: '1' as const,
  community: 'public',
  pollingIntervalMs: 30_000,
  points: [
    { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
    { tag: 'CPU', metric: 'cpu', oid: '1.1', scale: 1, unit: '%' },
    { tag: 'TEMP', metric: 'temperature', oid: '1.2', scale: 1, unit: '°C', unsupported: true },
    { tag: 'MEM', metric: 'memory', oid: '1.3', scale: 1, unit: 'MB' },
  ],
};

const LAYER1_BATCH = [
  LAYER1_OIDS.sysUpTime,
  LAYER1_OIDS.ifInDiscards,
  LAYER1_OIDS.ifInErrors,
];

beforeEach(() => {
  readSnmpOidsMock.mockReset();
});

describe('SnmpPollingService.pollDevice', () => {
  it('exclui pontos unsupported do GET mas publica-os como null', async () => {
    readSnmpOidsMock.mockImplementation(async (_t: unknown, oids: string[]) =>
      oids.map((oid) => (oid === '1.1' ? 45 : oid === '1.3' ? 256 : null)),
    );
    const { service, published } = buildService();

    await (service as any).pollDevice(buildState(), DEVICE);

    // GET em lote = Camada 1 (MIB-II) + OIDs suportados dos pontos.
    expect(readSnmpOidsMock).toHaveBeenCalledTimes(1);
    expect(readSnmpOidsMock.mock.calls[0][1]).toEqual([...LAYER1_BATCH, '1.1', '1.3']);

    expect(published).toHaveLength(1);
    const points = published[0].payload.points;
    const byTag = Object.fromEntries(points.map((p: any) => [p.tag, p.value]));
    expect(byTag).toEqual({ STATUS: 1, CPU: 45, MEM: 256, TEMP: null });
  });

  it('câmera muda (timeout) → STATUS=0 e todos os pontos null', async () => {
    readSnmpOidsMock.mockResolvedValue(null);
    const { service, published } = buildService();

    await (service as any).pollDevice(buildState(), DEVICE);

    const byTag = Object.fromEntries(
      published[0].payload.points.map((p: any) => [p.tag, p.value]),
    );
    expect(byTag).toEqual({ STATUS: 0, CPU: null, MEM: null, TEMP: null });
  });
});
