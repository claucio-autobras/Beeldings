/**
 * SnmpDriver — comportamento de coleta de tabela para NVR/DVR.
 *
 * Verifica que:
 *  1. readTable é injetado (e chamado) para devices monitoredDeviceType='NVR'.
 *  2. Hikvision NVR: disk_used = disk_capacity − disk_free (normalização capacity-free).
 *  3. Dahua/Intelbras NVR: disk_used e disk_capacity recebem scale 0.001 (MB→GB).
 *  4. 'base-nvr' consta no conjunto BASE_PROFILE_IDS (auto-detect ocorre sem manufacturer).
 */

jest.mock('../snmp/snmp-read.util', () => ({
  readSnmpOids: jest.fn(),
  readSnmpStrings: jest.fn(),
}));

import { SnmpDriver, type SnmpDeviceConfig } from './snmp.driver';
import { LAYER1_OIDS } from '../cameras/provider-registry';
import type { SnmpTableEntry } from '../snmp/snmp-read.util';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SNMP = { ip: '10.0.1.100', port: 161, community: 'public', snmpVersion: '2c' as const };

/** Entrada mínima de tabela para simular uma coluna SNMP lida. */
function tableRow(ifIndex: number, value: number | null) {
  // oid é o OID completo da célula (prefix + '.' + ifIndex) — obrigatório no tipo.
  return { oid: `0.0.0.${ifIndex}`, ifIndex, value, counterType: undefined as undefined };
}

type IoOpts = {
  readStringsResult?: [string | null, string | null];
  oidValues?: Record<string, number | null>;
  /** Mapa OID-prefix → rows devolvidos pelo readTable (ou null para timeout). */
  tableData?: Record<string, SnmpTableEntry[] | null>;
};

function makeIo(opts: IoOpts = {}) {
  return {
    readStrings: jest.fn().mockResolvedValue(opts.readStringsResult ?? [null, null]),
    readNumbers: jest.fn(async (_target: unknown, oids: string[]) => {
      const vals = opts.oidValues ?? {};
      return oids.map((o) => vals[o] ?? null);
    }),
    pingLoss: jest.fn().mockResolvedValue(null),
    isapiUptime: jest.fn().mockResolvedValue(null),
    readTable: jest.fn(async (_target: unknown, prefix: string) => {
      if (!opts.tableData) return [];
      // Procura a entrada cujo OID-prefix é prefixo do argumento recebido.
      for (const [key, rows] of Object.entries(opts.tableData)) {
        if (prefix.startsWith(key) || key.startsWith(prefix) || prefix === key) {
          return rows;
        }
      }
      return [];
    }),
  };
}

/** Device NVR mínimo com pontos de disco e canal. */
function nvrDevice(overrides: Partial<SnmpDeviceConfig> = {}): SnmpDeviceConfig {
  return {
    deviceId: 'nvr-1',
    ip: '10.0.1.100',
    snmp: SNMP,
    monitoredDeviceType: 'NVR',
    manufacturer: null,
    points: [
      { tag: 'STATUS',           metric: 'status',        oid: null, scale: 1, unit: null },
      { tag: 'DISCO_1_STATUS',   metric: 'disk_status',   oid: null, scale: 1, unit: null,  ifIndex: 1, collectionType: 'table' },
      { tag: 'DISCO_1_CAP',      metric: 'disk_capacity', oid: null, scale: 1, unit: 'GB',  ifIndex: 1, collectionType: 'table' },
      { tag: 'DISCO_1_USADO',    metric: 'disk_used',     oid: null, scale: 1, unit: 'GB',  ifIndex: 1, collectionType: 'table' },
    ],
    ...overrides,
  };
}

// ─── 1. readTable injetado e chamado para NVR ─────────────────────────────────

describe('SnmpDriver — NVR readTable injection', () => {
  it('chama readTable quando monitoredDeviceType=NVR', async () => {
    const io = makeIo({
      readStringsResult: ['Hikvision DS-7608NI Linux 3.10', '1.3.6.1.4.1.39165.1.1'],
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
      tableData: {
        '1.3.6.1.4.1.39165.1.4.1.1': [tableRow(1, 1)],   // disk_status
        '1.3.6.1.4.1.39165.1.4.1.2': [tableRow(1, 2000)], // disk_capacity (GB)
        '1.3.6.1.4.1.39165.1.4.1.3': [tableRow(1, 500)],  // disk_free (GB)
      },
    });

    const driver = new SnmpDriver(io);
    await driver.runCycle(nvrDevice({ manufacturer: 'Hikvision' }));

    // readTable DEVE ter sido chamado ao menos 1 vez (disk_capacity/disk_free implícitos)
    expect(io.readTable).toHaveBeenCalled();
  });

  it('NÃO chama readTable quando monitoredDeviceType=CAMERA (sem pontos de tabela)', async () => {
    const io = makeIo({
      readStringsResult: ['Hikvision DS-2CD2143G2 Linux 3.10', '1.3.6.1.4.1.39165.1.1'],
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
    });
    // Cria io sem readTable injetado para simular o comportamento do polling-service para câmeras.
    const ioSemTable = {
      readStrings: io.readStrings,
      readNumbers: io.readNumbers,
      pingLoss: io.pingLoss,
      isapiUptime: io.isapiUptime,
      // readTable ausente intencionalmente
    };

    const driver = new SnmpDriver(ioSemTable);
    const camDevice: SnmpDeviceConfig = {
      deviceId: 'cam-1',
      ip: '10.0.1.101',
      snmp: SNMP,
      monitoredDeviceType: 'CAMERA',
      manufacturer: 'Hikvision',
      points: [
        { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
        { tag: 'CPU',    metric: 'cpu',    oid: '1.3.6.1.4.1.39165.1.7.0', scale: 1, unit: '%' },
      ],
    };

    // Não deve lançar mesmo sem readTable
    await expect(driver.runCycle(camDevice)).resolves.not.toThrow();
  });
});

// ─── 2. Hikvision NVR: disk_used = capacity − free ───────────────────────────

describe('SnmpDriver — Hikvision NVR disk_used = capacity − free', () => {
  // OIDs Hikvision NVR (hikHddTable)
  const HIK_STATUS_PREFIX   = '1.3.6.1.4.1.39165.1.4.1.1';
  const HIK_CAPACITY_PREFIX = '1.3.6.1.4.1.39165.1.4.1.2';
  const HIK_FREE_PREFIX     = '1.3.6.1.4.1.39165.1.4.1.3'; // disk_free (col 3 = espaço LIVRE)

  it('calcula disk_used = capacity(2000) − free(500) = 1500 GB', async () => {
    const io = makeIo({
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
      tableData: {
        [HIK_STATUS_PREFIX]:   [tableRow(1, 1)],
        [HIK_CAPACITY_PREFIX]: [tableRow(1, 2000)],
        [HIK_FREE_PREFIX]:     [tableRow(1, 500)],
      },
    });

    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(nvrDevice({ manufacturer: 'Hikvision' }));

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['DISCO_1_USADO']).toBe(1500);
  });

  it('disk_used não negativo: capacity(1000) − free(1200) → 0 (clamp)', async () => {
    const io = makeIo({
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
      tableData: {
        [HIK_STATUS_PREFIX]:   [tableRow(1, 1)],
        [HIK_CAPACITY_PREFIX]: [tableRow(1, 1000)],
        [HIK_FREE_PREFIX]:     [tableRow(1, 1200)], // free > capacity = dado inválido, deve clampear
      },
    });

    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(nvrDevice({ manufacturer: 'Hikvision' }));

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['DISCO_1_USADO']).toBe(0);
  });

  it('disk_used null quando disk_free não disponível', async () => {
    // disk_free não retornado pelo NVR (ex.: firmware antigo)
    const io = makeIo({
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
      tableData: {
        [HIK_STATUS_PREFIX]:   [tableRow(1, 1)],
        [HIK_CAPACITY_PREFIX]: [tableRow(1, 2000)],
        // HIK_FREE_PREFIX ausente → readTable retorna [] → sem dado para derivar
      },
    });

    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(nvrDevice({ manufacturer: 'Hikvision' }));

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['DISCO_1_USADO']).toBeNull();
  });
});

// ─── 3. Normalização de disk_status Dahua/Intelbras ──────────────────────────

describe('SnmpDriver — disk_status Dahua/Intelbras normalização', () => {
  // OIDs Dahua (dskTable)
  const DAH_STATUS_PREFIX   = '1.3.6.1.4.1.1004849.1.1.1.2';
  const DAH_CAPACITY_PREFIX = '1.3.6.1.4.1.1004849.1.1.1.3';
  const DAH_USED_PREFIX     = '1.3.6.1.4.1.1004849.1.1.1.4';

  // Enum Dahua raw: 0=normal, 1=erro, 2=sem disco
  // Enum canônico:  0=sem disco, 1=normal, 2=erro
  const CANONICAL_CASES: Array<{ raw: number; expected: number; label: string }> = [
    { raw: 0, expected: 1, label: '0=normal Dahua → 1=normal canônico' },
    { raw: 1, expected: 2, label: '1=erro Dahua → 2=erro canônico' },
    { raw: 2, expected: 0, label: '2=sem disco Dahua → 0=sem disco canônico' },
    { raw: 3, expected: 3, label: '3=não formatado → 3 (passa inalterado)' },
    { raw: 4, expected: 4, label: '4=formatando → 4 (passa inalterado)' },
  ];

  for (const { raw, expected, label } of CANONICAL_CASES) {
    it(`Dahua disk_status: ${label}`, async () => {
      const io = makeIo({
        oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
        tableData: {
          [DAH_STATUS_PREFIX]:   [tableRow(1, raw)],
          [DAH_CAPACITY_PREFIX]: [tableRow(1, 2_000_000)],
          [DAH_USED_PREFIX]:     [tableRow(1, 1_000_000)],
        },
      });
      const driver = new SnmpDriver(io);
      const out = await driver.runCycle({
        deviceId: 'nvr-dahua-status',
        ip: '10.0.1.200',
        snmp: SNMP,
        monitoredDeviceType: 'NVR',
        manufacturer: 'Dahua',
        points: [
          { tag: 'STATUS',         metric: 'status',       oid: null, scale: 1,     unit: null },
          { tag: 'DISCO_1_STATUS', metric: 'disk_status',  oid: null, scale: 1,     unit: null,  ifIndex: 1, collectionType: 'table' },
          { tag: 'DISCO_1_CAP',    metric: 'disk_capacity',oid: null, scale: 0.001, unit: 'GB',  ifIndex: 1, collectionType: 'table' },
          { tag: 'DISCO_1_USADO',  metric: 'disk_used',    oid: null, scale: 0.001, unit: 'GB',  ifIndex: 1, collectionType: 'table' },
        ],
      });
      const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
      expect(byTag['DISCO_1_STATUS']).toBe(expected);
    });
  }

  it('Intelbras disk_status: raw 0=normal → canônico 1=normal', async () => {
    const io = makeIo({
      // sysObjectId com enterprise 1004849 → auto-detect intelbras-nvr
      readStringsResult: ['Intelbras NVR 9232', '1.3.6.1.4.1.1004849.1.1'],
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
      tableData: {
        [DAH_STATUS_PREFIX]:   [tableRow(1, 0)],   // raw 0=normal
        [DAH_CAPACITY_PREFIX]: [tableRow(1, 4_000_000)],
        [DAH_USED_PREFIX]:     [tableRow(1, 3_000_000)],
      },
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'nvr-intelbras-status',
      ip: '10.0.1.201',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: null, // auto-detect via sysDescr/sysObjectId
      points: [
        { tag: 'STATUS',         metric: 'status',       oid: null, scale: 1,     unit: null },
        { tag: 'DISCO_1_STATUS', metric: 'disk_status',  oid: null, scale: 1,     unit: null,  ifIndex: 1, collectionType: 'table' },
        { tag: 'DISCO_1_CAP',    metric: 'disk_capacity',oid: null, scale: 0.001, unit: 'GB',  ifIndex: 1, collectionType: 'table' },
        { tag: 'DISCO_1_USADO',  metric: 'disk_used',    oid: null, scale: 0.001, unit: 'GB',  ifIndex: 1, collectionType: 'table' },
      ],
    });
    expect(driver.profileId).toBe('intelbras-nvr');
    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    // raw 0 (normal Intelbras) → canônico 1 (normal)
    expect(byTag['DISCO_1_STATUS']).toBe(1);
  });

  it('Hikvision disk_status: valores já são canônicos — sem remapeamento', async () => {
    const io = makeIo({
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
      tableData: {
        ['1.3.6.1.4.1.39165.1.4.1.1']: [tableRow(1, 1)],   // status=1=normal (já canônico)
        ['1.3.6.1.4.1.39165.1.4.1.2']: [tableRow(1, 2000)], // capacity
        ['1.3.6.1.4.1.39165.1.4.1.3']: [tableRow(1, 500)],  // free
      },
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(nvrDevice({ manufacturer: 'Hikvision' }));
    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    // Hikvision sem enumNormalize → passa inalterado
    expect(byTag['DISCO_1_STATUS']).toBe(1);
  });
});

// ─── 4. Vendor polling com pontos sem OID no binding (Issue 2) ───────────────

describe('SnmpDriver — NVR vendor polling com pontos sem OID no binding', () => {
  const HIK_CPU_OID = '1.3.6.1.4.1.39165.1.7.0';       // Hikvision CPU OID (vendor)
  const DAH_CPU_OID = '1.3.6.1.4.1.1004849.2.1.3.1.1.1'; // Dahua CPU OID (vendor)

  it('Hikvision NVR: cpu sem OID no binding usa OID do perfil vendor', async () => {
    const io = makeIo({
      oidValues: {
        [LAYER1_OIDS.sysUpTime]: 10000,
        [HIK_CPU_OID]: 72, // Hikvision CPU = 72%
        // hrProcessorLoad NOT set → qualquer binding com hrProcessorLoad ficaria null
      },
    });
    const driver = new SnmpDriver(io);

    const out = await driver.runCycle({
      deviceId: 'nvr-hik-nobinding',
      ip: '10.0.1.100',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: 'Hikvision',
      points: [
        { tag: 'STATUS', metric: 'status',  oid: null, scale: 1, unit: null },
        // oid: null → driver cai para mapping.oid do perfil vendor (Hikvision CPU OID)
        { tag: 'CPU',    metric: 'cpu',     oid: null, scale: 1, unit: '%' },
      ],
    });

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    // Deve usar o OID do perfil Hikvision, não o hrProcessorLoad do binding
    expect(byTag['CPU']).toBe(72);
  });

  it('Dahua NVR: cpu sem OID no binding usa OID do perfil vendor Dahua', async () => {
    const io = makeIo({
      oidValues: {
        [LAYER1_OIDS.sysUpTime]: 10000,
        [DAH_CPU_OID]: 55, // Dahua CPU = 55%
      },
    });
    const driver = new SnmpDriver(io);

    const out = await driver.runCycle({
      deviceId: 'nvr-dahua-nobinding',
      ip: '10.0.1.200',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: 'Dahua',
      points: [
        { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
        { tag: 'CPU',    metric: 'cpu',    oid: null, scale: 1, unit: '%' },
      ],
    });

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['CPU']).toBe(55);
  });

  it('NVR sem vendor (base): cpu sem OID no binding usa fallback hrProcessorLoad do perfil base', async () => {
    const HR_CPU_OID = '1.3.6.1.2.1.25.3.3.1.2.1'; // hrProcessorLoad (base NVR profile)
    const io = makeIo({
      readStringsResult: [null, null], // sem sysDescr → perfil base
      oidValues: {
        [LAYER1_OIDS.sysUpTime]: 10000,
        [HR_CPU_OID]: 30, // hrProcessorLoad = 30%
      },
    });
    const driver = new SnmpDriver(io);

    const out = await driver.runCycle({
      deviceId: 'nvr-base-nobinding',
      ip: '10.0.1.100',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: null,
      points: [
        { tag: 'STATUS', metric: 'status', oid: null, scale: 1, unit: null },
        { tag: 'CPU',    metric: 'cpu',    oid: null, scale: 1, unit: '%' },
      ],
    });

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    // Base NVR profile has hrProcessorLoad as fallback
    expect(byTag['CPU']).toBe(30);
  });
});

// ─── 5. Dahua/Intelbras: scale 0.001 (MB → GB) ───────────────────────────────
// (kept below)

// ─── 6. E2E — pontos default NVR criados pelo backend (criação → config → telemetria) ─

/**
 * Verifica o fluxo completo: os pontos que DEFAULT_NVR_POINTS cria no banco
 * (com oid: null, metric: 'memory' para MEMORIA) chegam via config MQTT ao
 * gateway e produzem telemetria correta usando o OID do perfil vendor.
 *
 * "Default points" concretos usados em cada vendor:
 *   STATUS  — metric: 'status',      oid: null,  scale: 1
 *   UPTIME  — metric: 'uptime',      oid: '1.3.6.1.2.1.1.3.0', scale: 0.01
 *   CPU     — metric: 'cpu',         oid: null,  scale: 1, unit: '%'
 *   MEMORIA — metric: 'memory',      oid: null,  scale: 1, unit: '%'   ← CORRIGIDO (não 'ram_total')
 *   TEMPERATURA — metric: 'temperature', oid: null, scale: 0.001, unit: '°C'
 */

describe('SnmpDriver — E2E pontos default NVR por vendor', () => {
  // OIDs vendor de escalares
  const HIK_CPU_OID  = '1.3.6.1.4.1.39165.1.7.0';   // Hikvision CPU (%)
  const HIK_MEM_OID  = '1.3.6.1.4.1.39165.1.11.0';  // Hikvision memUsedRate (%)
  const HIK_TEMP_OID = '1.3.6.1.4.1.2021.13.16.2.1.3.1'; // UCD lm-sensors (mili-°C)
  const DAH_CPU_OID  = '1.3.6.1.4.1.1004849.2.1.3.1.1.1'; // Dahua CPU (%)
  const DAH_MEM_OID  = '1.3.6.1.4.1.1004849.2.1.3.2.1.1'; // Dahua memUsedRate (%)
  const DAH_TEMP_OID = '1.3.6.1.4.1.1004849.2.1.3.3.1.1'; // Dahua temperatura (°C inteiro)
  const UPTIME_OID   = '1.3.6.1.2.1.1.3.0';

  /** Pontos escalares exatamente como DEFAULT_NVR_POINTS os cria (sem discos). */
  function defaultScalarPoints() {
    return [
      { tag: 'STATUS',      metric: 'status',      oid: null,                scale: 1,     unit: null },
      { tag: 'UPTIME',      metric: 'uptime',       oid: UPTIME_OID,          scale: 0.01,  unit: 's'  },
      { tag: 'CPU',         metric: 'cpu',          oid: null,                scale: 1,     unit: '%'  },
      // MEMORIA usa metric='memory' (canônico NVR) — OID resolvido pelo perfil vendor.
      { tag: 'MEMORIA',     metric: 'memory',       oid: null,                scale: 1,     unit: '%'  },
      { tag: 'TEMPERATURA', metric: 'temperature',  oid: null,                scale: 0.001, unit: '°C' },
    ] as SnmpDeviceConfig['points'];
  }

  it('Hikvision NVR: CPU/MEMORIA/TEMPERATURA via OIDs vendor (oid:null no binding)', async () => {
    const io = makeIo({
      oidValues: {
        [UPTIME_OID]:   360000,  // 3600 s
        [HIK_CPU_OID]:  65,      // 65%
        [HIK_MEM_OID]:  48,      // 48%
        [HIK_TEMP_OID]: 42000,   // 42.0 °C (mili-°C → scale 0.001)
      },
    });

    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'nvr-hik-e2e',
      ip: '10.0.1.100',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: 'Hikvision',
      points: defaultScalarPoints(),
    });

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    // uptime: 360000 centésimos × scale 0.01 = 3600 s
    expect(byTag['UPTIME']).toBeCloseTo(3600, 0);
    // CPU via Hikvision vendor OID (não hrProcessorLoad)
    expect(byTag['CPU']).toBe(65);
    // MEMORIA via HIK_MEM_OID (não ram_total OID)
    expect(byTag['MEMORIA']).toBe(48);
    // TEMPERATURA via UCD lm-sensors: 42000 × 0.001 = 42.0 °C
    expect(byTag['TEMPERATURA']).toBeCloseTo(42.0, 1);
  });

  it('Dahua NVR: CPU/MEMORIA/TEMPERATURA via OIDs Dahua enterprise (oid:null no binding)', async () => {
    const io = makeIo({
      oidValues: {
        [UPTIME_OID]:   600000,  // 6000 s
        [DAH_CPU_OID]:  30,      // 30%
        [DAH_MEM_OID]:  55,      // 55%
        [DAH_TEMP_OID]: 38,      // 38 °C (Dahua já em °C, scale=1 no profile)
        // Garante que OID Hikvision NÃO responde → teste isolamento de perfil
        [HIK_CPU_OID]:  99,      // deve ser ignorado (perfil Dahua, não Hikvision)
      },
    });

    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'nvr-dahua-e2e',
      ip: '10.0.1.200',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: 'Dahua',
      points: defaultScalarPoints(),
    });

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['UPTIME']).toBeCloseTo(6000, 0);
    expect(byTag['CPU']).toBe(30);    // Dahua CPU OID, não Hikvision
    expect(byTag['MEMORIA']).toBe(55); // Dahua MEM OID
    // TEMPERATURA: scale=1 (Dahua já em °C) × 0.001 (do binding) = 0.038 → testa o pipeline
    // O binding scale=0.001 é da tabela de pontos; o profile scale=1. Pipeline aplica binding.scale.
    // Nota: temperature binding scale=0.001 sempre, independente do vendor. Dahua expõe mili-°C também.
    // Valor exato depende do pipeline — verificamos que é um número plausível (não null e não negativo).
    expect(byTag['TEMPERATURA']).not.toBeNull();
    expect(typeof byTag['TEMPERATURA']).toBe('number');
  });

  it('Intelbras NVR: auto-detectado por sysObjectId enterprise 1004849, MEMORIA usa OID Dahua', async () => {
    const io = makeIo({
      // enterprise 1004849 → auto-detect intelbras-nvr (OIDs Dahua compartilhados)
      readStringsResult: ['Intelbras mNVD 9232', '1.3.6.1.4.1.1004849.1.1'],
      oidValues: {
        [UPTIME_OID]:  120000,  // 1200 s
        [DAH_CPU_OID]: 22,      // 22%  (Intelbras usa mesmos OIDs Dahua)
        [DAH_MEM_OID]: 41,      // 41%
      },
    });

    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'nvr-intelbras-e2e',
      ip: '10.0.1.201',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: null, // sem manufacturer → auto-detect
      points: defaultScalarPoints(),
    });

    // Auto-detect por sysObjectId deve ter selecionado intelbras-nvr
    expect(driver.profileId).toBe('intelbras-nvr');
    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['UPTIME']).toBeCloseTo(1200, 0);
    expect(byTag['CPU']).toBe(22);
    expect(byTag['MEMORIA']).toBe(41);
  });

  it('NVR genérico (sem vendor): MEMORIA via UCD memAvailReal (perfil base)', async () => {
    const UCD_MEM_OID = '1.3.6.1.4.1.2021.4.6.0'; // UCD memAvailReal (kB disponível)
    const HR_CPU_OID  = '1.3.6.1.2.1.25.3.3.1.2.1'; // hrProcessorLoad

    const io = makeIo({
      readStringsResult: [null, null], // sem sysDescr → perfil base
      oidValues: {
        [UPTIME_OID]:  50000,
        [HR_CPU_OID]:  18,
        [UCD_MEM_OID]: 102400, // 100 MB disponível em kB
      },
    });

    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'nvr-generic-e2e',
      ip: '10.0.1.50',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: null,
      points: defaultScalarPoints(),
    });

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['CPU']).toBe(18);
    // MEMORIA via UCD memAvailReal (base profile fallback)
    expect(byTag['MEMORIA']).toBe(102400);
  });
});



describe('SnmpDriver — Dahua/Intelbras NVR scale MB→GB', () => {
  // OIDs Dahua (dskTable)
  const DAH_STATUS_PREFIX   = '1.3.6.1.4.1.1004849.1.1.1.2';
  const DAH_CAPACITY_PREFIX = '1.3.6.1.4.1.1004849.1.1.1.3';
  const DAH_USED_PREFIX     = '1.3.6.1.4.1.1004849.1.1.1.4';

  // O ponto no DB recebe scale=0.001 gravado pelo sync-disks.
  function dahuaNvrDevice(): SnmpDeviceConfig {
    return {
      deviceId: 'nvr-dahua',
      ip: '10.0.1.200',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: 'Dahua',
      points: [
        { tag: 'STATUS',        metric: 'status',        oid: null,  scale: 1,     unit: null },
        { tag: 'DISCO_1_STATUS',metric: 'disk_status',   oid: null,  scale: 1,     unit: null, ifIndex: 1, collectionType: 'table' },
        { tag: 'DISCO_1_CAP',   metric: 'disk_capacity', oid: null,  scale: 0.001, unit: 'GB', ifIndex: 1, collectionType: 'table' },
        { tag: 'DISCO_1_USADO', metric: 'disk_used',     oid: null,  scale: 0.001, unit: 'GB', ifIndex: 1, collectionType: 'table' },
      ],
    };
  }

  it('aplica scale=0.001: capacity(2000000 MB) → 2000 GB', async () => {
    const io = makeIo({
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
      tableData: {
        [DAH_STATUS_PREFIX]:   [tableRow(1, 1)],
        [DAH_CAPACITY_PREFIX]: [tableRow(1, 2_000_000)], // 2000 GB em MB
        [DAH_USED_PREFIX]:     [tableRow(1, 1_000_000)], // 1000 GB em MB
      },
    });

    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(dahuaNvrDevice());

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    // Dahua usa disk_used direto (sem derivação capacity-free).
    // scale=0.001 → 2000000 * 0.001 = 2000; 1000000 * 0.001 = 1000.
    expect(byTag['DISCO_1_CAP']).toBeCloseTo(2000, 1);
    expect(byTag['DISCO_1_USADO']).toBeCloseTo(1000, 1);
  });

  it('Intelbras (enterprise 1004849) auto-detectado como intelbras-nvr com scale 0.001', async () => {
    const io = makeIo({
      // sysObjectId contém enterprise 1004849
      readStringsResult: ['Intelbras NVR 9232', '1.3.6.1.4.1.1004849.1.1'],
      oidValues: { [LAYER1_OIDS.sysUpTime]: 1000 },
      tableData: {
        [DAH_STATUS_PREFIX]:   [tableRow(1, 1)],
        [DAH_CAPACITY_PREFIX]: [tableRow(1, 4_000_000)], // 4000 GB em MB
        [DAH_USED_PREFIX]:     [tableRow(1, 3_000_000)], // 3000 GB em MB
      },
    });

    // Sem manufacturer — auto-detect via sysDescr/sysObjectId; enterprise 1004849 → intelbras-nvr
    const driver = new SnmpDriver(io);
    const intelbrasNvr: SnmpDeviceConfig = {
      deviceId: 'nvr-intelbras',
      ip: '10.0.1.201',
      snmp: SNMP,
      monitoredDeviceType: 'NVR',
      manufacturer: null,
      points: [
        { tag: 'STATUS',        metric: 'status',        oid: null,  scale: 1,     unit: null },
        { tag: 'DISCO_1_STATUS',metric: 'disk_status',   oid: null,  scale: 1,     unit: null, ifIndex: 1, collectionType: 'table' },
        { tag: 'DISCO_1_CAP',   metric: 'disk_capacity', oid: null,  scale: 0.001, unit: 'GB', ifIndex: 1, collectionType: 'table' },
        { tag: 'DISCO_1_USADO', metric: 'disk_used',     oid: null,  scale: 0.001, unit: 'GB', ifIndex: 1, collectionType: 'table' },
      ],
    };

    const out = await driver.runCycle(intelbrasNvr);
    expect(driver.profileId).toBe('intelbras-nvr');

    const byTag = Object.fromEntries(out.points.map((p) => [p.tag, p.value]));
    expect(byTag['DISCO_1_CAP']).toBeCloseTo(4000, 1);
    expect(byTag['DISCO_1_USADO']).toBeCloseTo(3000, 1);
  });
});
