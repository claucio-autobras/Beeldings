/**
 * Testes das funções de rotulagem de interface SNMP.
 * Cobre o comportamento de primárias e secundárias com ifDescr.
 */

import { buildIfNameIndex, getIfLabelSuffix, IF_DESCR_OID_PREFIX } from './snmp-interface-labels';

const AT = '2026-08-18T13:00:00.000Z';

function ifDescrEntry(index: number, name: string) {
  return {
    oid: `${IF_DESCR_OID_PREFIX}${index}`,
    label: `Interface — descrição (ifDescr)`,
    value: name,
    category: 'network' as const,
    capturedAt: AT,
  };
}

describe('buildIfNameIndex', () => {
  it('mapeia índice → nome a partir de entradas ifDescr', () => {
    const info = [
      ifDescrEntry(1, 'eth0'),
      ifDescrEntry(2, 'lo'),
      // Entrada que não é ifDescr: ignorada.
      {
        oid: '1.3.6.1.4.1.49617.1.1.1.0',
        label: 'Versão de firmware',
        value: '5.13.9',
        category: 'identification' as const,
        capturedAt: AT,
      },
    ];
    const map = buildIfNameIndex(info);
    expect(map.get(1)).toBe('eth0');
    expect(map.get(2)).toBe('lo');
    expect(map.size).toBe(2);
  });

  it('índice 0 é ignorado (escalares .0 não são instâncias de interface)', () => {
    const info = [
      { oid: `${IF_DESCR_OID_PREFIX}0`, label: 'x', value: 'loopback', category: 'network' as const, capturedAt: AT },
    ];
    const map = buildIfNameIndex(info);
    expect(map.size).toBe(0);
  });

  it('retorna mapa vazio quando não há entradas ifDescr', () => {
    expect(buildIfNameIndex([])).toEqual(new Map());
  });
});

describe('getIfLabelSuffix', () => {
  const ifMap = new Map([[1, 'eth0'], [2, 'lo']]);

  it('retorna sufixo correto para métrica de rede primária (ifInDiscards .1)', () => {
    // ifInDiscards para interface 1 (eth0): 1.3.6.1.2.1.2.2.1.13.1
    const suffix = getIfLabelSuffix('1.3.6.1.2.1.2.2.1.13.1', 'network', ifMap);
    expect(suffix).toBe(' — eth0');
  });

  it('retorna sufixo correto para métrica de rede secundária (ifOutOctets .2)', () => {
    // ifOutOctets para interface 2 (lo): 1.3.6.1.2.1.2.2.1.16.2
    const suffix = getIfLabelSuffix('1.3.6.1.2.1.2.2.1.16.2', 'network', ifMap);
    expect(suffix).toBe(' — lo');
  });

  it('retorna string vazia para categoria não-rede', () => {
    expect(getIfLabelSuffix('1.3.6.1.2.1.2.2.1.10.1', 'performance', ifMap)).toBe('');
  });

  it('retorna string vazia quando a interface não está no mapa', () => {
    expect(getIfLabelSuffix('1.3.6.1.2.1.2.2.1.10.5', 'network', ifMap)).toBe('');
  });

  it('retorna string vazia quando o OID é null', () => {
    expect(getIfLabelSuffix(null, 'network', ifMap)).toBe('');
  });

  it('retorna string vazia quando o mapa está vazio', () => {
    expect(getIfLabelSuffix('1.3.6.1.2.1.2.2.1.10.1', 'network', new Map())).toBe('');
  });
});
