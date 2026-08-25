/**
 * Contrato de polling SNMP para controladoras de acesso.
 *
 * A identificação e a descoberta acontecem antes da coleta. O ciclo recorrente
 * recebe bindings concretos e só executa GET; perfil implícito e walk não fazem
 * parte deste caminho.
 */
import {
  computeLinuxAvailableMemory,
  SnmpDriver,
  type SnmpDeviceConfig,
} from './snmp.driver';

const SNMP = { ip: '10.0.0.50', port: 161, community: 'public', snmpVersion: '2c' as const };
const CPU_OID = '1.3.6.1.4.1.49617.1.1.4.0';
const HR_CPU_OIDS = [
  '1.3.6.1.2.1.25.3.3.1.2.1',
  '1.3.6.1.2.1.25.3.3.1.2.2',
  '1.3.6.1.2.1.25.3.3.1.2.3',
  '1.3.6.1.2.1.25.3.3.1.2.4',
];
const MEM_OID = '1.3.6.1.4.1.2021.4.6.0';
const MEM_TOTAL_OID = '1.3.6.1.4.1.2021.4.5.0';
const MEM_BUFFER_OID = '1.3.6.1.4.1.2021.4.14.0';
const MEM_CACHED_OID = '1.3.6.1.4.1.2021.4.15.0';

function makeIo(values: Record<string, number | null> = {}) {
  return {
    readStrings: jest.fn().mockResolvedValue(['Control iD', '1.3.6.1.4.1.49617.1']),
    readNumbers: jest.fn(async (_target: unknown, oids: string[]) =>
      oids.map((oid) => values[oid] ?? null),
    ),
    pingLoss: jest.fn().mockResolvedValue(null),
    isapiUptime: jest.fn().mockResolvedValue(null),
    readTable: jest.fn().mockResolvedValue([]),
  };
}

function device(points: SnmpDeviceConfig['points']): SnmpDeviceConfig {
  return {
    deviceId: 'ctrl-1',
    ip: SNMP.ip,
    snmp: SNMP,
    monitoredDeviceType: 'ACCESS_CONTROLLER',
    manufacturer: 'Control iD',
    restrictToBindings: true,
    points,
  };
}

describe('SnmpDriver — ACCESS_CONTROLLER polling GET-only', () => {
  it('publica a média de todos os núcleos hrProcessorLoad, não o OID proprietário', async () => {
    const io = makeIo({
      [HR_CPU_OIDS[0]]: 28,
      [HR_CPU_OIDS[1]]: 17,
      [HR_CPU_OIDS[2]]: 19,
      [HR_CPU_OIDS[3]]: 22,
      [CPU_OID]: 99,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(device([{
      tag: 'CPU',
      metric: 'cpu_usage',
      oid: HR_CPU_OIDS[0],
      memberOids: HR_CPU_OIDS,
      scale: 1,
      unit: '%',
    }]));

    expect(io.readNumbers.mock.calls[0][1]).toEqual(expect.arrayContaining(HR_CPU_OIDS));
    expect(out.points[0]).toMatchObject({
      value: 21.5,
      unit: '%',
      source: 'aggregate',
    });
  });

  it('compõe memória Linux recuperável e limita ao total', () => {
    expect(computeLinuxAvailableMemory(31_400, 10_000, 18_000, 119_400)).toBe(59_400);
    expect(computeLinuxAvailableMemory(110_000, 20_000, 20_000, 119_400)).toBe(119_400);
  });

  it('publica memória Linux composta em bytes e inclui dependências no GET', async () => {
    const io = makeIo({
      [MEM_OID]: 31_400,
      [MEM_BUFFER_OID]: 10_000,
      [MEM_CACHED_OID]: 18_000,
      [MEM_TOTAL_OID]: 119_400,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(device([
      { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
      { tag: 'MEM', metric: 'memory_available', oid: MEM_OID, scale: 1024, unit: 'bytes' },
    ]));

    expect(io.readNumbers.mock.calls[0][1]).toEqual(expect.arrayContaining([
      MEM_OID, MEM_BUFFER_OID, MEM_CACHED_OID, MEM_TOTAL_OID,
    ]));
    expect(out.points.find((point) => point.tag === 'MEM')).toMatchObject({
      value: 59_400 * 1024,
      unit: 'bytes',
      source: 'linux-memory',
    });
  });

  it('mantém memAvailReal quando buffers/cache não são expostos', async () => {
    const io = makeIo({ [MEM_OID]: 31_400 });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(device([
      { tag: 'MEM', metric: 'memory_available', oid: MEM_OID, scale: 1024, unit: 'bytes' },
    ]));

    expect(out.reachable).toBe(true);
    expect(out.points[0]).toMatchObject({ value: 31_400 * 1024, source: 'linux-memory' });
  });

  it('consulta somente os OIDs persistidos e não identifica perfil em cada ciclo', async () => {
    const io = makeIo({ [CPU_OID]: 23.4, [MEM_OID]: 45000 });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(device([
      { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
      { tag: 'CPU', metric: 'cpu_usage', oid: CPU_OID, scale: 1, unit: '%' },
      { tag: 'MEM', metric: 'memory_used_percent', oid: MEM_OID, scale: 1, unit: '%' },
    ]));

    expect(io.readStrings).not.toHaveBeenCalled();
    expect(io.readTable).not.toHaveBeenCalled();
    expect(io.readNumbers.mock.calls[0][1]).toEqual(expect.arrayContaining([CPU_OID, MEM_OID]));
    expect(out.reachable).toBe(true);
    expect(out.points.find((point) => point.tag === 'CPU')?.value).toBe(23.4);
  });

  it('binding sem OID não inventa candidato nem volta ao perfil implícito', async () => {
    const io = makeIo();
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(device([
      { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
      { tag: 'CPU', metric: 'cpu_usage', oid: null, scale: 1, unit: '%' },
    ]));

    expect(io.readNumbers).toHaveBeenCalledWith(SNMP, []);
    expect(io.readStrings).not.toHaveBeenCalled();
    expect(out.points.find((point) => point.tag === 'CPU')?.value).toBeNull();
  });

  it('timeout do GET publica offline e valores nulos', async () => {
    const io = {
      ...makeIo(),
      readNumbers: jest.fn().mockResolvedValue(null),
    };
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(device([
      { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
      { tag: 'CPU', metric: 'cpu_usage', oid: CPU_OID, scale: 1, unit: '%' },
    ]));

    expect(out.reachable).toBe(false);
    expect(out.points.find((point) => point.tag === 'STATUS')?.value).toBe(0);
    expect(out.points.find((point) => point.tag === 'CPU')?.value).toBeNull();
  });
});