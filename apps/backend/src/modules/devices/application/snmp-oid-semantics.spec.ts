/**
 * Specs da camada de interpretação semântica da descoberta SNMP.
 *
 * Garante o princípio da spec: descoberta separada da interpretação — TODOS
 * os objetos do walk viram candidatos; sem semântica = "OID desconhecido"
 * (known: null), nunca descartado.
 *
 * Control iD fw 5.13.9 (árvore REAL de campo): cidSystem deslocada em um
 * índice vs a doc oficial (fw omite hasProVersion) — 1.1.4.0 é USO DE CPU
 * ("23.436" %) e 1.1.5.0 é a TEMPERATURA (Gauge32 mili-°C). A validação de
 * plausibilidade protege contra firmwares com o layout da doc.
 */

import {
  buildDiscoveredObjects,
  checkSnmpPlausibility,
  classifySnmpOid,
  resolveCanonicalMetric,
  SNMP_OID_SEMANTICS,
} from './snmp-oid-semantics.js';
import {
  customPointTag,
  sanitizeCustomPoints,
} from './snmp-custom-points.util.js';

describe('classifySnmpOid', () => {
  it('classifica OIDs do Control iD conforme o fw REAL 5.13.9 (árvore deslocada)', () => {
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.1.1.0')).toMatchObject({
      category: 'identification',
      metricKey: 'firmware_version',
    });
    // fw 5.13.9: 1.1.4.0 = USO DE CPU (não temperatura!).
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.1.4.0')).toMatchObject({
      category: 'performance',
      metricKey: 'cpu_usage',
      unit: '%',
    });
    // fw 5.13.9: 1.1.5.0 = temperatura em mili-°C (escala ÷1000).
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.1.5.0')).toMatchObject({
      category: 'hardware',
      metricKey: 'temperature',
      unit: '°C',
      scale: 0.001,
    });
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.1.7.0')).toMatchObject({
      category: 'system',
      metricKey: 'ntp_enabled',
    });
    // Correção: 1.4.1.0 é DHCP habilitado (doc oficial), não "status da rede".
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.4.1.0')).toMatchObject({
      category: 'network',
      metricKey: 'dhcp_enabled',
    });
  });

  it('classifica as demais subárvores da MIB oficial ao menos como informação nomeada', () => {
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.2.2.0')).toMatchObject({
      metricKey: 'device_port',
      category: 'network',
    });
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.3.1.0')).toMatchObject({
      metricKey: 'antipassback_enabled',
      category: 'security',
    });
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.7.3.2')?.category).toBe('application');
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.9.7.0')).toMatchObject({
      metricKey: 'device_violation_alarm_enabled',
    });
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.10.6.0')?.category).toBe('security');
  });

  it('casa instâncias de tabela por prefixo (duplex por interface)', () => {
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.4.2.1')).toMatchObject({
      metricKey: 'if_duplex',
    });
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.4.2.2')).toMatchObject({
      metricKey: 'if_duplex',
    });
    // O prefixo NÃO casa o próprio nó pai nem OIDs irmãos.
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.4.20.1')).toBeNull();
  });

  it('entradas exatas têm precedência sobre prefixos da mesma subárvore', () => {
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.6.1.0')?.metricKey).toBe('sip_enabled');
    expect(classifySnmpOid('1.3.6.1.4.1.49617.1.6.5.0')?.name).toBe('Interfone SIP');
  });

  it('normaliza fabricantes diferentes para a MESMA métrica canônica (cpu_usage)', () => {
    const hik = classifySnmpOid('1.3.6.1.4.1.39165.1.7.0');
    const hostRes = classifySnmpOid('1.3.6.1.2.1.25.3.3.1.2.1');
    const controlId = classifySnmpOid('1.3.6.1.4.1.49617.1.1.4.0');
    expect(hik?.metricKey).toBe('cpu_usage');
    expect(hostRes?.metricKey).toBe('cpu_usage');
    expect(controlId?.metricKey).toBe('cpu_usage');
  });

  it('tabela não contém entradas duplicadas de OID exato', () => {
    const exact = SNMP_OID_SEMANTICS.filter((s) => !s.prefix).map((s) => s.oid);
    expect(new Set(exact).size).toBe(exact.length);
  });

  // ── Hikvision OFICIAL (enterprise 50001 — HIKVISION-MIB / hikEntity) ────────
  it('Hikvision 50001: escalares oficiais com nome/categoria (nunca "OID desconhecido")', () => {
    expect(classifySnmpOid('1.3.6.1.4.1.50001.1.221.0')).toMatchObject({
      metricKey: 'memory_usage',
      unit: '%',
      category: 'performance',
    });
    expect(classifySnmpOid('1.3.6.1.4.1.50001.1.220.0')).toMatchObject({
      metricKey: 'ram_total',
      unit: 'MB',
    });
    expect(classifySnmpOid('1.3.6.1.4.1.50001.1.100.0')?.metricKey).toBe('product_type');
    expect(classifySnmpOid('1.3.6.1.4.1.50001.1.230.0')?.metricKey).toBe('device_status');
    expect(classifySnmpOid('1.3.6.1.4.1.50001.1.240.0')?.metricKey).toBe('disk_count');
  });

  it('Hikvision hikDiskTable: colunas casam por prefixo com escala MB→GB', () => {
    // Instância .1 (disco 1) de cada coluna.
    const free = classifySnmpOid('1.3.6.1.4.1.50001.1.241.1.4.1');
    const cap = classifySnmpOid('1.3.6.1.4.1.50001.1.241.1.5.1');
    const status = classifySnmpOid('1.3.6.1.4.1.50001.1.241.1.3.1');
    expect(free).toMatchObject({ metricKey: 'disk_free', unit: 'GB', scale: 0.001 });
    expect(cap).toMatchObject({ metricKey: 'disk_capacity', unit: 'GB', scale: 0.001 });
    expect(status?.metricKey).toBe('disk_status_raw');
  });

  it('Hikvision 50001: catch-all da subárvore hikEntity para OIDs não listados', () => {
    const s = classifySnmpOid('1.3.6.1.4.1.50001.1.999.0');
    expect(s).not.toBeNull();
    expect(s?.name).toContain('Hikvision');
  });

  // ── Dahua/Intelbras OFICIAL (root 1004849.2) ────────────────────────────────
  it('Dahua oficial: cpuUsage escalar 2.1.3.0 e memoryUsage 2.1.9.2.0', () => {
    expect(classifySnmpOid('1.3.6.1.4.1.1004849.2.1.3.0')).toMatchObject({
      metricKey: 'cpu_usage',
      unit: '%',
    });
    expect(classifySnmpOid('1.3.6.1.4.1.1004849.2.1.9.2.0')).toMatchObject({
      metricKey: 'memory_usage',
      unit: '%',
    });
    expect(classifySnmpOid('1.3.6.1.4.1.1004849.2.1.2.1.0')?.metricKey).toBe('video_channels');
    expect(classifySnmpOid('1.3.6.1.4.1.1004849.2.1.1.1.0')?.metricKey).toBe('firmware_version');
  });

  it('Dahua physicalVolumeInfoTable: colunas por prefixo (status texto, uso %, total GB)', () => {
    const status = classifySnmpOid('1.3.6.1.4.1.1004849.2.4.1.1.5.1');
    const usage = classifySnmpOid('1.3.6.1.4.1.1004849.2.4.1.1.6.1');
    const total = classifySnmpOid('1.3.6.1.4.1.1004849.2.4.1.1.7.1');
    expect(status).toMatchObject({ metricKey: 'disk_status_text', valueKind: 'text' });
    expect(usage).toMatchObject({ metricKey: 'disk_usage_pct', unit: '%' });
    expect(total).toMatchObject({ metricKey: 'disk_capacity', unit: 'GB' });
    // Capacidade Dahua é GB NATIVO — sem scale.
    expect(total?.scale).toBeUndefined();
  });

  it('Dahua videoChannelStatusTable e catch-all da árvore 1004849.2', () => {
    expect(classifySnmpOid('1.3.6.1.4.1.1004849.2.10.1.1.1.1.2.3')?.metricKey).toBe(
      'channel_status_raw',
    );
    // Trap subtree nomeada (fora de escopo de polling, mas nunca "desconhecido").
    expect(classifySnmpOid('1.3.6.1.4.1.1004849.2.11.1.0')?.name).toContain('trap');
    // Catch-all da árvore oficial.
    const s = classifySnmpOid('1.3.6.1.4.1.1004849.2.99.0');
    expect(s?.name).toContain('Dahua');
  });

  it('plausibilidade: uso % Dahua aceita 0–100 e rejeita valores deslocados', () => {
    const usage = classifySnmpOid('1.3.6.1.4.1.1004849.2.4.1.1.6.1')!;
    expect(checkSnmpPlausibility(usage, 'Integer', '45')).toBe(true);
    expect(checkSnmpPlausibility(usage, 'Integer', '4500')).toBe(false);
    const mem = classifySnmpOid('1.3.6.1.4.1.50001.1.221.0')!;
    expect(checkSnmpPlausibility(mem, 'Integer', '73')).toBe(true);
    expect(checkSnmpPlausibility(mem, 'Integer', '-1')).toBe(false);
  });
});

describe('resolveCanonicalMetric (ponte semântica → catálogo)', () => {
  it('resolve chaves semânticas equivalentes para a métrica canônica do card', () => {
    expect(resolveCanonicalMetric('cpu_usage')).toBe('cpu');
    expect(resolveCanonicalMetric('memory_usage')).toBe('memory');
    expect(resolveCanonicalMetric('memory_available')).toBe('memory');
    expect(resolveCanonicalMetric('temperature')).toBe('temperature');
    expect(resolveCanonicalMetric('ram_total')).toBe('ram_total');
  });

  it('chave sem correspondência permanece exibível (sem ponte, nunca descartada)', () => {
    expect(resolveCanonicalMetric('load_average')).toBeNull();
    expect(resolveCanonicalMetric('firmware_version')).toBeNull();
    expect(resolveCanonicalMetric(undefined)).toBeNull();
  });
});

describe('checkSnmpPlausibility (proteção contra deslocamento de árvore)', () => {
  const cpu = classifySnmpOid('1.3.6.1.4.1.49617.1.1.4.0')!;
  const temp = classifySnmpOid('1.3.6.1.4.1.49617.1.1.5.0')!;
  const loadavg = classifySnmpOid('1.3.6.1.4.1.49617.1.1.3.0')!;

  it('aceita os valores REAIS do fw 5.13.9', () => {
    expect(checkSnmpPlausibility(cpu, 'OctetString', '23.436')).toBe(true);
    expect(checkSnmpPlausibility(temp, 'Gauge32', '91991')).toBe(true); // 91,99 °C
    expect(checkSnmpPlausibility(loadavg, 'OctetString', '1.420000 1.170000 0.730000')).toBe(true);
  });

  it('rejeita valores do layout da DOC (fw com hasProVersion desloca a árvore)', () => {
    // Doc: .4 = loadAverage → string "1.42 1.17 0.73" não é percentual.
    expect(checkSnmpPlausibility(cpu, 'OctetString', '1.420000 1.170000 0.730000')).toBe(false);
    // Doc: .5 = cpuUsage → STRING percentual não é Gauge32 em mili-°C.
    expect(checkSnmpPlausibility(temp, 'OctetString', '23.436')).toBe(false);
    // Gauge32 fora da faixa térmica plausível (após ÷1000).
    expect(checkSnmpPlausibility(temp, 'Gauge32', '999999999')).toBe(false);
    expect(checkSnmpPlausibility(loadavg, 'OctetString', '2')).toBe(false);
  });

  it('gateway antigo (tipo Unknown) não reprova pela lista de tipos, mas o padrão vale', () => {
    expect(checkSnmpPlausibility(temp, 'Unknown', '91991')).toBe(true);
    expect(checkSnmpPlausibility(cpu, undefined, '23.436')).toBe(true);
    expect(checkSnmpPlausibility(cpu, undefined, 'abc')).toBe(false);
  });

  it('entrada sem expectativa é sempre plausível', () => {
    const ntpServers = classifySnmpOid('1.3.6.1.4.1.49617.1.1.8.0')!;
    expect(checkSnmpPlausibility(ntpServers, 'OctetString', 'a.st1.ntp.br')).toBe(true);
  });
});

describe('buildDiscoveredObjects', () => {
  const walk = [
    {
      root: '1.3.6.1.4.1.49617.1',
      entries: [
        { oid: '1.3.6.1.4.1.49617.1.1.1.0', value: '5.13.9', type: 'OctetString', numeric: null, index: null },
        { oid: '1.3.6.1.4.1.49617.1.1.4.0', value: '23.436', type: 'OctetString', numeric: 23.436, index: null },
        { oid: '1.3.6.1.4.1.49617.1.1.5.0', value: '91991', type: 'Gauge32', numeric: 91991, index: null },
        { oid: '1.3.6.1.4.1.49617.1.7.3.2', value: '84796', type: 'Gauge32', numeric: 84796, index: 2 },
        { oid: '1.3.6.1.4.1.49617.1.4.2.1', value: '', type: 'OctetString', numeric: null, index: 1 },
      ],
    },
    {
      root: '1.3.6.1.2.1.1',
      entries: [
        // Entrada estilo gateway ANTIGO: só oid/value (campos novos ausentes).
        { oid: '1.3.6.1.2.1.1.3.0', value: '123456' },
        // Duplicado entre seções: deve ser deduplicado.
        { oid: '1.3.6.1.4.1.49617.1.1.1.0', value: '5.13.9' },
      ],
    },
  ];

  it('preserva TODOS os objetos — conhecidos classificados, resto "OID desconhecido"', () => {
    const out = buildDiscoveredObjects(walk);
    expect(out).toHaveLength(6); // 7 entradas − 1 duplicada

    const byOid = new Map(out.map((o) => [o.oid, o]));
    expect(byOid.get('1.3.6.1.4.1.49617.1.1.1.0')?.known?.name).toBe('Versão de firmware');
    // fw 5.13.9: CPU em .4 (confirmada pelo valor percentual real).
    expect(byOid.get('1.3.6.1.4.1.49617.1.1.4.0')?.known).toMatchObject({
      metricKey: 'cpu_usage',
      confirmed: true,
    });
    // fw 5.13.9: temperatura em .5 com escala ÷1000 propagada à view.
    expect(byOid.get('1.3.6.1.4.1.49617.1.1.5.0')?.known).toMatchObject({
      metricKey: 'temperature',
      scale: 0.001,
      confirmed: true,
    });
    // Tabela de aplicação: informação nomeada (categoria application), com índice.
    const appEntry = byOid.get('1.3.6.1.4.1.49617.1.7.3.2');
    expect(appEntry?.index).toBe(2);
    expect(appEntry?.known?.category).toBe('application');
    expect(byOid.get('1.3.6.1.4.1.49617.1.4.2.1')).toMatchObject({ raw: '', value: null });
  });

  it('valor incompatível → rótulo NÃO confirmado, sem métrica canônica', () => {
    // Simula firmware com layout da DOC: loadAverage em .4, cpuUsage em .5.
    const docLayout = [
      {
        root: '1.3.6.1.4.1.49617.1',
        entries: [
          { oid: '1.3.6.1.4.1.49617.1.1.4.0', value: '1.42 1.17 0.73', type: 'OctetString', numeric: null, index: null },
          { oid: '1.3.6.1.4.1.49617.1.1.5.0', value: '23.436', type: 'OctetString', numeric: 23.436, index: null },
        ],
      },
    ];
    const out = buildDiscoveredObjects(docLayout);
    const byOid = new Map(out.map((o) => [o.oid, o]));
    const four = byOid.get('1.3.6.1.4.1.49617.1.1.4.0');
    const five = byOid.get('1.3.6.1.4.1.49617.1.1.5.0');
    // Nome vira sugestão não confirmada; metricKey suprimida nos DOIS casos —
    // nunca exibir/aplicar rótulo errado.
    expect(four?.known?.confirmed).toBe(false);
    expect(four?.known?.metricKey).toBeNull();
    expect(five?.known?.confirmed).toBe(false);
    expect(five?.known?.metricKey).toBeNull();
  });

  it('compatível com gateway antigo (entradas só com oid/value)', () => {
    const out = buildDiscoveredObjects(walk);
    const legacy = out.find((o) => o.oid === '1.3.6.1.2.1.1.3.0');
    expect(legacy).toMatchObject({
      type: 'Unknown',
      value: 123456, // normalizado derivado do texto
      index: null, // sufixo .0 → escalar
      known: { metricKey: 'uptime' },
    });
  });
});

describe('sanitizeCustomPoints / customPointTag', () => {
  it('valida formato de OID, deduplica e aplica defaults', () => {
    const out = sanitizeCustomPoints([
      { oid: '1.3.6.1.4.1.49617.1.1.5.0' },
      { oid: '1.3.6.1.4.1.49617.1.1.5.0', name: 'dup' },
      { oid: 'not-an-oid', name: 'x' },
      { oid: '1.3.6.1.4.1.49617.1.7.3.2', name: '  Métrica X  ', unit: ' un ' },
      {},
    ]);
    expect(out).toEqual([
      { oid: '1.3.6.1.4.1.49617.1.1.5.0', name: 'OID 1.3.6.1.4.1.49617.1.1.5.0', unit: '' },
      { oid: '1.3.6.1.4.1.49617.1.7.3.2', name: 'Métrica X', unit: 'un' },
    ]);
  });

  it('gera tag estável e única por OID', () => {
    expect(customPointTag('1.3.6.1.4.1.49617.1.1.5.0')).toBe(
      'OID_1_3_6_1_4_1_49617_1_1_5_0',
    );
  });
});
