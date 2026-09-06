import { buildDynamicPacketLossCandidates } from './cftv.controller.js';

describe('buildDynamicPacketLossCandidates', () => {
  const walkWithIfIndex2 = [
    { root: '1.3.6.1.2.1.1', entries: [{ oid: '1.3.6.1.2.1.1.3.0', value: '27374200' }] },
    {
      root: '1.3.6.1.2.1.2',
      entries: [
        { oid: '1.3.6.1.2.1.2.2.1.1.2', value: '2' },
        { oid: '1.3.6.1.2.1.2.2.1.13.2', value: '7' },
        { oid: '1.3.6.1.2.1.2.2.1.14.2', value: '0' },
      ],
    },
  ];

  it('gera candidatos de ifInDiscards/ifInErrors com o ifIndex real', () => {
    const known = new Set(['1.3.6.1.2.1.2.2.1.13.1']);
    const oidResults: Record<
      string,
      { oid: string; responded: boolean; value: number | null; raw: string | null }
    > = {};
    const dynamic = buildDynamicPacketLossCandidates(walkWithIfIndex2, known, oidResults);

    expect(dynamic.map((c) => c.oid)).toEqual([
      '1.3.6.1.2.1.2.2.1.13.2',
      '1.3.6.1.2.1.2.2.1.14.2',
    ]);
    expect(dynamic.every((c) => c.metric === 'packet_loss')).toBe(true);
    expect(dynamic[0].profileLabel).toContain('interface 2');
    // O valor do walk alimenta oidResults → candidato aparece como respondido.
    expect(oidResults['1.3.6.1.2.1.2.2.1.13.2']).toEqual({
      oid: '1.3.6.1.2.1.2.2.1.13.2',
      responded: true,
      value: 7,
      raw: '7',
    });
  });

  it('não duplica OIDs já presentes no catálogo estático', () => {
    const known = new Set(['1.3.6.1.2.1.2.2.1.13.2']);
    const dynamic = buildDynamicPacketLossCandidates(walkWithIfIndex2, known, {});
    expect(dynamic.map((c) => c.oid)).toEqual(['1.3.6.1.2.1.2.2.1.14.2']);
  });

  it('ignora walk sem a subárvore de interfaces e entradas fora dos prefixos', () => {
    expect(buildDynamicPacketLossCandidates([], new Set(), {})).toEqual([]);
    expect(
      buildDynamicPacketLossCandidates(
        [{ root: '1.3.6.1.2.1.1', entries: [{ oid: '1.3.6.1.2.1.1.3.0', value: '1' }] }],
        new Set(),
        {},
      ),
    ).toEqual([]);
  });

  it('filtra loopback (ifType 24) e interface down; rótulo usa o ifDescr', () => {
    const walk = [
      {
        root: '1.3.6.1.2.1.2',
        entries: [
          { oid: '1.3.6.1.2.1.2.2.1.2.1', value: 'lo' },
          { oid: '1.3.6.1.2.1.2.2.1.2.2', value: 'eth0' },
          { oid: '1.3.6.1.2.1.2.2.1.2.3', value: 'eth1' },
          { oid: '1.3.6.1.2.1.2.2.1.3.1', value: '24', numeric: 24 },
          { oid: '1.3.6.1.2.1.2.2.1.3.2', value: '6', numeric: 6 },
          { oid: '1.3.6.1.2.1.2.2.1.3.3', value: '6', numeric: 6 },
          { oid: '1.3.6.1.2.1.2.2.1.8.1', value: '1', numeric: 1 },
          { oid: '1.3.6.1.2.1.2.2.1.8.2', value: '1', numeric: 1 },
          { oid: '1.3.6.1.2.1.2.2.1.8.3', value: '2', numeric: 2 },
          { oid: '1.3.6.1.2.1.2.2.1.13.1', value: '7' }, // lo → nunca candidato
          { oid: '1.3.6.1.2.1.2.2.1.13.2', value: '0' }, // eth0 up → candidato
          { oid: '1.3.6.1.2.1.2.2.1.13.3', value: '0' }, // eth1 down → omitida
        ],
      },
    ];
    const dynamic = buildDynamicPacketLossCandidates(walk, new Set(), {});
    expect(dynamic.map((c) => c.oid)).toEqual(['1.3.6.1.2.1.2.2.1.13.2']);
    expect(dynamic[0].profileLabel).toContain('eth0');
    expect(dynamic[0].profileLabel).not.toContain('interface 2');
  });

  it('não sobrescreve resultado de GET que já respondeu', () => {
    const oidResults = {
      '1.3.6.1.2.1.2.2.1.13.2': {
        oid: '1.3.6.1.2.1.2.2.1.13.2',
        responded: true,
        value: 99,
        raw: '99',
      },
    };
    buildDynamicPacketLossCandidates(walkWithIfIndex2, new Set(), oidResults);
    expect(oidResults['1.3.6.1.2.1.2.2.1.13.2'].value).toBe(99);
  });
});
