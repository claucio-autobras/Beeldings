/**
 * SnmpDriver — coleta restrita ao binding (fase 2 da descoberta SNMP).
 *
 * Trava o contrato do modo restrito:
 *  1. NUNCA chama readTable (subtree/walk) — pontos de tabela viram GET do
 *     OID completo (coluna.índice) dentro do batch escalar.
 *  2. NUNCA faz pré-busca de OIDs de perfil nem extras de camada 1 — o batch
 *     contém apenas sysUpTime + OIDs dos pontos.
 *  3. Vale também para devices SÓ de tabela (switch/NVR sem ponto escalar
 *     além do status derivado).
 */

jest.mock('../snmp/snmp-read.util', () => ({
  readSnmpOids: jest.fn(),
  readSnmpStrings: jest.fn(),
}));

import { SnmpDriver, type SnmpDeviceConfig } from './snmp.driver';
import { LAYER1_OIDS } from '../cameras/provider-registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SNMP = { ip: '10.0.1.50', port: 161, community: 'public', snmpVersion: '2c' as const };

function makeIo(oidValues: Record<string, number | null> = {}) {
  return {
    readStrings: jest.fn().mockResolvedValue([null, null]),
    readNumbers: jest.fn(async (_target: unknown, oids: string[]) =>
      oids.map((o) => oidValues[o] ?? null),
    ),
    pingLoss: jest.fn().mockResolvedValue(null),
    isapiUptime: jest.fn().mockResolvedValue(null),
    readTable: jest.fn().mockResolvedValue([]),
  };
}

const IF_OPER_COL = '1.3.6.1.2.1.2.2.1.8';
const IF_IN_OCTETS_COL = '1.3.6.1.2.1.2.2.1.10';
const DISK_STATUS_COL = '1.3.6.1.4.1.50001.1.241.1.3';

/** Switch restrito só com pontos de tabela + status derivado. */
function restrictedSwitch(overrides: Partial<SnmpDeviceConfig> = {}): SnmpDeviceConfig {
  return {
    deviceId: 'sw-1',
    ip: '10.0.1.50',
    snmp: SNMP,
    monitoredDeviceType: 'SWITCH',
    manufacturer: null,
    restrictToBindings: true,
    points: [
      { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
      { tag: 'PORTA_3_LINK', metric: 'if_oper_status', oid: IF_OPER_COL, scale: 1, unit: null, ifIndex: 3, collectionType: 'table' },
      { tag: 'PORTA_3_RX', metric: 'if_in_octets', oid: IF_IN_OCTETS_COL, scale: 1, unit: null, ifIndex: 3, collectionType: 'table' },
    ],
    ...overrides,
  };
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('SnmpDriver — modo restrito nunca executa walk/subtree', () => {
  it('switch só-tabela: readTable NUNCA é chamado; célula lida via GET coluna.índice', async () => {
    const io = makeIo({
      [LAYER1_OIDS.sysUpTime]: 1000,
      [`${IF_OPER_COL}.3`]: 1, // up
      [`${IF_IN_OCTETS_COL}.3`]: 5_000,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(restrictedSwitch());

    expect(io.readTable).not.toHaveBeenCalled();
    // Identificação de perfil (sysDescr/sysObjectID) NUNCA roda em modo
    // restrito — nenhum GET fora dos bindings + sysUpTime.
    expect(io.readStrings).not.toHaveBeenCalled();

    // Todas as chamadas de GET incluem o OID completo da célula.
    const batches = io.readNumbers.mock.calls.map((c) => c[1] as string[]);
    const allOids = batches.flat();
    expect(allOids).toContain(`${IF_OPER_COL}.3`);
    expect(allOids).toContain(`${IF_IN_OCTETS_COL}.3`);

    // Normalização de if_oper_status preservada (1=up→1).
    const byTag = new Map(out.points.map((p) => [p.tag, p]));
    expect(byTag.get('PORTA_3_LINK')?.value).toBe(1);
    // Contador: primeira amostra → null (state estimated) — sem walk.
    expect(byTag.get('PORTA_3_RX')?.value).toBeNull();
    expect(byTag.get('STATUS')?.value).toBe(1);
  });

  it('modo restrito: batch contém APENAS sysUpTime + OIDs dos pontos (sem extras de camada 1 nem perfil)', async () => {
    const io = makeIo({
      [LAYER1_OIDS.sysUpTime]: 1000,
      [`${IF_OPER_COL}.3`]: 2, // down
      [`${IF_IN_OCTETS_COL}.3`]: 100,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(restrictedSwitch());

    const allOids = io.readNumbers.mock.calls.map((c) => c[1] as string[]).flat();
    const expected = new Set([`${IF_OPER_COL}.3`, `${IF_IN_OCTETS_COL}.3`]);
    for (const oid of allOids) {
      expect(expected.has(oid)).toBe(true);
    }
    // NENHUM OID fora dos bindings — nem sysUpTime nem extras de camada 1.
    expect(allOids).not.toContain(LAYER1_OIDS.sysUpTime);
    expect(allOids).not.toContain(LAYER1_OIDS.ifInDiscards);
    expect(allOids).not.toContain(LAYER1_OIDS.ifInErrors);

    expect(out.points.find((p) => p.tag === 'PORTA_3_LINK')?.value).toBe(0);
  });

  it('NVR restrito: disco lido via GET coluna.slot sem readTable', async () => {
    const io = makeIo({
      [LAYER1_OIDS.sysUpTime]: 1000,
      [`${DISK_STATUS_COL}.1`]: 1,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'nvr-1',
      ip: '10.0.1.60',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: 'Hikvision',
      restrictToBindings: true,
      points: [
        { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
        { tag: 'DISCO_1_STATUS', metric: 'disk_status', oid: DISK_STATUS_COL, scale: 1, unit: null, ifIndex: 1, collectionType: 'table' },
      ],
    });

    expect(io.readTable).not.toHaveBeenCalled();
    expect(io.readStrings).not.toHaveBeenCalled();
    const allOids = io.readNumbers.mock.calls.map((c) => c[1] as string[]).flat();
    expect(allOids).toContain(`${DISK_STATUS_COL}.1`);
    expect(out.points.find((p) => p.tag === 'DISCO_1_STATUS')?.value).not.toBeNull();
  });

  it('restrito sem manufacturer/perfil: readStrings nunca roda e só GETs permitidos (bindings + sysUpTime)', async () => {
    // Device inalcançável (readNumbers retorna null) — a identificação de
    // perfil não pode ser tentada a cada ciclo.
    const io = {
      readStrings: jest.fn().mockResolvedValue([null, null]),
      readNumbers: jest.fn(async (_target: unknown, _oids: string[]) => null),
      pingLoss: jest.fn().mockResolvedValue(null),
      isapiUptime: jest.fn().mockResolvedValue(null),
      readTable: jest.fn().mockResolvedValue([]),
    };
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(restrictedSwitch({ manufacturer: null }));

    expect(io.readStrings).not.toHaveBeenCalled();
    expect(io.readTable).not.toHaveBeenCalled();
    expect(io.isapiUptime).not.toHaveBeenCalled();
    const allowed = new Set([`${IF_OPER_COL}.3`, `${IF_IN_OCTETS_COL}.3`]);
    for (const oid of io.readNumbers.mock.calls.map((c) => c[1] as string[]).flat()) {
      expect(allowed.has(oid)).toBe(true);
    }
    expect(out.reachable).toBe(false);
  });

  it('NVR restrito: disk_used lido direto do GET do binding (sem derivação capacity−free)', async () => {
    const DISK_USED_COL = '1.3.6.1.4.1.99.42.1.7';
    const io = makeIo({
      [LAYER1_OIDS.sysUpTime]: 1000,
      [`${DISK_USED_COL}.1`]: 750,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'nvr-2',
      ip: '10.0.1.61',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: null,
      restrictToBindings: true,
      points: [
        { tag: 'DISCO_1_USADO', metric: 'disk_used', oid: DISK_USED_COL, scale: 1, unit: 'GB', ifIndex: 1, collectionType: 'table' },
      ],
    });

    expect(io.readTable).not.toHaveBeenCalled();
    expect(io.readStrings).not.toHaveBeenCalled();
    expect(out.points.find((p) => p.tag === 'DISCO_1_USADO')?.value).toBe(750);
  });

  it('sem restrictToBindings também permanece GET-only', async () => {
    const io = makeIo({ [LAYER1_OIDS.sysUpTime]: 1000 });
    const driver = new SnmpDriver(io);
    await driver.runCycle(restrictedSwitch({ restrictToBindings: false }));

    expect(io.readTable).not.toHaveBeenCalled();
    expect(io.readStrings).not.toHaveBeenCalled();
  });

  it('Hikvision restrito não anexa fallbacks UCD ao lote proprietário', async () => {
    const cpuOid = '1.3.6.1.4.1.39165.1.7.0';
    const memoryOid = '1.3.6.1.4.1.39165.1.11.0';
    const ramTotalOid = '1.3.6.1.4.1.39165.1.10.0';
    const storageOid = '1.3.6.1.4.1.39165.1.9.0';
    const io = makeIo({
      [cpuOid]: 49,
      [memoryOid]: 84,
      [ramTotalOid]: 256,
      [storageOid]: 0,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'hikvision-bench',
      ip: '10.0.1.70',
      snmp: SNMP,
      monitoredDeviceType: 'CAMERA',
      manufacturer: 'Hikvision',
      restrictToBindings: true,
      points: [
        { tag: 'CPU', metric: 'cpu', oid: cpuOid, scale: 1, unit: '%' },
        { tag: 'MEMORIA', metric: 'memory', oid: memoryOid, scale: 1, unit: '%' },
        {
          tag: 'RAM_TOTAL',
          metric: 'ram_total',
          oid: ramTotalOid,
          scale: 1024 * 1024,
          unit: 'bytes',
        },
        { tag: 'ARMAZENAMENTO', metric: 'storage', oid: storageOid, scale: 1, unit: '%' },
      ],
    });

    const requested = io.readNumbers.mock.calls[0][1] as string[];
    expect(requested).toEqual([cpuOid, memoryOid, ramTotalOid, storageOid]);
    expect(requested).not.toContain('1.3.6.1.4.1.2021.4.6.0');
    expect(out.reachable).toBe(true);
    expect(out.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'CPU', value: 49 }),
      expect.objectContaining({ tag: 'MEMORIA', value: 84 }),
      expect.objectContaining({
        tag: 'RAM_TOTAL',
        value: 256 * 1024 * 1024,
        unit: 'bytes',
      }),
      expect.objectContaining({ tag: 'ARMAZENAMENTO', value: 0 }),
    ]));
  });

  it('mantém RAM total em bytes para fontes em kB e bytes, sem dupla conversão', async () => {
    const hrMemorySizeOid = '1.3.6.1.2.1.25.2.2.0';
    const rawBytesOid = '1.3.6.1.4.1.99999.1.0';
    const io = makeIo({
      [hrMemorySizeOid]: 256 * 1024,
      [rawBytesOid]: 256 * 1024 * 1024,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'memory-units-bench',
      ip: '10.0.1.71',
      snmp: SNMP,
      monitoredDeviceType: 'CAMERA',
      restrictToBindings: true,
      points: [
        {
          tag: 'RAM_KB',
          metric: 'ram_total',
          oid: hrMemorySizeOid,
          scale: 1024,
          unit: 'bytes',
        },
        {
          tag: 'RAM_BYTES',
          metric: 'ram_total',
          oid: rawBytesOid,
          scale: 1,
          unit: 'bytes',
        },
      ],
    });

    expect(out.points).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'RAM_KB', value: 256 * 1024 * 1024, unit: 'bytes' }),
      expect.objectContaining({ tag: 'RAM_BYTES', value: 256 * 1024 * 1024, unit: 'bytes' }),
    ]));
  });
});
