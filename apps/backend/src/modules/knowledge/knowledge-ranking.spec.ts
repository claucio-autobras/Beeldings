import { KnowledgeClass, KnowledgeType } from '@prisma/client';
import type { KnowledgeSearchHit } from './knowledge.service';
import {
  extractKnowledgeTarget,
  rankKnowledgeHits,
  sanitizeKnowledgeCaseIds,
  scoreKnowledgeHit,
} from './knowledge-ranking.util';

// Re-ranqueamento ciente de caso: classe de conhecimento superior
// (FIELD_VALIDATED > DOCUMENTED > DERIVED > SYNTHETIC) e correspondência de
// protocolo/fabricante/equipamento sobem no contexto — sem jamais deixar a
// similaridade semântica de ser dominante.

function hit(over: Partial<KnowledgeSearchHit> = {}): KnowledgeSearchHit {
  return {
    chunkId: 'c1',
    docId: 'd1',
    title: 'Doc',
    type: KnowledgeType.CASE,
    source: null,
    equipmentType: null,
    equipmentModel: null,
    content: '...',
    similarity: 0.5,
    caseId: null,
    knowledgeClass: null,
    caseSeverity: null,
    protocol: null,
    subsystem: null,
    vendorScope: null,
    symptom: null,
    sourceUrl: null,
    ...over,
  };
}

describe('rankKnowledgeHits — prioridade por classe de conhecimento', () => {
  it('com similaridade igual, ordena FIELD_VALIDATED > DOCUMENTED > DERIVED > SYNTHETIC > sem classe', () => {
    const hits = [
      hit({ docId: 'none' }),
      hit({ docId: 'syn', knowledgeClass: KnowledgeClass.SYNTHETIC }),
      hit({ docId: 'der', knowledgeClass: KnowledgeClass.DERIVED }),
      hit({ docId: 'doc', knowledgeClass: KnowledgeClass.DOCUMENTED }),
      hit({ docId: 'fld', knowledgeClass: KnowledgeClass.FIELD_VALIDATED }),
    ];
    const ranked = rankKnowledgeHits(hits, {}, 5);
    expect(ranked.map((h) => h.docId)).toEqual(['fld', 'doc', 'der', 'none', 'syn']);
  });

  it('similaridade muito maior vence o boost de classe (boost só desempata)', () => {
    const hits = [
      hit({ docId: 'similar', similarity: 0.8 }),
      hit({ docId: 'fld', similarity: 0.5, knowledgeClass: KnowledgeClass.FIELD_VALIDATED }),
    ];
    expect(rankKnowledgeHits(hits, {}, 2)[0].docId).toBe('similar');
  });

  it('sem metadados nem alvo, preserva a ordem da busca (estável)', () => {
    const hits = [hit({ docId: 'a' }), hit({ docId: 'b' }), hit({ docId: 'c' })];
    expect(rankKnowledgeHits(hits, {}, 3).map((h) => h.docId)).toEqual(['a', 'b', 'c']);
  });

  it('corta em k', () => {
    const hits = [hit({ docId: 'a' }), hit({ docId: 'b' })];
    expect(rankKnowledgeHits(hits, {}, 1)).toHaveLength(1);
  });
});

describe('rankKnowledgeHits — correspondência de protocolo/fabricante/equipamento', () => {
  it('protocolo da pergunta sobe o caso do mesmo protocolo', () => {
    const hits = [
      hit({ docId: 'modbus', protocol: 'Modbus RTU/TCP', knowledgeClass: KnowledgeClass.DOCUMENTED }),
      hit({ docId: 'mstp', protocol: 'BACnet MS/TP', knowledgeClass: KnowledgeClass.DOCUMENTED }),
    ];
    const target = extractKnowledgeTarget('controlador MS/TP caindo intermitente');
    expect(rankKnowledgeHits(hits, target, 2)[0].docId).toBe('mstp');
  });

  it('fabricante citado sobe o caso com o vendor no escopo (sem acento/caixa)', () => {
    const hits = [
      hit({ docId: 'generic', vendorScope: 'Multi-vendor' }),
      hit({ docId: 'jci', vendorScope: 'Multi-vendor / Johnson Controls anchor' }),
    ];
    const target = extractKnowledgeTarget('supervisório johnson controls não conecta');
    expect(rankKnowledgeHits(hits, target, 2)[0].docId).toBe('jci');
  });

  it('equipamento citado sobe o caso do mesmo equipamento', () => {
    const hits = [
      hit({ docId: 'chiller', equipmentType: 'Chiller parafuso' }),
      hit({ docId: 'fancoil', equipmentType: 'Fancoil com válvula de 2 vias' }),
    ];
    const target = extractKnowledgeTarget('o fancoil não gela, o que pode ser?');
    expect(rankKnowledgeHits(hits, target, 2)[0].docId).toBe('fancoil');
  });

  it('score é aditivo: classe + protocolo + fabricante', () => {
    const h = hit({
      knowledgeClass: KnowledgeClass.DOCUMENTED,
      protocol: 'BACnet MS/TP',
      vendorScope: 'Johnson Controls',
    });
    const target = { protocols: ['MS/TP'], vendors: ['Johnson Controls'] };
    // 0.5 (sim) + 0.06 (DOCUMENTED) + 0.05 (protocolo) + 0.05 (vendor)
    expect(scoreKnowledgeHit(h, target)).toBeCloseTo(0.66, 5);
  });
});

describe('extractKnowledgeTarget', () => {
  it('reconhece protocolos, fabricantes e equipamentos em pt-BR', () => {
    const t = extractKnowledgeTarget(
      'Medidores Modbus atrás de gateway BACnet/IP da Schneider param de responder',
    );
    expect(t.protocols).toEqual(expect.arrayContaining(['Modbus', 'BACnet/IP']));
    expect(t.vendors).toContain('Schneider');
    expect(t.equipment).toEqual(expect.arrayContaining(['medidor', 'gateway']));
  });

  it('texto sem termos técnicos retorna alvo vazio', () => {
    const t = extractKnowledgeTarget('bom dia, tudo bem?');
    expect(t.protocols).toEqual([]);
    expect(t.vendors).toEqual([]);
    expect(t.equipment).toEqual([]);
  });
});

describe('sanitizeKnowledgeCaseIds — anti-alucinação de case_id', () => {
  it('mantém case_id recuperado e neutraliza case_id inventado', () => {
    const reply =
      'Veja o Caso BB-BMS-0007 (DOCUMENTED) e também o Caso BB-BMS-9999 (FIELD_VALIDATED).';
    const out = sanitizeKnowledgeCaseIds(reply, ['BB-BMS-0007']);
    expect(out).toContain('BB-BMS-0007');
    expect(out).not.toContain('BB-BMS-9999');
    expect(out).toContain('[caso não encontrado na base]');
  });

  it('sem casos recuperados, toda citação é neutralizada', () => {
    const out = sanitizeKnowledgeCaseIds('Baseado no caso BB-BMS-0001.', []);
    expect(out).not.toContain('BB-BMS-0001');
  });

  it('comparação de id é case-insensitive e não altera texto sem citações', () => {
    expect(sanitizeKnowledgeCaseIds('Verifique a terminação.', [])).toBe(
      'Verifique a terminação.',
    );
    expect(sanitizeKnowledgeCaseIds('caso BB-BMS-0001', ['bb-bms-0001'])).toContain('BB-BMS-0001');
  });
});
