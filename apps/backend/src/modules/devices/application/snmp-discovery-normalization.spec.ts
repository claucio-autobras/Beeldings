/**
 * Specs da normalização na descoberta SNMP (SNMP Fase 1 — Bugs 1 e 3):
 *
 *   - TimeTicks: gateway novo entrega segundos (kind 'duration') → backend
 *     NÃO reconverte; gateway antigo entrega ticks crus → backend ÷100 uma
 *     única vez. Em ambos os casos a scale exposta é 1 (nunca dupla conversão,
 *     inclusive p/ semânticas com scale 0.01 como o deviceUpTime Dahua).
 *   - Interfaces IF-MIB: loopback (ifType 24) e down nunca viram métrica
 *     recomendada; rótulo carrega o ifDescr, nunca só o ifIndex.
 */

import {
  buildDiscoveredObjects,
  buildInterfaceWalkInfo,
  isMonitorableWalkInterface,
} from './snmp-oid-semantics.js';

const SYS_UPTIME = '1.3.6.1.2.1.1.3.0';

describe('buildDiscoveredObjects — TimeTicks (Bug 1)', () => {
  it('gateway novo (kind duration): valor já em segundos, sem reconversão', () => {
    const [d] = buildDiscoveredObjects([
      {
        root: '1.3.6.1.2.1.1',
        entries: [
          {
            oid: SYS_UPTIME,
            value: '360000',
            type: 'TimeTicks',
            numeric: 3600, // gateway já normalizou (÷100)
            index: null,
            kind: 'duration',
          },
        ],
      },
    ]);
    expect(d.value).toBe(3600);
    expect(d.known?.metricKey).toBe('uptime');
    expect(d.known?.scale).toBe(1);
  });

  it('gateway antigo (sem kind): ticks crus convertidos ÷100 no backend', () => {
    const [d] = buildDiscoveredObjects([
      {
        root: '1.3.6.1.2.1.1',
        entries: [
          { oid: SYS_UPTIME, value: '360000', type: 'TimeTicks', numeric: 360000, index: null },
        ],
      },
    ]);
    expect(d.value).toBe(3600);
    expect(d.known?.scale).toBe(1);
  });

  it('semântica com scale 0.01 (deviceUpTime Dahua): scale exposta vira 1 — nunca dupla conversão', () => {
    const [d] = buildDiscoveredObjects([
      {
        root: '1.3.6.1.4.1.1004849',
        entries: [
          {
            oid: '1.3.6.1.4.1.1004849.2.1.6.0',
            value: '360000',
            type: 'TimeTicks',
            numeric: 3600,
            index: null,
            kind: 'duration',
          },
        ],
      },
    ]);
    expect(d.value).toBe(3600);
    expect(d.known?.metricKey).toBe('uptime');
    expect(d.known?.scale).toBe(1);
  });

  it('gateway MUITO antigo (só oid/value, tipo desconhecido): comportamento preservado', () => {
    const [d] = buildDiscoveredObjects([
      { root: '1.3.6.1.2.1.1', entries: [{ oid: SYS_UPTIME, value: '360000' }] },
    ]);
    // Sem tipo não há como saber que é TimeTicks — valor fica como veio.
    expect(d.value).toBe(360000);
    expect(d.type).toBe('Unknown');
  });
});

/** Walk MIB-II interfaces com eth0 (up), lo (loopback) e eth1 (down). */
const IF_WALK = [
  {
    root: '1.3.6.1.2.1.2',
    entries: [
      { oid: '1.3.6.1.2.1.2.2.1.2.1', value: 'lo', type: 'OctetString', numeric: null, index: 1 },
      { oid: '1.3.6.1.2.1.2.2.1.2.2', value: 'eth0', type: 'OctetString', numeric: null, index: 2 },
      { oid: '1.3.6.1.2.1.2.2.1.2.3', value: 'eth1', type: 'OctetString', numeric: null, index: 3 },
      { oid: '1.3.6.1.2.1.2.2.1.3.1', value: '24', type: 'Integer', numeric: 24, index: 1 },
      { oid: '1.3.6.1.2.1.2.2.1.3.2', value: '6', type: 'Integer', numeric: 6, index: 2 },
      { oid: '1.3.6.1.2.1.2.2.1.3.3', value: '6', type: 'Integer', numeric: 6, index: 3 },
      { oid: '1.3.6.1.2.1.2.2.1.8.1', value: '1', type: 'Integer', numeric: 1, index: 1 },
      { oid: '1.3.6.1.2.1.2.2.1.8.2', value: '1', type: 'Integer', numeric: 1, index: 2 },
      { oid: '1.3.6.1.2.1.2.2.1.8.3', value: '2', type: 'Integer', numeric: 2, index: 3 },
      { oid: '1.3.6.1.2.1.2.2.1.13.1', value: '7', type: 'Counter32', numeric: 7, index: 1, kind: 'counter' },
      { oid: '1.3.6.1.2.1.2.2.1.13.2', value: '0', type: 'Counter32', numeric: 0, index: 2, kind: 'counter' },
      { oid: '1.3.6.1.2.1.2.2.1.13.3', value: '0', type: 'Counter32', numeric: 0, index: 3, kind: 'counter' },
    ],
  },
];

describe('buildInterfaceWalkInfo / isMonitorableWalkInterface (Bug 3)', () => {
  it('extrai ifType/ifOperStatus/ifDescr por índice do próprio walk', () => {
    const info = buildInterfaceWalkInfo(IF_WALK);
    expect(info.get(1)).toEqual({ ifType: 24, operStatus: 1, descr: 'lo' });
    expect(info.get(2)).toEqual({ ifType: 6, operStatus: 1, descr: 'eth0' });
    expect(info.get(3)).toEqual({ ifType: 6, operStatus: 2, descr: 'eth1' });
  });

  it('loopback e down não são monitoráveis; sem contexto não esconde', () => {
    const info = buildInterfaceWalkInfo(IF_WALK);
    expect(isMonitorableWalkInterface(info.get(1))).toBe(false); // lo
    expect(isMonitorableWalkInterface(info.get(2))).toBe(true); // eth0
    expect(isMonitorableWalkInterface(info.get(3))).toBe(false); // down
    expect(isMonitorableWalkInterface(undefined)).toBe(true); // sem dados
  });
});

describe('buildDiscoveredObjects — demoção de interfaces loopback/down (Bug 3)', () => {
  it('ifInDiscards da lo/down perde a métrica recomendada; eth0 mantém e ganha rótulo pelo ifDescr', () => {
    const discovered = buildDiscoveredObjects(IF_WALK);
    const byOid = new Map(discovered.map((d) => [d.oid, d]));

    const lo = byOid.get('1.3.6.1.2.1.2.2.1.13.1');
    expect(lo?.known?.metricKey).toBeNull();
    expect(lo?.known?.importance).toBe('info');
    expect(lo?.known?.name).toContain('lo');

    const down = byOid.get('1.3.6.1.2.1.2.2.1.13.3');
    expect(down?.known?.metricKey).toBeNull();
    expect(down?.known?.importance).toBe('info');

    const eth0 = byOid.get('1.3.6.1.2.1.2.2.1.13.2');
    expect(eth0?.known?.metricKey).toBe('packet_loss');
    expect(eth0?.known?.name).toContain('eth0');
  });
});
