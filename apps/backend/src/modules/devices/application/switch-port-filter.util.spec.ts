/**
 * Specs do filtro de portas descobertas (SNMP Fase 1 — Bug 3):
 * loopback (ifType 24) some da lista; portas down ficam visíveis mas fora da
 * criação automática de pontos; campos ausentes nunca escondem a porta.
 */

import {
  isDownPort,
  isLoopbackPort,
  partitionDiscoveredPorts,
} from './switch-port-filter.util.js';

const port = (ifIndex: number, ifType?: number | null, ifOperStatus?: number | null) => ({
  ifIndex,
  ifType,
  ifOperStatus,
  ifDescr: `if-${ifIndex}`,
});

describe('partitionDiscoveredPorts()', () => {
  it('remove loopback (ifType 24) da lista visível e da criável', () => {
    const { visible, creatable } = partitionDiscoveredPorts([
      port(1, 24, 1), // lo — up, mas loopback
      port(2, 6, 1), // eth up
    ]);
    expect(visible.map((p) => p.ifIndex)).toEqual([2]);
    expect(creatable.map((p) => p.ifIndex)).toEqual([2]);
  });

  it('porta down continua visível mas fora da criação automática', () => {
    const { visible, creatable } = partitionDiscoveredPorts([
      port(2, 6, 1), // up
      port(3, 6, 2), // down
    ]);
    expect(visible.map((p) => p.ifIndex)).toEqual([2, 3]);
    expect(creatable.map((p) => p.ifIndex)).toEqual([2]);
  });

  it('campos ausentes (agente sem ifType/ifOperStatus) não escondem a porta', () => {
    const { visible, creatable } = partitionDiscoveredPorts([
      port(5, null, null),
      port(6, undefined, undefined),
    ]);
    expect(visible).toHaveLength(2);
    expect(creatable).toHaveLength(2);
  });
});

describe('isLoopbackPort() / isDownPort()', () => {
  it('classificação direta', () => {
    expect(isLoopbackPort(port(1, 24, 1))).toBe(true);
    expect(isLoopbackPort(port(1, 6, 1))).toBe(false);
    expect(isDownPort(port(1, 6, 2))).toBe(true);
    expect(isDownPort(port(1, 6, 1))).toBe(false);
  });
});
