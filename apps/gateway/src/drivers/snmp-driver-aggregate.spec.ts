/**
 * SnmpDriver — métricas AGREGADAS via memberOids (task 968).
 *
 * Trava o contrato do polling contínuo de agregados:
 *  1. TODOS os OIDs membros do binding entram no batch de GET escalar; readTable
 *     (walk/subtree) NUNCA é chamado — leitura por GET only.
 *  2. cpu/cpu_usage = MÉDIA de todos os membros hrProcessorLoad (nunca o
 *     primeiro core).
 *  3. memory_used_percent = used/size*100 do mesmo índice hrStorage (as
 *     allocation units se cancelam na razão).
 *  4. memory_total = size*alloc → bytes quando as dependências existem.
 *  5. Sem memberOids → comportamento histórico preservado.
 *  6. storage_used_percent/memory_used_percent com MÚLTIPLAS linhas hrStorage
 *     (vários volumes/entradas) = MÉDIA entre as linhas com leitura válida
 *     NESTE ciclo — nunca "a primeira válida" (isso fazia o card saltar de
 *     percentual a cada ciclo conforme qual volume falhava). Falha pontual de
 *     UM volume só o exclui da média do ciclo; sem nenhum volume válido,
 *     publica null (preserva o último valor bom, task 1059).
 */

jest.mock('../snmp/snmp-read.util', () => ({
  readSnmpOids: jest.fn(),
  readSnmpStrings: jest.fn(),
}));

import { SnmpDriver, type SnmpDeviceConfig } from './snmp.driver';
import { LAYER1_OIDS } from '../cameras/provider-registry';

const SNMP = { ip: '10.0.2.10', port: 161, community: 'public', snmpVersion: '2c' as const };

function makeIo(oidValues: Record<string, number | null> = {}) {
  return {
    readStrings: jest.fn().mockResolvedValue([null, null]),
    readNumbers: jest.fn(async (_t: unknown, oids: string[]) =>
      oids.map((o) => (o in oidValues ? oidValues[o] : null)),
    ),
    pingLoss: jest.fn().mockResolvedValue(null),
    isapiUptime: jest.fn().mockResolvedValue(null),
    readTable: jest.fn().mockResolvedValue([]),
  };
}

const HR_CPU = '1.3.6.1.2.1.25.3.3.1.2';
const HR_STORAGE_ALLOC = '1.3.6.1.2.1.25.2.3.1.4';
const HR_STORAGE_SIZE = '1.3.6.1.2.1.25.2.3.1.5';
const HR_STORAGE_USED = '1.3.6.1.2.1.25.2.3.1.6';

// Cores hrProcessorLoad: índices 1..4.
const CPU_MEMBERS = [`${HR_CPU}.1`, `${HR_CPU}.2`, `${HR_CPU}.3`, `${HR_CPU}.4`];
// Memória: índice hrStorage=1.
const MEM_PCT_MEMBERS = [`${HR_STORAGE_USED}.1`, `${HR_STORAGE_SIZE}.1`];
const MEM_TOTAL_MEMBERS = [`${HR_STORAGE_SIZE}.1`, `${HR_STORAGE_ALLOC}.1`];

function aggregateDevice(points: SnmpDeviceConfig['points']): SnmpDeviceConfig {
  return {
    deviceId: 'host-1',
    ip: '10.0.2.10',
    snmp: SNMP,
    monitoredDeviceType: 'CAMERA',
    manufacturer: null,
    restrictToBindings: true,
    points,
  };
}

describe('SnmpDriver — métricas agregadas por memberOids', () => {
  it('inclui TODOS os OIDs membros no batch de GET; readTable/walk NUNCA é chamado', async () => {
    const io = makeIo({
      [`${HR_CPU}.1`]: 10,
      [`${HR_CPU}.2`]: 20,
      [`${HR_CPU}.3`]: 30,
      [`${HR_CPU}.4`]: 40,
    });
    const driver = new SnmpDriver(io);
    await driver.runCycle(
      aggregateDevice([
        {
          tag: 'CPU',
          metric: 'cpu_usage',
          oid: CPU_MEMBERS[0], // binding oid = primeiro membro
          scale: 1,
          unit: '%',
          memberOids: CPU_MEMBERS,
        },
      ]),
    );

    // Nenhum walk/subtree — leitura por GET only.
    expect(io.readTable).not.toHaveBeenCalled();
    expect(io.readStrings).not.toHaveBeenCalled();

    const allOids = io.readNumbers.mock.calls.map((c) => c[1] as string[]).flat();
    for (const m of CPU_MEMBERS) {
      expect(allOids).toContain(m);
    }
  });

  it('cpu_usage = MÉDIA de todos os cores (não o primeiro core)', async () => {
    const io = makeIo({
      [`${HR_CPU}.1`]: 10,
      [`${HR_CPU}.2`]: 20,
      [`${HR_CPU}.3`]: 30,
      [`${HR_CPU}.4`]: 40,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'CPU',
          metric: 'cpu_usage',
          oid: CPU_MEMBERS[0],
          scale: 1,
          unit: '%',
          memberOids: CPU_MEMBERS,
        },
      ]),
    );

    const cpu = out.points.find((p) => p.tag === 'CPU');
    // média = (10+20+30+40)/4 = 25 — nunca 10 (primeiro core).
    expect(cpu?.value).toBe(25);
    expect(cpu?.value).not.toBe(10);
  });

  it('cpu média ignora membros sem valor (mede só cores válidos)', async () => {
    const io = makeIo({
      [`${HR_CPU}.1`]: 50,
      [`${HR_CPU}.2`]: null,
      [`${HR_CPU}.3`]: 70,
      [`${HR_CPU}.4`]: null,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        { tag: 'CPU', metric: 'cpu', oid: CPU_MEMBERS[0], scale: 1, unit: '%', memberOids: CPU_MEMBERS },
      ]),
    );
    // média dos válidos = (50+70)/2 = 60.
    expect(out.points.find((p) => p.tag === 'CPU')?.value).toBe(60);
  });

  it('cpu_usage_peak publica o máximo dos mesmos membros sem novo walk', async () => {
    const io = makeIo({
      [`${HR_CPU}.1`]: 10,
      [`${HR_CPU}.2`]: 80,
      [`${HR_CPU}.3`]: 30,
      [`${HR_CPU}.4`]: 40,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'CPU_USAGE_PEAK',
          metric: 'cpu_usage_peak',
          oid: CPU_MEMBERS[0],
          scale: 1,
          unit: '%',
          memberOids: CPU_MEMBERS,
        },
      ]),
    );
    expect(out.points.find((p) => p.tag === 'CPU_USAGE_PEAK')?.value).toBe(80);
    expect(io.readTable).not.toHaveBeenCalled();
  });

  it('memory_used_percent = used/size*100 do mesmo índice (alloc cancela na razão)', async () => {
    const io = makeIo({
      [`${HR_STORAGE_USED}.1`]: 300,
      [`${HR_STORAGE_SIZE}.1`]: 1000,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'MEM',
          metric: 'memory_used_percent',
          oid: MEM_PCT_MEMBERS[0],
          scale: 1,
          unit: '%',
          memberOids: MEM_PCT_MEMBERS,
        },
      ]),
    );
    // 300/1000*100 = 30.
    expect(out.points.find((p) => p.tag === 'MEM')?.value).toBe(30);
  });

  it('memory_total = size*alloc em bytes quando dependências presentes', async () => {
    const io = makeIo({
      // size (páginas) * alloc (bytes/página) = 2 GiB.
      [`${HR_STORAGE_SIZE}.1`]: 524_288, // 512K páginas
      [`${HR_STORAGE_ALLOC}.1`]: 4096, // 4 KiB por página
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'MEM_TOTAL',
          metric: 'memory_total',
          oid: MEM_TOTAL_MEMBERS[0],
          scale: 1,
          unit: 'bytes',
          memberOids: MEM_TOTAL_MEMBERS,
        },
      ]),
    );
    // 524288 * 4096 = 2 GiB em bytes.
    expect(out.points.find((p) => p.tag === 'MEM_TOTAL')?.value).toBe(2 * 1024 * 1024 * 1024);
  });

  it('storage_used_percent deriva um volume isolado por memberOids', async () => {
    const volumeMembers = [
      `${HR_STORAGE_ALLOC}.7`,
      `${HR_STORAGE_SIZE}.7`,
      `${HR_STORAGE_USED}.7`,
    ];
    const io = makeIo({
      [`${HR_STORAGE_ALLOC}.7`]: 4096,
      [`${HR_STORAGE_SIZE}.7`]: 2000,
      [`${HR_STORAGE_USED}.7`]: 500,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'STORAGE_7',
          metric: 'storage_used_percent',
          oid: `${HR_STORAGE_USED}.7`,
          scale: 1,
          unit: '%',
          memberOids: volumeMembers,
        },
      ]),
    );
    expect(out.points.find((p) => p.tag === 'STORAGE_7')?.value).toBe(25);
    expect(io.readTable).not.toHaveBeenCalled();
  });

  it('storage_used_percent com múltiplos volumes = MÉDIA entre eles (nunca o primeiro)', async () => {
    // Volume 7: 500/2000*100 = 25%. Volume 9: 1800/2000*100 = 90%.
    const members = [
      `${HR_STORAGE_ALLOC}.7`, `${HR_STORAGE_SIZE}.7`, `${HR_STORAGE_USED}.7`,
      `${HR_STORAGE_ALLOC}.9`, `${HR_STORAGE_SIZE}.9`, `${HR_STORAGE_USED}.9`,
    ];
    const io = makeIo({
      [`${HR_STORAGE_ALLOC}.7`]: 4096,
      [`${HR_STORAGE_SIZE}.7`]: 2000,
      [`${HR_STORAGE_USED}.7`]: 500,
      [`${HR_STORAGE_ALLOC}.9`]: 4096,
      [`${HR_STORAGE_SIZE}.9`]: 2000,
      [`${HR_STORAGE_USED}.9`]: 1800,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'STORAGE',
          metric: 'storage_used_percent',
          oid: `${HR_STORAGE_USED}.7`,
          scale: 1,
          unit: '%',
          memberOids: members,
        },
      ]),
    );
    // média = (25 + 90) / 2 = 57.5 — nunca 25 (o "primeiro" volume por índice).
    expect(out.points.find((p) => p.tag === 'STORAGE')?.value).toBe(57.5);
  });

  it('storage_used_percent: falha pontual de UM volume não troca o representativo nem derruba o valor', async () => {
    const members = [
      `${HR_STORAGE_ALLOC}.7`, `${HR_STORAGE_SIZE}.7`, `${HR_STORAGE_USED}.7`,
      `${HR_STORAGE_ALLOC}.9`, `${HR_STORAGE_SIZE}.9`, `${HR_STORAGE_USED}.9`,
    ];
    const point: SnmpDeviceConfig['points'][number] = {
      tag: 'STORAGE',
      metric: 'storage_used_percent',
      oid: `${HR_STORAGE_USED}.7`,
      scale: 1,
      unit: '%',
      memberOids: members,
    };
    const values: Record<string, number | null> = {
      [`${HR_STORAGE_ALLOC}.7`]: 4096,
      [`${HR_STORAGE_SIZE}.7`]: 2000,
      [`${HR_STORAGE_USED}.7`]: 500, // 25%
      [`${HR_STORAGE_ALLOC}.9`]: 4096,
      [`${HR_STORAGE_SIZE}.9`]: 2000,
      [`${HR_STORAGE_USED}.9`]: 1800, // 90%
    };
    const io = makeIo(values);
    const driver = new SnmpDriver(io);
    const device = aggregateDevice([point]);

    const first = await driver.runCycle(device);
    expect(first.points.find((p) => p.tag === 'STORAGE')?.value).toBe(57.5);

    // Ciclo seguinte: volume 7 falha a leitura pontualmente (equipamento
    // continua acessível) — a média deve usar só o volume 9 (90%), nunca
    // saltar para um valor de um volume "trocado" nem cair para null/zero.
    values[`${HR_STORAGE_USED}.7`] = null;
    values[`${HR_STORAGE_SIZE}.7`] = null;
    const second = await driver.runCycle(device);
    expect(second.points.find((p) => p.tag === 'STORAGE')?.value).toBe(90);

    // Volume 7 volta a responder — a média volta a refletir os dois volumes.
    values[`${HR_STORAGE_USED}.7`] = 500;
    values[`${HR_STORAGE_SIZE}.7`] = 2000;
    const third = await driver.runCycle(device);
    expect(third.points.find((p) => p.tag === 'STORAGE')?.value).toBe(57.5);
  });

  it('storage_used_percent: nenhum volume válido no ciclo → null (preserva último valor bom, não publica 0)', async () => {
    const members = [
      `${HR_STORAGE_ALLOC}.7`, `${HR_STORAGE_SIZE}.7`, `${HR_STORAGE_USED}.7`,
      `${HR_STORAGE_ALLOC}.9`, `${HR_STORAGE_SIZE}.9`, `${HR_STORAGE_USED}.9`,
    ];
    const io = makeIo({
      [`${HR_STORAGE_ALLOC}.7`]: 4096,
      [`${HR_STORAGE_SIZE}.7`]: null,
      [`${HR_STORAGE_USED}.7`]: null,
      [`${HR_STORAGE_ALLOC}.9`]: 4096,
      [`${HR_STORAGE_SIZE}.9`]: null,
      [`${HR_STORAGE_USED}.9`]: null,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'STORAGE',
          metric: 'storage_used_percent',
          oid: `${HR_STORAGE_USED}.7`,
          scale: 1,
          unit: '%',
          memberOids: members,
        },
      ]),
    );
    // Nenhum volume respondeu neste ciclo → tag omitida do payload (não
    // publica null nem 0) para preservar o último valor bom conhecido.
    expect(out.points.find((p) => p.tag === 'STORAGE')).toBeUndefined();
  });

  it('memory_used_percent com múltipla entrada RAM: comportamento de uma única entrada permanece intacto', async () => {
    // Caso comum (uma entrada RAM física): média de 1 valor = o próprio valor.
    const io = makeIo({
      [`${HR_STORAGE_USED}.1`]: 300,
      [`${HR_STORAGE_SIZE}.1`]: 1000,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'MEM',
          metric: 'memory_used_percent',
          oid: MEM_PCT_MEMBERS[0],
          scale: 1,
          unit: '%',
          memberOids: MEM_PCT_MEMBERS,
        },
      ]),
    );
    expect(out.points.find((p) => p.tag === 'MEM')?.value).toBe(30);
  });

  it('memory_total: entre múltiplas entradas válidas, escolhe a de maior size de forma determinística', async () => {
    const members = [
      `${HR_STORAGE_SIZE}.1`, `${HR_STORAGE_ALLOC}.1`,
      `${HR_STORAGE_SIZE}.2`, `${HR_STORAGE_ALLOC}.2`,
    ];
    const io = makeIo({
      [`${HR_STORAGE_SIZE}.1`]: 524_288, // 512K páginas * 4096 = 2 GiB
      [`${HR_STORAGE_ALLOC}.1`]: 4096,
      [`${HR_STORAGE_SIZE}.2`]: 1024, // entrada menor (ex.: swap pequeno)
      [`${HR_STORAGE_ALLOC}.2`]: 4096,
    });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([
        {
          tag: 'MEM_TOTAL',
          metric: 'memory_total',
          oid: members[0],
          scale: 1,
          unit: 'bytes',
          memberOids: members,
        },
      ]),
    );
    expect(out.points.find((p) => p.tag === 'MEM_TOTAL')?.value).toBe(2 * 1024 * 1024 * 1024);
  });

  it('sem memberOids: comportamento histórico preservado (usa o OID escalar único)', async () => {
    const CPU_OID = '1.3.6.1.4.1.99.1.0';
    const io = makeIo({ [CPU_OID]: 42 });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle(
      aggregateDevice([{ tag: 'CPU', metric: 'cpu', oid: CPU_OID, scale: 1, unit: '%' }]),
    );
    expect(io.readTable).not.toHaveBeenCalled();
    // valor cru do OID escalar (sem agregação).
    expect(out.points.find((p) => p.tag === 'CPU')?.value).toBe(42);
  });

  it('converte todos os contadores canônicos de rede em taxa e soma in+out por membro', async () => {
    const SYS_UPTIME = LAYER1_OIDS.sysUpTime;
    const IN = '1.3.6.1.2.1.2.2.1.10.1';
    const OUT = '1.3.6.1.2.1.2.2.1.16.1';
    const ERR_IN = '1.3.6.1.2.1.2.2.1.14.1';
    const ERR_OUT = '1.3.6.1.2.1.2.2.1.20.1';
    const DISC_IN = '1.3.6.1.2.1.2.2.1.13.1';
    const DISC_OUT = '1.3.6.1.2.1.2.2.1.19.1';
    const values: Record<string, number | null> = {
      [SYS_UPTIME]: 10_000,
      [IN]: 1_000,
      [OUT]: 4_000,
      [ERR_IN]: 10,
      [ERR_OUT]: 20,
      [DISC_IN]: 5,
      [DISC_OUT]: 7,
    };
    const io = makeIo(values);
    const driver = new SnmpDriver(io);
    const device = aggregateDevice([
      { tag: 'UPTIME', metric: 'uptime', oid: SYS_UPTIME, scale: 0.01, unit: 's' },
      { tag: 'NET_IN', metric: 'net_in_rate', oid: IN, unit: 'B/s' },
      { tag: 'NET_OUT', metric: 'net_out_rate', oid: OUT, unit: 'B/s' },
      {
        tag: 'NET_ERRORS',
        metric: 'net_error_rate',
        oid: ERR_IN,
        unit: 'pkt/s',
        memberOids: [ERR_IN, ERR_OUT],
      },
      {
        tag: 'NET_DISCARDS',
        metric: 'net_discard_rate',
        oid: DISC_IN,
        unit: 'pkt/s',
        memberOids: [DISC_IN, DISC_OUT],
      },
    ]);
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      const first = await driver.runCycle(device);
      expect(first.points.find((p) => p.tag === 'NET_IN')?.value).toBeNull();

      Object.assign(values, {
        [SYS_UPTIME]: 10_100,
        [IN]: 1_600,
        [OUT]: 5_000,
        [ERR_IN]: 13,
        [ERR_OUT]: 24,
        [DISC_IN]: 7,
        [DISC_OUT]: 10,
      });
      now.mockReturnValue(2_000);
      const second = await driver.runCycle(device);
      expect(second.points.find((p) => p.tag === 'NET_IN')?.value).toBe(600);
      expect(second.points.find((p) => p.tag === 'NET_OUT')?.value).toBe(1_000);
      expect(second.points.find((p) => p.tag === 'NET_ERRORS')?.value).toBe(7);
      expect(second.points.find((p) => p.tag === 'NET_DISCARDS')?.value).toBe(5);

      // Reboot: uptime diminuiu; nenhuma taxa pode virar pico falso.
      Object.assign(values, {
        [SYS_UPTIME]: 500,
        [IN]: 100,
        [OUT]: 100,
        [ERR_IN]: 1,
        [ERR_OUT]: 1,
        [DISC_IN]: 1,
        [DISC_OUT]: 1,
      });
      now.mockReturnValue(3_000);
      const reboot = await driver.runCycle(device);
      for (const tag of ['NET_IN', 'NET_OUT', 'NET_ERRORS', 'NET_DISCARDS']) {
        expect(reboot.points.find((p) => p.tag === tag)?.value).toBeNull();
      }
    } finally {
      now.mockRestore();
    }
  });

  it('trata wrap Counter32 na taxa canônica sem pico falso', async () => {
    const OID = '1.3.6.1.2.1.2.2.1.10.1';
    const values: Record<string, number | null> = { [OID]: 4_294_967_290 };
    const io = makeIo(values);
    const driver = new SnmpDriver(io);
    const device = aggregateDevice([
      { tag: 'NET_IN', metric: 'net_in_rate', oid: OID, unit: 'B/s' },
    ]);
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      await driver.runCycle(device);
      values[OID] = 4;
      now.mockReturnValue(2_000);
      const wrapped = await driver.runCycle(device);
      expect(wrapped.points.find((p) => p.tag === 'NET_IN')?.value).toBe(10);
    } finally {
      now.mockRestore();
    }
  });

  it('sem flag restrita ainda usa GET coluna.índice e nunca readTable', async () => {
    const column = '1.3.6.1.2.1.2.2.1.8';
    const io = makeIo({ [`${column}.3`]: 1 });
    const driver = new SnmpDriver(io);
    const out = await driver.runCycle({
      deviceId: 'switch-legacy',
      ip: '10.0.2.11',
      snmp: SNMP,
      monitoredDeviceType: 'SWITCH',
      points: [{
        tag: 'PORT_3',
        metric: 'if_oper_status',
        oid: column,
        ifIndex: 3,
        collectionType: 'table',
      }],
    });
    expect(out.points.find((p) => p.tag === 'PORT_3')?.value).toBe(1);
    expect(io.readTable).not.toHaveBeenCalled();
    expect(io.readStrings).not.toHaveBeenCalled();
  });
});
