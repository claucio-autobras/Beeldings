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
