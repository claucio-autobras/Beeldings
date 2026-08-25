/**
 * NVR também segue o contrato canônico: descoberta materializa OIDs completos
 * dos pontos de tabela e o ciclo recorrente faz somente GET por célula.
 */
import { SnmpDriver, type SnmpDeviceConfig } from './snmp.driver';

const SNMP = { ip: '10.0.1.100', port: 161, community: 'public', snmpVersion: '2c' as const };
const DISK_STATUS = '1.3.6.1.4.1.50001.1.241.1.3';
const DISK_CAPACITY = '1.3.6.1.4.1.50001.1.241.1.5';

function makeIo(values: Record<string, number | null>) {
  return {
    readStrings: jest.fn().mockResolvedValue(['Hikvision NVR', '1.3.6.1.4.1.50001.1']),
    readNumbers: jest.fn(async (_target: unknown, oids: string[]) =>
      oids.map((oid) => values[oid] ?? null),
    ),
    pingLoss: jest.fn().mockResolvedValue(null),
    isapiUptime: jest.fn().mockResolvedValue(null),
    readTable: jest.fn().mockResolvedValue([]),
  };
}

function nvr(points: SnmpDeviceConfig['points']): SnmpDeviceConfig {
  return {
    deviceId: 'nvr-1',
    ip: SNMP.ip,
    snmp: SNMP,
    monitoredDeviceType: 'NVR',
    manufacturer: 'Hikvision',
    restrictToBindings: true,
    points,
  };
}

describe('SnmpDriver — NVR polling GET-only', () => {
  it('lê célula de disco por GET completo sem readTable ou identificação', async () => {
    const io = makeIo({
      [`${DISK_STATUS}.1`]: 1,
      [`${DISK_CAPACITY}.1`]: 2_000_000,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(nvr([
      { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
      {
        tag: 'DISCO_1_STATUS',
        metric: 'storage_status',
        oid: DISK_STATUS,
        scale: 1,
        unit: null,
        ifIndex: 1,
        collectionType: 'table',
      },
      {
        tag: 'DISCO_1_CAP',
        metric: 'storage_capacity',
        oid: DISK_CAPACITY,
        scale: 0.001,
        unit: 'GB',
        ifIndex: 1,
        collectionType: 'table',
      },
    ]));

    expect(io.readStrings).not.toHaveBeenCalled();
    expect(io.readTable).not.toHaveBeenCalled();
    expect(io.readNumbers.mock.calls[0][1]).toEqual(
      expect.arrayContaining([`${DISK_STATUS}.1`, `${DISK_CAPACITY}.1`]),
    );
    expect(out.points.find((point) => point.tag === 'DISCO_1_CAP')?.value).toBe(2000);
  });

  it('ponto de tabela sem binding concreto fica sem dado, sem walk implícito', async () => {
    const io = makeIo({});
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(nvr([{
      tag: 'DISCO_1_STATUS',
      metric: 'storage_status',
      oid: null,
      scale: 1,
      unit: null,
      ifIndex: 1,
      collectionType: 'table',
    }]));

    expect(io.readNumbers).toHaveBeenCalledWith(SNMP, []);
    expect(io.readTable).not.toHaveBeenCalled();
    expect(out.points[0].value).toBeNull();
  });
});