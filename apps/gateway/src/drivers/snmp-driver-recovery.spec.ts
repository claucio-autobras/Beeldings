import { SnmpDriver, type SnmpDeviceConfig } from './snmp.driver';

const SNMP = { ip: '10.0.0.20', port: 161, community: 'public', snmpVersion: '2c' as const };
const CPU_ROOT = '1.3.6.1.2.1.25.3.3.1.2';
const CPU_17 = `${CPU_ROOT}.17`;

function device(metric: string, oid = '1.3.6.1.4.1.999.1.0'): SnmpDeviceConfig {
  return {
    deviceId: 'recover-1',
    ip: SNMP.ip,
    snmp: SNMP,
    monitoredDeviceType: 'CAMERA',
    points: [{ tag: metric.toUpperCase(), metric, oid, scale: 1, unit: metric === 'cpu' ? '%' : null }],
  };
}

describe('SnmpDriver — recuperação genérica', () => {
  it('descobre CPU em índice alto, publica no ciclo atual e usa GET no seguinte', async () => {
    let cycle = 0;
    const readWalk = jest.fn(async (_target: unknown, root: string) => ({
      root,
      entries: root === CPU_ROOT
        ? [
            { oid: `${CPU_ROOT}.2`, type: 'Integer', value: '20', numeric: 20, index: 2 },
            { oid: CPU_17, type: 'Integer', value: '80', numeric: 80, index: 17 },
          ]
        : [],
      truncated: false,
      discarded: {},
      error: null,
      responded: true,
      durationMs: 1,
    }));
    const io = {
      readStrings: jest.fn().mockResolvedValue([null, null]),
      readNumbers: jest.fn(async (_target: unknown, oids: string[]) => {
        cycle++;
        return oids.map((oid) => cycle > 1 && oid === CPU_17 ? 80 : null);
      }),
      pingLoss: jest.fn().mockResolvedValue(null),
      isapiUptime: jest.fn().mockResolvedValue(null),
      readWalk,
    };
    const driver = new SnmpDriver(io);

    const first = await driver.runCycle(device('cpu'));
    expect(first.reachable).toBe(true);
    expect(first.points[0].value).toBe(50);
    expect(readWalk).toHaveBeenCalledTimes(1);

    const second = await driver.runCycle(device('cpu'));
    expect(second.points[0].value).toBe(80);
    expect(readWalk).toHaveBeenCalledTimes(1);
    expect(io.readNumbers.mock.calls[1][1]).toContain(CPU_17);
  });

  it('não repete descoberta sem resultado antes de dez minutos', async () => {
    const readWalk = jest.fn(async (_target: unknown, root: string) => ({
      root, entries: [], truncated: false, discarded: {}, error: null, responded: true, durationMs: 1,
    }));
    const io = {
      readStrings: jest.fn().mockResolvedValue([null, null]),
      readNumbers: jest.fn().mockResolvedValue([null]),
      pingLoss: jest.fn().mockResolvedValue(null),
      isapiUptime: jest.fn().mockResolvedValue(null),
      readWalk,
    };
    const driver = new SnmpDriver(io);
    await driver.runCycle(device('temperature'));
    await driver.runCycle(device('temperature'));
    expect(readWalk).toHaveBeenCalledTimes(2); // lm-sensors + ENTITY, em um ciclo
  });

  it('host silencioso fica offline e não dispara walk', async () => {
    const readWalk = jest.fn();
    const io = {
      readStrings: jest.fn(),
      readNumbers: jest.fn().mockResolvedValue(null),
      pingLoss: jest.fn().mockResolvedValue(null),
      isapiUptime: jest.fn().mockResolvedValue(null),
      readWalk,
    };
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      ...device('cpu'),
      points: [
        { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
        ...device('cpu').points,
      ],
    });
    expect(out.reachable).toBe(false);
    expect(out.points.find((p) => p.tag === 'STATUS')?.value).toBe(0);
    expect(readWalk).not.toHaveBeenCalled();
  });
});