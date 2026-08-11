/**
 * SnmpDriver — comportamento de identificação e coleta para ACCESS_CONTROLLER.
 *
 * Verifica que:
 *  1. Sem manufacturer, o driver tenta sysDescr auto-detect (NOT base-camera shortcut).
 *  2. Com sysDescr Hikvision → perfil vendor hikvision.
 *  3. Sem sysDescr útil → perfil base-access-controller após SNMP respondido.
 *  4. Quando SNMP falha (readNumbers=null), STATUS=0 e todos os pontos null.
 *  5. manufacturer='Hikvision' → perfil hikvision sem precisar de readStrings.
 */

jest.mock('../snmp/snmp-read.util', () => ({
  readSnmpOids: jest.fn(),
  readSnmpStrings: jest.fn(),
}));

import { SnmpDriver, type SnmpDeviceConfig } from './snmp.driver';
import { LAYER1_OIDS } from '../cameras/provider-registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SNMP = { ip: '10.0.0.50', port: 161, community: 'public', snmpVersion: '2c' as const };

function makeIo(opts: {
  /**
   * Quando true, readStrings retorna null (device não responde ao sysDescr → retry
   * no próximo ciclo). Quando false/ausente, readStrings retorna o par fornecido em
   * `readStringsResult` (ou [null, null] por padrão — device respondeu mas sem info útil).
   *
   * NOTA: não passar `null` diretamente aqui, pois `null ?? default` avalia para
   * `default` — use `stringsTimeout: true` para simular ausência de resposta.
   */
  stringsTimeout?: boolean;
  readStringsResult?: [string | null, string | null];
  /** Null = timeout no readNumbers (device offline). Omitir = all-null mas acessível. */
  oidValues?: Record<string, number | null> | null;
} = {}) {
  const stringsResponse: [string | null, string | null] | null = opts.stringsTimeout
    ? null
    : (opts.readStringsResult ?? [null, null]);

  return {
    readStrings: jest.fn().mockResolvedValue(stringsResponse),
    readNumbers: jest.fn(async (_target: unknown, oids: string[]) => {
      if (opts.oidValues === null) return null; // simula timeout
      return oids.map((o) => opts.oidValues?.[o] ?? null);
    }),
    pingLoss: jest.fn().mockResolvedValue(null),
    isapiUptime: jest.fn().mockResolvedValue(null),
  };
}

/** Device mínimo de controladora de acesso. */
function acDevice(overrides: Partial<SnmpDeviceConfig> = {}): SnmpDeviceConfig {
  return {
    deviceId: 'ctrl-1',
    ip: '10.0.0.50',
    snmp: SNMP,
    monitoredDeviceType: 'ACCESS_CONTROLLER',
    manufacturer: null,
    points: [
      { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
      { tag: 'CPU', metric: 'cpu', oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1, unit: '%' },
      { tag: 'MEM', metric: 'memory', oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1, unit: 'kB' },
    ],
    ...overrides,
  };
}

// ─── Identificação ────────────────────────────────────────────────────────────

describe('SnmpDriver — ACCESS_CONTROLLER identification', () => {
  it('sem manufacturer tenta sysDescr auto-detect (readStrings chamado)', async () => {
    // Device responde ao sysDescr mas sem info útil → fica no perfil base
    const io = makeIo({ oidValues: { [LAYER1_OIDS.sysUpTime]: 10000 } });
    const driver = new SnmpDriver(io);

    await driver.runCycle(acDevice());

    // readStrings DEVE ter sido chamado — sem manufacturer há auto-detect
    expect(io.readStrings).toHaveBeenCalledTimes(1);
    expect(io.readStrings).toHaveBeenCalledWith(SNMP, [LAYER1_OIDS.sysDescr, LAYER1_OIDS.sysObjectId]);
  });

  it('sysDescr Hikvision → perfil vendor hikvision, não base-access-controller', async () => {
    const io = makeIo({
      readStringsResult: ['Hikvision DS-K2602 Linux 3.0', '1.3.6.1.4.1.39165.1.1'],
      oidValues: {},
    });
    const driver = new SnmpDriver(io);

    await driver.runCycle(acDevice());

    expect(driver.profileId).toBe('hikvision');
  });

  it('sysDescr genérico (sem match) → perfil base-access-controller', async () => {
    const io = makeIo({
      readStringsResult: ['Generic Linux Device', '1.3.6.1.4.1.99999.1'],
      oidValues: {},
    });
    const driver = new SnmpDriver(io);

    await driver.runCycle(acDevice());

    expect(driver.profileId).toBe('base-access-controller');
  });

  it('com manufacturer="Hikvision" → perfil hikvision SEM readStrings (skip auto-detect)', async () => {
    const io = makeIo({ oidValues: {} });
    const driver = new SnmpDriver(io);

    await driver.runCycle(acDevice({ manufacturer: 'Hikvision' }));

    // Manufacturer explícito → identifica diretamente, sem SNMP de auto-detect.
    expect(io.readStrings).not.toHaveBeenCalled();
    expect(driver.profileId).toBe('hikvision');
  });

  it('com manufacturer desconhecido → base-access-controller SEM readStrings', async () => {
    const io = makeIo({ oidValues: {} });
    const driver = new SnmpDriver(io);

    await driver.runCycle(acDevice({ manufacturer: 'MarcaXYZ' }));

    // Manufacturer set mas sem match vendor → skip auto-detect, usa base
    expect(io.readStrings).not.toHaveBeenCalled();
    expect(driver.profileId).toBe('base-access-controller');
  });

  it('SNMP não responde no 1º ciclo → não identificado ainda (retry no próximo ciclo)', async () => {
    // stringsTimeout: true → readStrings retorna null (device não responde sysDescr)
    const io = makeIo({ stringsTimeout: true, oidValues: {} });
    const driver = new SnmpDriver(io);

    await driver.runCycle(acDevice());

    // Não identificado → profileId ainda null (retry no próximo ciclo)
    expect(driver.profileId).toBeNull();
  });
});

// ─── Telemetria com SNMP falhando ─────────────────────────────────────────────

describe('SnmpDriver — ACCESS_CONTROLLER null-on-failure', () => {
  it('readNumbers=null → reachable=false, STATUS=0, demais pontos null', async () => {
    // Controladora identificada (manufacturer=Hikvision para pular auto-detect)
    // mas readNumbers falha neste ciclo.
    const io = makeIo({ oidValues: null }); // null = timeout no readNumbers
    const driver = new SnmpDriver(io);

    const out = await driver.runCycle(acDevice({ manufacturer: 'Hikvision' }));

    expect(out.reachable).toBe(false);

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['STATUS']).toBe(0);
    expect(byTag['CPU']).toBeNull();
    expect(byTag['MEM']).toBeNull();
  });

  it('readNumbers ok → reachable=true, STATUS=1, valores publicados', async () => {
    const io = makeIo({
      readStringsResult: [null, null],
      oidValues: {
        [LAYER1_OIDS.sysUpTime]: 360000,       // 3600s
        [LAYER1_OIDS.ifInDiscards]: 0,
        [LAYER1_OIDS.ifInErrors]: 0,
        '1.3.6.1.2.1.25.3.3.1.2.1': 42,       // CPU 42%
        '1.3.6.1.4.1.2021.4.6.0': 512000,      // MEM 512 MB
      },
    });
    const driver = new SnmpDriver(io);

    const out = await driver.runCycle(acDevice());

    expect(out.reachable).toBe(true);
    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['STATUS']).toBe(1);
    expect(byTag['CPU']).toBe(42);
    expect(byTag['MEM']).toBe(512000);
  });
});
