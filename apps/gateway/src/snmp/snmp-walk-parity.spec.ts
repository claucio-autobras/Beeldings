/**
 * Teste de paridade com snmpwalk (spec de descoberta SNMP robusta).
 *
 * Sobe um agente SNMP simulado (net-snmp) carregado com a árvore REAL do
 * Control iD iDFlex V2 (firmware 5.13.9, extraída do walk de campo no PDF da
 * spec) e verifica que o walk genérico da aplicação descobre EXATAMENTE o
 * mesmo conjunto de OIDs que o `snmpwalk -v2c -c public <ip> 1.3.6.1.4.1.49617.1`
 * de referência — ordem irrelevante, sem equipamento físico.
 *
 * O iDFlex é apenas o equipamento de referência: o motor testado
 * (walkSnmpSubtree/resolveWalkRoots) é 100% genérico — nenhuma linha
 * específica de fabricante existe nele. O conhecimento Control iD vive só no
 * perfil (raiz de walk + enterprise), validado à parte.
 */

import * as snmp from 'net-snmp';

import {
  instanceIndexOf,
  openSnmpSession,
  resolveWalkRoots,
  walkSnmpSubtree,
  type DiscoveredSnmpObject,
} from './snmp-walk.util';
import { resolveDiscoveryWalkRoots } from '../profiles/profile-registry';
import { CONTROL_ID_PROFILE } from '../profiles/vendors/control-id.profile';
import { readSnmpOids } from './snmp-read.util';

/** Códigos ASN.1 (net-snmp ObjectType). */
const T_INT = 2;
const T_STR = 4;
const T_GAUGE = 66;

/**
 * Árvore real do iDFlex V2 fw 5.13.9 — transcrição 1:1 do snmpwalk do PDF.
 * 46 objetos: escalares .0, instâncias não-.0 (…1.4.2.1/2), entradas de
 * tabela indexadas (…1.7.3.1/2), STRING (inclusive vazia), INTEGER e Gauge32.
 */
const IDFLEX_TREE: Array<{ oid: string; type: number; value: string | number }> = [
  { oid: '1.3.6.1.4.1.49617.1.1.1.0', type: T_STR, value: '5.13.9' },
  { oid: '1.3.6.1.4.1.49617.1.1.2.0', type: T_STR, value: '0G0300/00062F' },
  { oid: '1.3.6.1.4.1.49617.1.1.3.0', type: T_STR, value: '1.420000 1.170000 0.730000' },
  { oid: '1.3.6.1.4.1.49617.1.1.4.0', type: T_STR, value: '23.436' },
  { oid: '1.3.6.1.4.1.49617.1.1.5.0', type: T_GAUGE, value: 91991 },
  { oid: '1.3.6.1.4.1.49617.1.1.6.0', type: T_STR, value: '17-08-2026 15-40-28' },
  { oid: '1.3.6.1.4.1.49617.1.1.7.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.1.8.0', type: T_STR, value: 'a.st1.ntp.br b.st1.ntp.br' },
  { oid: '1.3.6.1.4.1.49617.1.2.1.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.2.2.0', type: T_GAUGE, value: 80 },
  { oid: '1.3.6.1.4.1.49617.1.3.1.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.3.2.0', type: T_GAUGE, value: 43200 },
  { oid: '1.3.6.1.4.1.49617.1.3.3.0', type: T_STR, value: 'timed' },
  { oid: '1.3.6.1.4.1.49617.1.4.1.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.4.2.1', type: T_STR, value: '' },
  { oid: '1.3.6.1.4.1.49617.1.4.2.2', type: T_STR, value: 'Full' },
  { oid: '1.3.6.1.4.1.49617.1.5.1.0', type: T_GAUGE, value: 0 },
  { oid: '1.3.6.1.4.1.49617.1.5.2.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.5.3.0', type: T_INT, value: 1 },
  { oid: '1.3.6.1.4.1.49617.1.5.4.0', type: T_INT, value: 1 },
  { oid: '1.3.6.1.4.1.49617.1.5.5.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.6.1.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.6.2.0', type: T_GAUGE, value: 5 },
  { oid: '1.3.6.1.4.1.49617.1.6.3.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.6.4.0', type: T_INT, value: 1 },
  { oid: '1.3.6.1.4.1.49617.1.6.5.0', type: T_GAUGE, value: 120 },
  { oid: '1.3.6.1.4.1.49617.1.6.6.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.6.7.0', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.6.8.0', type: T_INT, value: 1 },
  { oid: '1.3.6.1.4.1.49617.1.6.9.0', type: T_GAUGE, value: 0 },
  { oid: '1.3.6.1.4.1.49617.1.7.1.0', type: T_GAUGE, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.7.2.0', type: T_STR, value: '' },
  { oid: '1.3.6.1.4.1.49617.1.7.3.1', type: T_GAUGE, value: 65793 },
  { oid: '1.3.6.1.4.1.49617.1.7.3.2', type: T_GAUGE, value: 84796 },
  { oid: '1.3.6.1.4.1.49617.1.7.4.1', type: T_INT, value: 1 },
  { oid: '1.3.6.1.4.1.49617.1.7.4.2', type: T_INT, value: 1 },
  { oid: '1.3.6.1.4.1.49617.1.7.5.1', type: T_STR, value: '2.1.2' },
  { oid: '1.3.6.1.4.1.49617.1.7.5.2', type: T_STR, value: '2.1.2' },
  { oid: '1.3.6.1.4.1.49617.1.7.6.1', type: T_GAUGE, value: 3000 },
  { oid: '1.3.6.1.4.1.49617.1.7.6.2', type: T_GAUGE, value: 3000 },
  { oid: '1.3.6.1.4.1.49617.1.7.7.1', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.7.7.2', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.7.8.1', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.7.8.2', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.7.9.1', type: T_INT, value: 2 },
  { oid: '1.3.6.1.4.1.49617.1.7.9.2', type: T_INT, value: 2 },
];

const WALK_ROOT = '1.3.6.1.4.1.49617.1';
const AGENT_HOST = '127.0.0.1';

/** Porta única por worker do jest (evita colisão em execução paralela). */
function pickPort(): number {
  const workerOffset = Number(process.env.JEST_WORKER_ID ?? '1') * 37;
  return 41610 + workerOffset + Math.floor(Math.random() * 500);
}

/**
 * Sobe um agente SNMP simulado servindo uma árvore arbitrária de OIDs.
 * Receita validada (net-snmp 3.x): provider Scalar registrado E anexado a um
 * nó ancestral + injeção direta de nós com valor/tipo na MIB.
 */
function startSimAgent(
  port: number,
  tree: Array<{ oid: string; type: number; value: string | number }>,
): { close: () => void } {
  const agent = (snmp as unknown as {
    createAgent: (
      options: Record<string, unknown>,
      cb: (err: Error | null) => void,
    ) => unknown;
  }).createAgent(
    { port, address: AGENT_HOST, disableAuthorization: true },
    () => undefined,
  );
  const anyAgent = agent as unknown as {
    getMib: () => {
      registerProvider: (p: Record<string, unknown>) => void;
      addProviderToNode: (p: Record<string, unknown>) => void;
      addNodesForOid: (oid: string) => { value: unknown; valueType: number };
    };
    close: () => void;
  };
  const mib = anyAgent.getMib();
  const provider = {
    name: 'simTree',
    type: (snmp as unknown as { MibProviderType: { Scalar: number } })
      .MibProviderType.Scalar,
    oid: '1.3.6.1.4.1.49617',
    scalarType: T_STR,
    maxAccess: (snmp as unknown as { MaxAccess: Record<string, number> })
      .MaxAccess['read-only'],
  };
  mib.registerProvider(provider);
  mib.addProviderToNode(provider);
  for (const entry of tree) {
    const node = mib.addNodesForOid(entry.oid);
    node.value = entry.value;
    node.valueType = entry.type;
  }
  return { close: () => anyAgent.close() };
}

describe('walk genérico — paridade com snmpwalk (iDFlex como referência)', () => {
  let port: number;
  let close: () => void;

  beforeAll(() => {
    port = pickPort();
    ({ close } = startSimAgent(port, IDFLEX_TREE));
  });

  afterAll(() => {
    close();
  });

  const target = (version: '1' | '2c') => ({
    ip: AGENT_HOST,
    port,
    version,
    community: 'public',
  });

  it('v2c: descobre EXATAMENTE o conjunto de OIDs do snmpwalk de referência', async () => {
    const result = await walkSnmpSubtree(target('2c'), WALK_ROOT, {
      budgetMs: 10_000,
    });

    expect(result.error).toBeNull();
    expect(result.responded).toBe(true);
    expect(result.truncated).toBe(false);

    const discovered = new Set(result.entries.map((e) => e.oid));
    const reference = new Set(IDFLEX_TREE.map((e) => e.oid));
    expect(discovered).toEqual(reference);
    expect(result.entries).toHaveLength(IDFLEX_TREE.length);
  });

  it('v1 (getNext): mesmo conjunto de OIDs do walk de referência', async () => {
    const result = await walkSnmpSubtree(target('1'), WALK_ROOT, {
      budgetMs: 15_000,
    });

    expect(result.responded).toBe(true);
    const discovered = new Set(result.entries.map((e) => e.oid));
    const reference = new Set(IDFLEX_TREE.map((e) => e.oid));
    expect(discovered).toEqual(reference);
  });

  it('preserva tipo ASN.1, valor bruto, valor normalizado e índice por entrada', async () => {
    const result = await walkSnmpSubtree(target('2c'), WALK_ROOT, {
      budgetMs: 10_000,
    });
    const byOid = new Map<string, DiscoveredSnmpObject>(
      result.entries.map((e) => [e.oid, e]),
    );

    // STRING numérica (USO DE CPU, fw 5.13.9): raw preservado + normalizado.
    const cpu = byOid.get('1.3.6.1.4.1.49617.1.1.4.0');
    expect(cpu).toMatchObject({ type: 'OctetString', value: '23.436', numeric: 23.436, index: null });

    // Gauge32 da TEMPERATURA em mili-°C (…1.1.5.0): valor bruto preservado —
    // a escala ÷1000 é aplicada pelo mapping do perfil, nunca no walk.
    const tempMilli = byOid.get('1.3.6.1.4.1.49617.1.1.5.0');
    expect(tempMilli).toMatchObject({ type: 'Gauge32', numeric: 91991, index: null });

    // Instância não-.0 (duplex da interface 2): índice extraído, string preservada.
    const duplex = byOid.get('1.3.6.1.4.1.49617.1.4.2.2');
    expect(duplex).toMatchObject({ type: 'OctetString', value: 'Full', numeric: null, index: 2 });

    // String VAZIA não é descartada.
    const empty = byOid.get('1.3.6.1.4.1.49617.1.4.2.1');
    expect(empty).toMatchObject({ type: 'OctetString', value: '', numeric: null, index: 1 });

    // Entrada de tabela indexada (…1.7.3.2).
    const tableEntry = byOid.get('1.3.6.1.4.1.49617.1.7.3.2');
    expect(tableEntry).toMatchObject({ type: 'Gauge32', numeric: 84796, index: 2 });

    // INTEGER simples.
    const ntpState = byOid.get('1.3.6.1.4.1.49617.1.1.7.0');
    expect(ntpState).toMatchObject({ type: 'Integer', numeric: 2, index: null });
  });

  it('subárvore inexistente com agente vivo ≠ indisponível (erro é resposta)', async () => {
    const result = await walkSnmpSubtree(target('2c'), '1.3.6.1.4.1.99999', {
      budgetMs: 2_500,
    });
    // Agente respondeu (endOfMibView/no-such); nunca classificar como timeout.
    expect(result.error).not.toBe('timeout');
    expect(result.entries).toHaveLength(0);
  }, 10_000);

  it('host mudo → timeout (equipamento indisponível), sem entradas', async () => {
    const deadPort = port + 1000;
    const result = await walkSnmpSubtree(
      { ip: AGENT_HOST, port: deadPort, version: '2c', community: 'public' },
      WALK_ROOT,
      { budgetMs: 4_000, requestTimeoutMs: 600 },
    );
    expect(result.responded).toBe(false);
    expect(result.error).toBe('timeout');
    expect(result.entries).toHaveLength(0);
  }, 10_000);

  it('perfil Control iD corrigido: CPU % em 1.1.4.0 e temperatura ÷1000 em 1.1.5.0', async () => {
    // Cadeia de coleta real: GET nos OIDs do mapping (parseSnmpNumber extrai
    // o número da STRING "23.436") + escala do perfil aplicada em cima.
    const byMetric = new Map(
      CONTROL_ID_PROFILE.mappings.map((m) => [m.metricKey, m]),
    );
    const cpuMap = byMetric.get('cpu')!;
    const tempMap = byMetric.get('temperature')!;
    const cpuOid = cpuMap.oid!;
    const tempOid = tempMap.oid!;
    expect(cpuOid).toBe('1.3.6.1.4.1.49617.1.1.4.0');
    expect(tempOid).toBe('1.3.6.1.4.1.49617.1.1.5.0');

    const values = await readSnmpOids(
      { ip: AGENT_HOST, port, snmpVersion: '2c', community: 'public' },
      [cpuOid, tempOid],
    );
    expect(values).not.toBeNull();
    const [cpuRaw, tempRaw] = values!;
    // STRING numérica "23.436" → 23,436% (scale 1).
    expect((cpuRaw as number) * (cpuMap.scale ?? 1)).toBeCloseTo(23.436, 3);
    // Gauge32 91991 mili-°C → 91,991 °C (scale 0.001).
    expect((tempRaw as number) * (tempMap.scale ?? 1)).toBeCloseTo(91.991, 3);
  }, 15_000);
});

describe('resolução de raízes de walk (motor genérico + perfis aditivos)', () => {
  it('perfil Control iD declara a raiz proprietária via enterprise 49617 do sysObjectID', () => {
    const roots = resolveDiscoveryWalkRoots({
      deviceType: 'ACCESS_CONTROLLER',
      sysObjectId: '1.3.6.1.4.1.49617.1.1',
    });
    expect(roots).toContain('1.3.6.1.4.1.49617.1');
  });

  it('perfil Control iD também casa por fabricante manual e enterprise legada 34475', () => {
    expect(
      resolveDiscoveryWalkRoots({
        deviceType: 'ACCESS_CONTROLLER',
        manufacturer: 'Control iD',
      }),
    ).toContain('1.3.6.1.4.1.49617.1');
    expect(
      resolveDiscoveryWalkRoots({
        deviceType: 'ACCESS_CONTROLLER',
        sysObjectId: '1.3.6.1.4.1.34475.5',
      }),
    ).toContain('1.3.6.1.4.1.49617.1');
  });

  it('raiz do perfil suprime o fallback da enterprise (mais específica) e mantém as padrão', () => {
    const roots = resolveWalkRoots({
      profileRoots: ['1.3.6.1.4.1.49617.1'],
      sysObjectId: '1.3.6.1.4.1.49617.1.1',
    });
    const oids = roots.map((r) => r.root);
    expect(oids).toContain('1.3.6.1.4.1.49617.1');
    expect(oids).not.toContain('1.3.6.1.4.1.49617');
    expect(oids).toContain('1.3.6.1.2.1.1');
    expect(oids).toContain('1.3.6.1.2.1.2');
    expect(oids).toContain('1.3.6.1.2.1.25');
    expect(oids).toContain('1.3.6.1.2.1.47');
  });

  it('fabricante SEM perfil → fallback genérico pela enterprise do sysObjectID', () => {
    const roots = resolveWalkRoots({
      profileRoots: [],
      sysObjectId: '1.3.6.1.4.1.424242.1.7',
    });
    expect(roots.map((r) => r.root)).toContain('1.3.6.1.4.1.424242');
  });

  it('dedupe por ancestralidade: raiz descendente de outra é removida', () => {
    const roots = resolveWalkRoots({
      profileRoots: ['1.3.6.1.2.1.1.1'],
      sysObjectId: null,
    });
    const oids = roots.map((r) => r.root);
    expect(oids).toContain('1.3.6.1.2.1.1');
    expect(oids).not.toContain('1.3.6.1.2.1.1.1');
  });
});

describe('transporte de sessão (pronto para v3, sem degradação silenciosa)', () => {
  it('v3 lança erro explícito — nunca degrada para v2c', () => {
    expect(() =>
      openSnmpSession({ ip: AGENT_HOST, port: 161, version: '3' }),
    ).toThrow(/SNMPv3/);
  });

  it('instanceIndexOf: .0 → null; instância → número; OID não numérico → null', () => {
    expect(instanceIndexOf('1.3.6.1.4.1.49617.1.1.1.0')).toBeNull();
    expect(instanceIndexOf('1.3.6.1.4.1.49617.1.7.3.2')).toBe(2);
    expect(instanceIndexOf('abc')).toBeNull();
  });
});

// ─── Orçamento ponta-a-ponta do diagnóstico (pior caso vs timeout do backend) ─

import {
  DIAG_TOTAL_BUDGET_MS,
  WALK_MIN_RESERVE_MS,
  diagPhaseDeadlines,
} from './snmp-diagnose.service';

describe('orçamento ponta-a-ponta do diagnóstico (pior caso)', () => {
  /** Timeout do backend (apps/backend snmp-diagnose.service DIAGNOSE_TIMEOUT_MS). */
  const BACKEND_TIMEOUT_MS = 120_000;
  /** Folga para publish MQTT + processamento do backend. */
  const SAFETY_MARGIN_MS = 10_000;

  it('o orçamento total cabe no timeout do backend com folga', () => {
    expect(DIAG_TOTAL_BUDGET_MS + SAFETY_MARGIN_MS).toBeLessThanOrEqual(
      BACKEND_TIMEOUT_MS,
    );
  });

  it('as fases de GET/retry sempre preservam a reserva mínima do walk', () => {
    const startedAt = 1_000_000;
    const { deadline, getPhaseDeadline } = diagPhaseDeadlines(startedAt);
    expect(deadline - getPhaseDeadline).toBe(WALK_MIN_RESERVE_MS);
    expect(getPhaseDeadline).toBe(startedAt + DIAG_TOTAL_BUDGET_MS - WALK_MIN_RESERVE_MS);
    expect(WALK_MIN_RESERVE_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('pior caso: nenhum candidato responde — o deadline corta os GETs antes do walk', () => {
    // Cada GET sem resposta consome timeout (2,5s) + pausa (150ms). Sem o
    // deadline compartilhado, 40 candidatos mudos = 2 passadas × 40 × 2,65s
    // ≈ 212s — estouraria o timeout do backend. Com o deadline, a fase de
    // GETs para em (total − reserva) e o walk ainda roda.
    const PER_GET_WORST_MS = 2_500 + 150;
    const CANDIDATES = 40;
    const unbounded = 2 * CANDIDATES * PER_GET_WORST_MS;
    expect(unbounded).toBeGreaterThan(BACKEND_TIMEOUT_MS); // o cenário é real

    const startedAt = 0;
    const { deadline, getPhaseDeadline } = diagPhaseDeadlines(startedAt);
    // Simula o loop: avança o relógio a cada GET e respeita o deadline.
    let now = startedAt;
    let gets = 0;
    for (let i = 0; i < CANDIDATES * 2; i++) {
      if (now >= getPhaseDeadline) break;
      now += PER_GET_WORST_MS;
      gets += 1;
    }
    expect(now).toBeLessThanOrEqual(getPhaseDeadline + PER_GET_WORST_MS);
    // O walk ainda tem pelo menos a reserva (menos o overshoot de 1 GET).
    expect(deadline - now).toBeGreaterThanOrEqual(
      WALK_MIN_RESERVE_MS - PER_GET_WORST_MS,
    );
    expect(gets).toBeLessThan(CANDIDATES * 2);
  });

  it('walk com orçamento mínimo retorna rápido em vez de estourar', async () => {
    const res = await walkSnmpSubtree(
      { ip: '127.0.0.1', port: 1, version: '2c', community: 'public' },
      '1.3.6.1.4.1.49617.1',
      { maxEntries: 10, budgetMs: 500, requestTimeoutMs: 400 },
    );
    expect(res.durationMs).toBeLessThan(5_000);
    expect(res.entries).toHaveLength(0);
  });
});
