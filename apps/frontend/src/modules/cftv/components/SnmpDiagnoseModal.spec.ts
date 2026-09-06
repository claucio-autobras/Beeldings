import type { MetricProposal } from '../services/cftv.service';
import {
  automaticGuidedSelections,
  normalizeGuidedProposals,
} from './SnmpDiagnoseModal';

function proposal(
  override: Partial<MetricProposal> = {},
): MetricProposal {
  return {
    metricKey: 'cpu_usage',
    friendlyName: 'Uso de CPU',
    unit: '%',
    exampleValue: '42',
    confidence: 'exact',
    candidates: [
      {
        oid: '1.3.6.1.4.1.1.0',
        label: 'Uso de CPU',
        exampleValue: '42',
        unit: '%',
        scale: 1,
        isDefault: true,
      },
    ],
    selectedOid: '1.3.6.1.4.1.1.0',
    ...override,
  };
}

describe('normalizeGuidedProposals', () => {
  it('não republica fonte ativa identificada apenas por candidate.isActive', () => {
    const activeOid = '1.3.6.1.4.1.1.0';
    const normalized = normalizeGuidedProposals([
      proposal({
        candidates: [
          {
            oid: activeOid,
            label: 'Uso de CPU',
            exampleValue: '42',
            unit: '%',
            scale: 1,
            isDefault: true,
            isActive: true,
          },
        ],
      }),
    ]);

    expect(normalized[0]).toEqual(expect.objectContaining({
      activeOid,
      state: 'active',
      selectedOid: activeOid,
    }));
    expect(automaticGuidedSelections(normalized)).toEqual({});
  });

  it('corrige binding quebrado somente com a substituição homologada respondente', () => {
    const oldOid = '1.3.6.1.4.1.1.0';
    const replacementOid = '1.3.6.1.4.1.2.0';
    const normalized = normalizeGuidedProposals([
      proposal({
        selectedOid: oldOid,
        activeOid: oldOid,
        suggestedOid: replacementOid,
        state: 'broken',
        candidates: [
          {
            oid: oldOid,
            label: 'Uso de CPU',
            exampleValue: null,
            unit: '%',
            scale: 1,
            isDefault: true,
            isActive: true,
          },
          {
            oid: replacementOid,
            label: 'Uso de CPU',
            exampleValue: '38',
            unit: '%',
            scale: 1,
            isDefault: false,
          },
        ],
      }),
    ]);

    expect(normalized[0]?.selectedOid).toBe(replacementOid);
    expect(automaticGuidedSelections(normalized)).toEqual({
      cpu_usage: expect.objectContaining({ oid: replacementOid }),
    });
  });
});