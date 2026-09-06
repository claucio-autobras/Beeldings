/**
 * Specs do modelo genérico de exibição dos cards SNMP (CFTV + SCA) —
 * cadeia inteira validada com a árvore REAL do iDFlex fw 5.13.9:
 * walk → semântica (com plausibilidade) → aplicação de OIDs (ponte
 * canônica) → payload de exibição do card (`display` + `snmpInfo`).
 *
 * Também prova o fluxo 100% genérico com um "fabricante fictício" sem
 * perfil dedicado: tudo que o equipamento expõe vira métrica exibível ou
 * informação nomeada — nada coletado fica invisível e zero código por
 * fabricante no motor/card.
 */

import {
  buildSnmpCardDisplay,
  extractSnmpInfoEntries,
  SNMP_CARD_CATEGORY_LABELS,
} from './snmp-card-metrics.util.js';
import { buildDiscoveredObjects } from './snmp-oid-semantics.js';
import {
  applyCustomDiscoveredPoints,
  customPointTag,
  sanitizeCustomPoints,
} from './snmp-custom-points.util.js';

// ─── Fixture: recorte da árvore REAL do iDFlex fw 5.13.9 ────────────────────

const CID = '1.3.6.1.4.1.49617.1';

const IDFLEX_WALK = [
  {
    root: '1.3.6.1.2.1.1',
    entries: [
      { oid: '1.3.6.1.2.1.1.1.0', value: 'iDFlex', type: 'OctetString', numeric: null, index: null },
      { oid: '1.3.6.1.2.1.1.3.0', value: '1234500', type: 'TimeTicks', numeric: 12345, index: null },
    ],
  },
  {
    root: CID,
    entries: [
      // cidSystem — fw 5.13.9 NÃO expõe hasProVersion → árvore deslocada.
      { oid: `${CID}.1.1.0`, value: '5.13.9', type: 'OctetString', numeric: null, index: null },
      { oid: `${CID}.1.2.0`, value: '3C0BA680000000', type: 'OctetString', numeric: null, index: null },
      { oid: `${CID}.1.3.0`, value: '1.42 1.17 0.73', type: 'OctetString', numeric: null, index: null },
      { oid: `${CID}.1.4.0`, value: '23.436', type: 'OctetString', numeric: 23.436, index: null },
      { oid: `${CID}.1.5.0`, value: '91991', type: 'Gauge32', numeric: 91991, index: null },
      { oid: `${CID}.1.6.0`, value: '2026-08-18 10:22:33', type: 'OctetString', numeric: null, index: null },
      { oid: `${CID}.1.7.0`, value: '1', type: 'Integer', numeric: 1, index: null },
      { oid: `${CID}.1.8.0`, value: 'pool.ntp.org', type: 'OctetString', numeric: null, index: null },
      // cidOperationMode.devicePort — info de rede, não métrica de desempenho.
      { oid: `${CID}.2.2.0`, value: '80', type: 'Integer', numeric: 80, index: null },
      // cidNetwork
      { oid: `${CID}.4.1.0`, value: '2', type: 'Integer', numeric: 2, index: null },
      { oid: `${CID}.4.2.1`, value: '1', type: 'Integer', numeric: 1, index: 1 },
    ],
  },
];

describe('cadeia completa fw 5.13.9 — walk → semântica → apply → card', () => {
  const discovered = buildDiscoveredObjects(IDFLEX_WALK);
  const byOid = new Map(discovered.map((d) => [d.oid, d]));

  it('classifica CPU/temperatura no layout REAL do firmware e confirma plausibilidade', () => {
    const cpu = byOid.get(`${CID}.1.4.0`)!;
    expect(cpu.known).toMatchObject({ metricKey: 'cpu_usage', confirmed: true });
    // "23.436" (string numérica) → valor normalizado numérico.
    expect(cpu.value).toBeCloseTo(23.436);

    const temp = byOid.get(`${CID}.1.5.0`)!;
    expect(temp.known).toMatchObject({
      metricKey: 'temperature',
      scale: 0.001,
      confirmed: true,
    });

    const load = byOid.get(`${CID}.1.3.0`)!;
    expect(load.known).toMatchObject({ category: 'performance', confirmed: true });
  });

  it('extrai informações estáticas (firmware, serial, data/hora, NTP, DHCP) p/ o card', () => {
    const info = extractSnmpInfoEntries(discovered, new Date('2026-08-18T13:00:00Z'));
    const labels = info.map((e) => e.label.toLowerCase()).join(' | ');
    expect(labels).toMatch(/firmware/);
    expect(labels).toMatch(/série|serial/);
    expect(labels).toMatch(/ntp/);
    // INTEGER booleano 1 → "Sim"; 2 → "Não".
    const ntp = info.find((e) => e.oid === `${CID}.1.7.0`)!;
    expect(ntp.value).toBe('Sim');
    const dhcp = info.find((e) => e.oid === `${CID}.4.1.0`)!;
    expect(dhcp.value).toBe('Não');
    // Toda entrada carrega categoria válida do catálogo de exibição.
    for (const e of info) {
      expect(SNMP_CARD_CATEGORY_LABELS[e.category]).toBeDefined();
    }
  });

  it('texto SEM semântica conhecida também persiste como informação nomeada (nada invisível)', () => {
    const info = extractSnmpInfoEntries(
      [
        // Desconhecido textual com nome da MIB importada.
        {
          oid: '1.3.6.1.4.1.77777.9.1.0',
          raw: 'v2.0.1-rc3',
          value: null,
          mibName: 'appVersion',
          known: null,
        },
        // Desconhecido textual sem MIB → nome neutro pelo OID.
        {
          oid: '1.3.6.1.4.1.77777.9.2.0',
          raw: 'gate-07 leste',
          value: null,
          known: null,
        },
        // Desconhecido NUMÉRICO é candidato a métrica, não informação.
        { oid: '1.3.6.1.4.1.77777.9.3.0', raw: '42', value: 42, known: null },
        // Semântica reprovada na plausibilidade → entra com nome neutro,
        // nunca com o rótulo semântico possivelmente errado.
        {
          oid: '1.3.6.1.4.1.77777.9.4.0',
          raw: '1.42 1.17 0.73',
          value: null,
          known: {
            name: 'Uso de CPU',
            category: 'performance',
            valueKind: 'number',
            importance: 'primary',
            confirmed: false,
          },
        },
      ],
      new Date('2026-08-18T13:00:00Z'),
    );
    const byOid = new Map(info.map((e) => [e.oid, e]));
    expect(byOid.get('1.3.6.1.4.1.77777.9.1.0')).toMatchObject({
      label: 'appVersion',
      value: 'v2.0.1-rc3',
      category: 'other',
    });
    expect(byOid.get('1.3.6.1.4.1.77777.9.2.0')).toMatchObject({
      // "Unknown OID" é o prefixo esperado agora (não o número cru).
      label: 'Unknown OID 1.3.6.1.4.1.77777.9.2.0',
      value: 'gate-07 leste',
    });
    expect(byOid.has('1.3.6.1.4.1.77777.9.3.0')).toBe(false);
    const demoted = byOid.get('1.3.6.1.4.1.77777.9.4.0')!;
    // Label usa "Unknown OID" como prefixo — NUNCA o rótulo semântico possivelmente errado.
    expect(demoted.label).toBe('Unknown OID 1.3.6.1.4.1.77777.9.4.0');
    expect(demoted.label).not.toMatch(/CPU/);
  });

  it('filtra ruído de catálogo MIB (sysORDescr) e strings hexadecimais desconhecidas', () => {
    const sysOrDescr = '1.3.6.1.2.1.1.9.1.2.1';
    const sysOrUpTime = '1.3.6.1.2.1.1.9.1.3.1';
    const info = extractSnmpInfoEntries(
      [
        // sysORDescr — descrição de módulo MIB do agente: deve ser filtrado.
        {
          oid: sysOrDescr,
          raw: 'The SNMP Management Architecture MIB.',
          value: null,
          known: null,
        },
        // sysORUpTime — outro item da sysORTable: filtrado pelo prefixo.
        {
          oid: sysOrUpTime,
          raw: '123456',
          value: 123456,
          known: null,
        },
        // String hexadecimal pura longa (serial bruto desconhecido): filtrada.
        {
          oid: '1.3.6.1.4.1.99999.1.1.0',
          raw: '3C0BA680000000FF',
          value: null,
          known: null,
        },
        // Serial legível (texto normal): deve aparecer normalmente.
        {
          oid: '1.3.6.1.4.1.99999.1.2.0',
          raw: 'SN-2024-ABC',
          value: null,
          mibName: 'serialNumber',
          known: null,
        },
        // Dump de configuração com pipe: filtrado.
        {
          oid: '1.3.6.1.4.1.99999.1.3.0',
          raw: 'mode=1|ttl=64|timeout=30|retry=3|interval=10|flags=0xFF',
          value: null,
          known: null,
        },
      ],
      new Date('2026-08-18T13:00:00Z'),
    );
    const oids = info.map((e) => e.oid);
    // Ruído filtrado.
    expect(oids).not.toContain(sysOrDescr);
    expect(oids).not.toContain(sysOrUpTime);
    expect(oids).not.toContain('1.3.6.1.4.1.99999.1.1.0'); // hex puro
    expect(oids).not.toContain('1.3.6.1.4.1.99999.1.3.0'); // config dump
    // Serial legível permanece.
    expect(oids).toContain('1.3.6.1.4.1.99999.1.2.0');
    const serial = info.find((e) => e.oid === '1.3.6.1.4.1.99999.1.2.0')!;
    expect(serial.value).toBe('SN-2024-ABC');
  });

  it('serial hexadecimal CONFIRMADO (semântica known) nunca é filtrado', () => {
    // O serial do Control iD é hex — mas é uma entrada CONHECIDA (confirmed=true),
    // portanto passa pela ramificação known e nunca atinge o filtro de hex.
    const info = extractSnmpInfoEntries(
      [
        {
          oid: '1.3.6.1.4.1.49617.1.1.2.0',
          raw: '3C0BA680000000',
          value: null,
          known: {
            name: 'Número de série',
            category: 'identification',
            valueKind: 'text',
            importance: 'info',
            confirmed: true,
          },
        },
      ],
      new Date('2026-08-18T13:00:00Z'),
    );
    expect(info).toHaveLength(1);
    expect(info[0].value).toBe('3C0BA680000000');
    expect(info[0].label).toBe('Número de série');
  });

  it('booleano INTEGER segue TruthValue: 1=Sim, 0 e 2 = Não', () => {
    const mk = (oid: string, raw: string) => ({
      oid,
      raw,
      value: Number(raw),
      known: {
        name: 'Alarme ativo',
        category: 'system' as const,
        valueKind: 'boolean' as const,
        importance: 'info' as const,
        confirmed: true,
      },
    });
    const info = extractSnmpInfoEntries(
      [mk('1.1', '1'), mk('1.2', '2'), mk('1.3', '0')],
      new Date(),
    );
    expect(info.map((e) => e.value)).toEqual(['Sim', 'Não', 'Não']);
  });

  it('aplica OIDs via ponte semântica→canônica preservando IDs e deriva o display', async () => {
    // Device com pontos canônicos "quebrados" (mapeamento invertido antigo):
    // temperatura apontando p/ 1.1.4.0 (que na verdade é CPU) e CPU sem OID.
    const points = [
      { id: 'pt-temp', tag: 'TEMPERATURA', instance: 3, binding: { metric: 'temperature', oid: null, unsupported: true } },
      { id: 'pt-cpu', tag: 'CPU', instance: 2, binding: { metric: 'cpu', oid: null, unsupported: true } },
    ];
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      devicePoint: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `new-${created.length}`, tag: data.tag as string, instance: 99, binding: data.binding };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: where.id, data });
          return {};
        },
      },
    };

    const selections = sanitizeCustomPoints([
      { oid: `${CID}.1.4.0`, name: 'Uso de CPU', unit: '%' },
      { oid: `${CID}.1.5.0`, name: 'Temperatura', unit: '°C' },
      { oid: `${CID}.1.3.0`, name: 'Load average' },
    ]);
    await applyCustomDiscoveredPoints(prisma, 'dev-1', points, selections);

    // CPU e temperatura REPONTADAS nos pontos canônicos existentes (IDs
    // preservados — trends/alarmes sobrevivem), nunca duplicadas.
    const cpuUpd = updates.find((u) => u.id === 'pt-cpu')!;
    expect((cpuUpd.data.binding as Record<string, unknown>).oid).toBe(`${CID}.1.4.0`);
    const tempUpd = updates.find((u) => u.id === 'pt-temp')!;
    const tempBinding = tempUpd.data.binding as Record<string, unknown>;
    expect(tempBinding.oid).toBe(`${CID}.1.5.0`);
    // Escala ÷1000 acompanha o OID (mili-°C → °C).
    expect(tempBinding.scale).toBe(0.001);

    // Load average sem métrica canônica → ponto novo exibível (nunca some).
    const loadCreated = created.find(
      (c) => ((c.binding ?? {}) as Record<string, unknown>).oid === `${CID}.1.3.0`,
    )!;
    expect(loadCreated).toBeDefined();
    expect(loadCreated.tag).toBe(customPointTag(`${CID}.1.3.0`));

    // Display derivado por dados: métricas conhecidas usam o catálogo canônico.
    const cpuDisplay = buildSnmpCardDisplay({
      tag: 'CPU', objectName: 'Uso de CPU', metric: 'cpu', oid: `${CID}.1.4.0`, unit: '%',
    });
    expect(cpuDisplay).toMatchObject({
      origin: 'canonical', importance: 'primary', category: 'performance',
    });

    const loadDisplay = buildSnmpCardDisplay({
      tag: customPointTag(`${CID}.1.3.0`),
      objectName: 'Load average',
      metric: (loadCreated.binding as Record<string, unknown>).metric as string,
      oid: `${CID}.1.3.0`,
      unit: '',
    });
    expect(loadDisplay.origin).toBe('canonical');
    expect(loadDisplay.label).toBe('Load average'); // nome do operador vence
    expect(loadDisplay.category).toBe('performance');
  });
});

describe('plausibilidade reprovada NUNCA vira rótulo/métrica canônica no apply', () => {
  // Firmware com o layout da DOC oficial (expõe hasProVersion): a árvore NÃO
  // está deslocada, então 1.1.4.0 é loadAverage (string "x.xx x.xx x.xx") —
  // incompatível com a semântica cpu_usage (%) mapeada p/ o fw 5.13.9.
  const DOC_LAYOUT_WALK = [
    {
      root: CID,
      entries: [
        { oid: `${CID}.1.4.0`, value: '1.42 1.17 0.73', type: 'OctetString', numeric: null, index: null },
        { oid: `${CID}.1.5.0`, value: '23', type: 'Gauge32', numeric: 23, index: null },
      ],
    },
  ];

  it('cadeia diagnóstico→apply: OID reprovado entra como custom sem ponte canônica', async () => {
    const discovered = buildDiscoveredObjects(DOC_LAYOUT_WALK);
    const cpuCandidate = discovered.find((d) => d.oid === `${CID}.1.4.0`)!;
    // Diagnóstico rebaixa: valor incompatível → não confirmado, sem metricKey.
    expect(cpuCandidate.known).toMatchObject({ confirmed: false, metricKey: null });

    // Mesma derivação do controller: veredito persistido e consultado no apply.
    const unconfirmedOids = new Set(
      discovered.filter((d) => d.known?.confirmed === false).map((d) => d.oid),
    );
    expect(unconfirmedOids.has(`${CID}.1.4.0`)).toBe(true);

    const points = [
      { id: 'pt-cpu', tag: 'CPU', instance: 1, binding: { metric: 'cpu', oid: null, unsupported: true } },
    ];
    const updates: Array<{ id: string }> = [];
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      devicePoint: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'new-1', tag: data.tag as string, instance: 9, binding: data.binding };
        },
        update: async ({ where }: { where: { id: string } }) => {
          updates.push({ id: where.id });
          return {};
        },
      },
    };

    // Frontend malicioso/antigo enviando o rótulo semântico ("Uso de CPU"):
    // o backend precisa se defender sozinho.
    const semanticName = 'Uso de CPU';
    await applyCustomDiscoveredPoints(
      prisma,
      'dev-doc',
      points,
      sanitizeCustomPoints([{ oid: `${CID}.1.4.0`, name: semanticName, unit: '%' }]),
      unconfirmedOids,
    );

    // NÃO repontou o ponto canônico de CPU (rótulo errado bloqueado).
    expect(updates.find((u) => u.id === 'pt-cpu')).toBeUndefined();
    // Entrou como custom com nome neutro e sem escala semântica.
    expect(created).toHaveLength(1);
    const binding = created[0].binding as Record<string, unknown>;
    expect(binding.metric).toBe('custom');
    expect(binding.scale).toBe(1);
    expect(created[0].objectName).toBe(`OID ${CID}.1.4.0`);
  });

  it('nome dado deliberadamente pelo operador é mantido mesmo sem confirmação', async () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      devicePoint: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'x', tag: data.tag as string, instance: 1, binding: data.binding };
        },
        update: async () => ({}),
      },
    };
    await applyCustomDiscoveredPoints(
      prisma,
      'dev-doc',
      [],
      sanitizeCustomPoints([{ oid: `${CID}.1.4.0`, name: 'Carga do sistema (doc)' }]),
      new Set([`${CID}.1.4.0`]),
    );
    expect(created[0].objectName).toBe('Carga do sistema (doc)');
    expect((created[0].binding as Record<string, unknown>).metric).toBe('custom');
  });
});

describe('fabricante fictício sem perfil dedicado (fluxo 100% genérico)', () => {
  const FICTA = '1.3.6.1.4.1.99999';
  const walk = [
    {
      root: FICTA,
      entries: [
        { oid: `${FICTA}.7.1.0`, value: '42', type: 'Gauge32', numeric: 42, index: null },
        { oid: `${FICTA}.7.2.0`, value: 'Ficta OS 2.0', type: 'OctetString', numeric: null, index: null },
      ],
    },
  ];

  it('OIDs desconhecidos nunca são descartados e viram pontos exibíveis', async () => {
    const discovered = buildDiscoveredObjects(walk);
    expect(discovered).toHaveLength(2);
    expect(discovered.every((d) => d.known === null)).toBe(true);

    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      devicePoint: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'x', tag: data.tag as string, instance: 1, binding: data.binding };
        },
        update: async () => ({}),
      },
    };
    await applyCustomDiscoveredPoints(
      prisma,
      'dev-ficta',
      [],
      sanitizeCustomPoints([{ oid: `${FICTA}.7.1.0`, name: 'Sensores ativos' }]),
    );
    expect(created).toHaveLength(1);

    // Card: nome do operador, categoria 'other', origem custom — visível.
    const display = buildSnmpCardDisplay({
      tag: customPointTag(`${FICTA}.7.1.0`),
      objectName: 'Sensores ativos',
      metric: (created[0].binding as Record<string, unknown>).metric as string,
      oid: `${FICTA}.7.1.0`,
      unit: '',
    });
    expect(display).toMatchObject({
      label: 'Sensores ativos',
      origin: 'custom',
      category: 'other',
    });
    expect(display.categoryLabel).toBe(SNMP_CARD_CATEGORY_LABELS.other);
  });
});
