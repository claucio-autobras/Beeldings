/**
 * Regressão: "valores SNMP que somem sozinhos" (Control iD e afins).
 *
 * Cobre três comportamentos exigidos pela correção, todos no nível do driver
 * (sem depender do net-snmp real — IO injetado):
 *
 *   1. Um OID persistido que nunca responde (rejeição CONCLUSIVA do agente em
 *      ciclos consecutivos) deixa de ser incluído no lote normal — o ponto
 *      passa a `unsupported` e some do batch, em vez de continuar forçando o
 *      caminho lento de releitura individual todo ciclo.
 *   2. Uma falha pontual (sem valor neste ciclo, mas equipamento acessível e
 *      OID persistido) NÃO publica null — o ponto é omitido do payload deste
 *      ciclo para preservar o último valor bom conhecido, e volta sozinho
 *      quando o próximo ciclo traz um valor válido.
 *   3. Um equipamento genuinamente inacessível (`readNumbers` retorna null)
 *      continua publicando null normalmente — nunca omite/preserva valor
 *      antigo como se fosse atual.
 */
import { SnmpDriver, type SnmpDeviceConfig, type SnmpDriverIo } from './snmp.driver';

const SNMP = { ip: '10.0.0.60', port: 161, community: 'public', snmpVersion: '2c' as const };
const CPU_OID = '1.3.6.1.4.1.49617.1.1.4.0';
const TEMP_OID = '1.3.6.1.4.1.49617.1.1.9.0';
const MEM_OID = '1.3.6.1.4.1.49617.1.1.8.0';

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

function baseIo(): SnmpDriverIo {
  return {
    readStrings: jest.fn().mockResolvedValue([null, null]),
    readNumbers: jest.fn(),
    pingLoss: jest.fn().mockResolvedValue(null),
    isapiUptime: jest.fn().mockResolvedValue(null),
    readTable: jest.fn().mockResolvedValue([]),
  };
}

describe('SnmpDriver — OID persistentemente inválido', () => {
  it('para de forçar o OID morto no lote após confirmar a rejeição em ciclos consecutivos', async () => {
    const io = baseIo();
    // TEMP_OID é sempre rejeitado conclusivamente pelo agente (não timeout);
    // CPU_OID sempre responde. O mock simula o contrato de rejectedOids do
    // readSnmpOids real: preenche o Set quando informado.
    (io.readNumbers as jest.Mock).mockImplementation(
      async (_target: unknown, oids: string[], rejectedOids?: Set<string>) => {
        if (oids.includes(TEMP_OID)) rejectedOids?.add(TEMP_OID);
        return oids.map((oid) => (oid === TEMP_OID ? null : oid === CPU_OID ? 42 : null));
      },
    );

    const driver = new SnmpDriver(io);
    const points: SnmpDeviceConfig['points'] = [
      { tag: 'CPU', metric: 'cpu_usage', oid: CPU_OID, scale: 1, unit: '%' },
      { tag: 'TEMP', metric: 'custom_temp', oid: TEMP_OID, scale: 1, unit: '°C' },
    ];

    const out1 = await driver.runCycle(device(points));
    expect((io.readNumbers as jest.Mock).mock.calls[0][1]).toEqual(
      expect.arrayContaining([CPU_OID, TEMP_OID]),
    );
    expect(driver.unsupportedOidsSnapshot).toEqual([]);
    // Ainda não confirmado (1ª rejeição): sem valor bom anterior para TEMP,
    // o ponto é omitido deste ciclo (equivalente a "sem dados", sem
    // republicar null explicitamente enquanto a suspeita não é confirmada).
    expect(out1.points.find((p) => p.tag === 'TEMP')).toBeUndefined();

    // 2ª rejeição consecutiva confirma o OID como permanentemente inválido.
    await driver.runCycle(device(points));
    expect(driver.unsupportedOidsSnapshot).toEqual([TEMP_OID]);

    // 3º ciclo: TEMP_OID não entra mais no lote — o ponto virou unsupported
    // e é excluído do batch, liberando o resto do device do caminho lento.
    const out3 = await driver.runCycle(device(points));
    expect((io.readNumbers as jest.Mock).mock.calls[2][1]).not.toContain(TEMP_OID);
    expect((io.readNumbers as jest.Mock).mock.calls[2][1]).toEqual(
      expect.arrayContaining([CPU_OID]),
    );
    const tempPoint = out3.points.find((p) => p.tag === 'TEMP');
    expect(tempPoint?.value).toBeNull();
    expect(tempPoint?.state).toBe('unsupported');
    // CPU nunca foi afetado pelo OID vizinho morto.
    expect(out3.points.find((p) => p.tag === 'CPU')?.value).toBe(42);
  });

  it('uma rejeição isolada (não consecutiva) não confirma o OID como inválido', async () => {
    const io = baseIo();
    let call = 0;
    (io.readNumbers as jest.Mock).mockImplementation(
      async (_target: unknown, oids: string[], rejectedOids?: Set<string>) => {
        call++;
        // Rejeita só no 1º ciclo; nos seguintes TEMP_OID responde normalmente
        // — a sequência foi interrompida, não deve confirmar.
        if (call === 1 && oids.includes(TEMP_OID)) rejectedOids?.add(TEMP_OID);
        return oids.map((oid) => (oid === TEMP_OID ? (call === 1 ? null : 21) : 42));
      },
    );

    const driver = new SnmpDriver(io);
    const points: SnmpDeviceConfig['points'] = [
      { tag: 'CPU', metric: 'cpu_usage', oid: CPU_OID, scale: 1, unit: '%' },
      { tag: 'TEMP', metric: 'custom_temp', oid: TEMP_OID, scale: 1, unit: '°C' },
    ];

    await driver.runCycle(device(points));
    await driver.runCycle(device(points));
    expect(driver.unsupportedOidsSnapshot).toEqual([]);

    const out3 = await driver.runCycle(device(points));
    // TEMP_OID continua no lote normalmente — nunca foi confirmado inválido.
    expect((io.readNumbers as jest.Mock).mock.calls[2][1]).toContain(TEMP_OID);
    expect(out3.points.find((p) => p.tag === 'TEMP')?.value).toBe(21);
  });
});

describe('SnmpDriver — preserva último valor bom em falha pontual', () => {
  function pointsWithMem(): SnmpDeviceConfig['points'] {
    return [{ tag: 'MEM', metric: 'custom_mem', oid: MEM_OID, scale: 1, unit: 'MB' }];
  }

  it('ausência de leitura neste ciclo (equipamento acessível) omite o ponto em vez de publicar null', async () => {
    const io = baseIo();
    let call = 0;
    (io.readNumbers as jest.Mock).mockImplementation(async (_t: unknown, oids: string[]) => {
      call++;
      // Ciclo 1: valor bom. Ciclo 2: falha pontual (sem valor, mas o
      // equipamento respondeu ao lote — array não-nulo). Ciclo 3: recupera.
      const memValue = call === 1 ? 512 : call === 2 ? null : 480;
      return oids.map((oid) => (oid === MEM_OID ? memValue : null));
    });

    const driver = new SnmpDriver(io);
    const cfg = device(pointsWithMem());

    const out1 = await driver.runCycle(cfg);
    expect(out1.points.find((p) => p.tag === 'MEM')?.value).toBe(512);

    const out2 = await driver.runCycle(cfg);
    // Falha pontual: o ponto MEM não aparece no payload deste ciclo — nem
    // como null nem com o valor antigo republicado; simplesmente omitido,
    // preservando o que já está persistido/ao vivo no backend/frontend.
    expect(out2.points.find((p) => p.tag === 'MEM')).toBeUndefined();
    expect(out2.reachable).toBe(true);

    const out3 = await driver.runCycle(cfg);
    // Auto-recuperação no ciclo seguinte, sem qualquer ação do operador.
    expect(out3.points.find((p) => p.tag === 'MEM')?.value).toBe(480);
  });

  it('equipamento genuinamente inacessível publica null normalmente (nunca preserva valor como atual)', async () => {
    const io = baseIo();
    (io.readNumbers as jest.Mock).mockResolvedValue(null); // device fora do ar

    const driver = new SnmpDriver(io);
    const cfg = device(pointsWithMem());

    const out = await driver.runCycle(cfg);

    expect(out.reachable).toBe(false);
    const memPoint = out.points.find((p) => p.tag === 'MEM');
    // Publicado explicitamente como null — nunca omitido quando offline.
    expect(memPoint).toBeDefined();
    expect(memPoint?.value).toBeNull();
  });
});
