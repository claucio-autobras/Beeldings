import {
  CameraTelemetryEngine,
  type EngineDevice,
  type EngineIo,
} from './camera-telemetry.engine';
import {
  LAYER1_OIDS,
  enterpriseNumberOf,
  resolveProvider,
} from './provider-registry';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SNMP = { ip: '10.0.0.5', port: 161, community: 'public', version: '2c' } as any;

/** IO fake: responde OIDs a partir de um mapa; null = câmera muda (timeout). */
function makeIo(overrides: Partial<EngineIo> & { oidValues?: Record<string, number | null> } = {}): EngineIo {
  const { oidValues, ...rest } = overrides;
  return {
    readNumbers: async (_t, oids) =>
      oidValues ? oids.map((o) => oidValues[o] ?? null) : null,
    readStrings: async () => [null, null],
    pingLoss: async () => null,
    isapiUptime: async () => null,
    ...rest,
  };
}

const basePoints = [
  { tag: 'CAM_STATUS', metric: 'status' },
  { tag: 'CAM_UPTIME', metric: 'uptime', unit: 's' },
  { tag: 'CAM_CPU', metric: 'cpu', unit: '%' },
  { tag: 'CAM_PING', metric: 'ping_loss', unit: '%' },
];

function device(extra: Partial<EngineDevice> = {}): EngineDevice {
  return {
    deviceId: 'cam-1',
    ip: '10.0.0.5',
    snmp: SNMP,
    points: basePoints,
    ...extra,
  };
}

function pointOf(out: { points: Array<{ tag: string }> }, tag: string) {
  return out.points.find((p) => p.tag === tag)! as any;
}

// ─── resolveProvider (identificação) ─────────────────────────────────────────

describe('resolveProvider', () => {
  it('config manual tem precedência máxima', () => {
    const p = resolveProvider({ manufacturer: 'Dahua', sysDescr: 'Hikvision DS-2CD' });
    expect(p?.id).toBe('dahua');
  });

  it('identifica pela sysDescr quando não há config manual', () => {
    expect(resolveProvider({ sysDescr: 'HIKVISION DS-2CD2043' })?.id).toBe('hikvision');
  });

  it('identifica pelo enterprise do sysObjectID', () => {
    expect(resolveProvider({ sysObjectId: '1.3.6.1.4.1.39165.1.1' })?.id).toBe('hikvision');
  });

  it('enterprise 1004849 ambíguo → Intelbras (melhor-esforço)', () => {
    const p = resolveProvider({ pointOids: ['1.3.6.1.4.1.1004849.2.1.3.0'] });
    expect(p?.id).toBe('intelbras');
    expect(p?.bestEffort).toBe(true);
  });

  it('cadastro manual Dahua desempata o enterprise compartilhado', () => {
    const p = resolveProvider({
      manufacturer: 'dahua',
      pointOids: ['1.3.6.1.4.1.1004849.2.1.3.0'],
    });
    expect(p?.id).toBe('dahua');
    expect(p?.bestEffort).toBeUndefined();
  });

  it('sem pistas → null (motor cai p/ Camada 3)', () => {
    expect(resolveProvider({})).toBeNull();
  });

  it('enterpriseNumberOf extrai N de 1.3.6.1.4.1.N e rejeita MIB-II', () => {
    expect(enterpriseNumberOf('1.3.6.1.4.1.39165.1.7.0')).toBe(39165);
    expect(enterpriseNumberOf(LAYER1_OIDS.sysUpTime)).toBeNull();
    expect(enterpriseNumberOf(null)).toBeNull();
  });
});

// ─── Motor: ordem das camadas / prioridade real > estimativa ────────────────

describe('CameraTelemetryEngine — camadas e prioridades', () => {
  it('uptime: ISAPI (HTTP real) vence sysUpTime MIB-II', async () => {
    const io = makeIo({
      readStrings: async () => ['Hikvision DS-2CD', null],
      oidValues: { [LAYER1_OIDS.sysUpTime]: 500_000 },
      isapiUptime: async () => 12345,
    });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(
      device({ http: { username: 'admin', password: 'x' } }),
    );
    const up = pointOf(out, 'CAM_UPTIME');
    expect(up.value).toBe(12345);
    expect(up.source).toBe('http');
    expect(up.state).toBeUndefined();
  });

  it('uptime: sysUpTime MIB-II (real) vence a estimativa; TimeTicks → segundos', async () => {
    const io = makeIo({ oidValues: { [LAYER1_OIDS.sysUpTime]: 360_000 } });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(device());
    const up = pointOf(out, 'CAM_UPTIME');
    expect(up.value).toBe(3600);
    expect(up.source).toBe('mib2');
  });

  it('uptime sem nenhuma fonte real → null com state estimated (backend deriva)', async () => {
    const io = makeIo({ oidValues: {} });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(device());
    const up = pointOf(out, 'CAM_UPTIME');
    expect(up.value).toBeNull();
    expect(up.state).toBe('estimated');
  });

  it('métricas: OID do ponto vence campo do provider', async () => {
    const hikCpu = '1.3.6.1.4.1.39165.1.7.0';
    const io = makeIo({
      readStrings: async () => ['hikvision', null],
      oidValues: { 'custom.oid.cpu': 55, [hikCpu]: 90 } as any,
    });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(
      device({ points: [{ tag: 'CAM_CPU', metric: 'cpu', oid: 'custom.oid.cpu' }] }),
    );
    const cpu = pointOf(out, 'CAM_CPU');
    expect(cpu.value).toBe(55);
    expect(cpu.source).toBe('oid');
  });

  it('fallback POR CAMPO: cpu do provider preenche, memory ausente fica null', async () => {
    const hikCpu = '1.3.6.1.4.1.39165.1.7.0';
    const io = makeIo({
      readStrings: async () => ['hikvision', null],
      oidValues: { [hikCpu]: 42 },
    });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(
      device({
        points: [
          { tag: 'CAM_CPU', metric: 'cpu' },
          { tag: 'CAM_MEM', metric: 'memory' },
        ],
      }),
    );
    expect(pointOf(out, 'CAM_CPU').value).toBe(42);
    expect(pointOf(out, 'CAM_CPU').source).toBe('provider');
    expect(pointOf(out, 'CAM_MEM').value).toBeNull();
  });

  it('packet_loss cai p/ MIB-II (ifInDiscards+ifInErrors) quando sem OID/provider', async () => {
    const io = makeIo({
      oidValues: {
        [LAYER1_OIDS.ifInDiscards]: 3,
        [LAYER1_OIDS.ifInErrors]: 2,
      },
    });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(
      device({ points: [{ tag: 'CAM_LOSS', metric: 'packet_loss' }] }),
    );
    const loss = pointOf(out, 'CAM_LOSS');
    expect(loss.value).toBe(5);
    expect(loss.source).toBe('mib2');
  });

  it('ping_loss (Camada 3) vem marcado como estimated/source ping', async () => {
    const io = makeIo({ oidValues: {}, pingLoss: async () => 25 });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(device());
    const ping = pointOf(out, 'CAM_PING');
    expect(ping.value).toBe(25);
    expect(ping.state).toBe('estimated');
    expect(ping.source).toBe('ping');
  });

  it('câmera sem SNMP: reachable deriva do ping; STATUS acompanha', async () => {
    const io = makeIo({ pingLoss: async () => 100 });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(device({ snmp: null }));
    expect(out.reachable).toBe(false);
    expect(pointOf(out, 'CAM_STATUS').value).toBe(0);
  });

  it('ponto unsupported não é lido e sai com state unsupported', async () => {
    const io = makeIo({ oidValues: { 'oid.x': 7 } as any });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(
      device({
        points: [{ tag: 'CAM_TEMP', metric: 'temperature', oid: 'oid.x', unsupported: true }],
      }),
    );
    const t = pointOf(out, 'CAM_TEMP');
    expect(t.value).toBeNull();
    expect(t.state).toBe('unsupported');
  });
});

// ─── Sentinelas Intelbras (dado não confiável) ───────────────────────────────

describe('CameraTelemetryEngine — sentinelas Intelbras', () => {
  // OIDs OFICIAIS Dahua: cpuUsage 2.1.3.0 / memoryUsage 2.1.9.2.0
  const dahuaCpu = '1.3.6.1.4.1.1004849.2.1.3.0';
  const dahuaMem = '1.3.6.1.4.1.1004849.2.1.9.2.0';

  it('valor 0 em campo com sentinela → unreliable (só naquele campo)', async () => {
    const io = makeIo({ oidValues: { [dahuaCpu]: 0, [dahuaMem]: 41 } });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(
      device({
        manufacturer: 'Intelbras',
        points: [
          { tag: 'CAM_CPU', metric: 'cpu' },
          { tag: 'CAM_MEM', metric: 'memory' },
        ],
      }),
    );
    const cpu = pointOf(out, 'CAM_CPU');
    expect(cpu.value).toBe(0);
    expect(cpu.unreliable).toBe(true);
    const mem = pointOf(out, 'CAM_MEM');
    expect(mem.value).toBe(41);
    expect(mem.unreliable).toBeUndefined();
  });

  it('Dahua (sem bestEffort) NÃO marca 0 como não confiável', async () => {
    const io = makeIo({ oidValues: { [dahuaCpu]: 0 } });
    const engine = new CameraTelemetryEngine(io);
    const out = await engine.runCycle(
      device({ manufacturer: 'Dahua', points: [{ tag: 'CAM_CPU', metric: 'cpu' }] }),
    );
    expect(pointOf(out, 'CAM_CPU').unreliable).toBeUndefined();
  });
});

// ─── Identificação com retry ─────────────────────────────────────────────────

describe('CameraTelemetryEngine — identificação', () => {
  it('câmera muda no 1º ciclo → identifica no ciclo seguinte', async () => {
    let alive = false;
    const hikCpu = '1.3.6.1.4.1.39165.1.7.0';
    const io = makeIo({
      readStrings: async () => (alive ? ['hikvision ipc', null] : null),
      readNumbers: async (_t, oids) =>
        alive ? oids.map((o) => (o === hikCpu ? 33 : null)) : null,
    });
    const engine = new CameraTelemetryEngine(io);
    const d = device({ points: [{ tag: 'CAM_CPU', metric: 'cpu' }] });

    await engine.runCycle(d);
    expect(engine.providerId).toBeNull();

    alive = true;
    const out = await engine.runCycle(d);
    expect(engine.providerId).toBe('hikvision');
    expect(pointOf(out, 'CAM_CPU').value).toBe(33);
  });
});
