import {
  buildCasesBlock,
  buildOperationalCase,
  composeCaseText,
  MAX_SIMILAR_CASES,
  MIN_CASE_SIMILARITY,
  rankSimilarCases,
  redactKnownNames,
  REDACTED,
  sanitizeCaseCitations,
  sanitizeOperationalText,
  type OperationalCaseInput,
  type SimilarOperationalCase,
} from './operational-memory.util.js';
import { AiService } from './ai.service.js';

/**
 * Testes de privacidade e regressão da memória operacional anonimizada:
 * - o caso persistido/exibido NÃO contém tenantId, siteId, deviceId nem nomes
 *   de site/dispositivo/gateway/cliente;
 * - o texto livre é saneado (nomes, e-mails, telefones, endereços, locais) e
 *   casos não saneáveis com segurança ficam FORA do índice;
 * - o ranking prioriza mesmo tipo de equipamento e mesmo tipo de alarme;
 * - sem casos recuperados, o prompt e o comportamento atuais ficam intactos
 *   (a IA não tem como afirmar precedente);
 * - as citações [Caso N] fora dos candidatos recuperados são neutralizadas.
 */

// ─── Saneamento do texto livre ───────────────────────────────────────────────

describe('sanitizeOperationalText', () => {
  it('remove e-mails, telefones, URLs, IPs e CEPs', () => {
    const out = sanitizeOperationalText(
      'Compressor travado. Técnico acionado via joao.silva@acme.com.br e (11) 91234-5678. ' +
        'Manual em https://acme.com/manual, controladora no IP 192.168.0.10, CEP 01310-100. ' +
        'Reset do compressor resolveu.',
    );
    expect(out).not.toBeNull();
    expect(out).not.toContain('joao.silva@');
    expect(out).not.toContain('91234');
    expect(out).not.toContain('https://');
    expect(out).not.toContain('192.168.0.10');
    expect(out).not.toContain('01310-100');
    expect(out).toContain('Reset do compressor resolveu');
  });

  it('remove endereços e referências a locais', () => {
    const out = sanitizeOperationalText(
      'Vazamento na Rua das Flores, 100 no Condomínio Solar Alto. Troca da vedação resolveu o problema.',
    );
    expect(out).not.toBeNull();
    expect(out!.toLowerCase()).not.toContain('rua das flores');
    expect(out).not.toContain('Solar Alto');
    expect(out).toContain('Troca da vedação resolveu');
  });

  it('remove nomes próprios após pronome de tratamento e função', () => {
    const out = sanitizeOperationalText(
      'O técnico Carlos Andrade e o Sr. Roberto verificaram o quadro. Disjuntor rearmado, alarme normalizou.',
    );
    expect(out).not.toBeNull();
    expect(out).not.toContain('Carlos Andrade');
    expect(out).not.toContain('Roberto');
    expect(out).toContain('Disjuntor rearmado');
  });

  it('redige nomes conhecidos da plataforma (tenant/site/device/gateway)', () => {
    const out = sanitizeOperationalText(
      'Chiller 02 Torre Norte desarmou de novo no Hospital Vida Plena; gateway gw-abc123 estava offline. Religado após rearme manual.',
      ['Hospital Vida Plena', 'Chiller 02 Torre Norte', 'gw-abc123'],
    );
    expect(out).not.toBeNull();
    expect(out).not.toContain('Vida Plena');
    expect(out).not.toContain('Torre Norte');
    expect(out).not.toContain('gw-abc123');
    expect(out).toContain('Religado após rearme manual');
  });

  it('retorna null quando o texto vira só redações (não saneável com segurança)', () => {
    const out = sanitizeOperationalText('Cliente Acme Prédio Sul', ['Acme', 'Prédio Sul', 'Cliente Acme']);
    expect(out).toBeNull();
  });

  it('retorna null para texto vazio ou sem conteúdo útil', () => {
    expect(sanitizeOperationalText('')).toBeNull();
    expect(sanitizeOperationalText('   ')).toBeNull();
    expect(sanitizeOperationalText('ok', [])).toBeNull();
  });
});

describe('redactKnownNames', () => {
  it('é case-insensitive e ignora nomes muito curtos', () => {
    expect(redactKnownNames('problema no CHILLER LESTE', ['Chiller Leste'])).toContain(REDACTED);
    // Nome de 2 chars não redige (evita destruir palavras comuns).
    expect(redactKnownNames('ar condicionado', ['ar'])).toBe('ar condicionado');
  });
});

// ─── Whitelist: o caso nunca carrega identificadores ─────────────────────────

const baseInput: OperationalCaseInput = {
  sourceEventId: 'evt-1',
  monitoredDeviceType: 'CAMERA',
  protocol: 'onvif',
  alarmName: 'Câmera offline',
  alarmMessage: 'Perda de comunicação com a câmera',
  alarmType: 'STATE_CHANGE',
  severity: 'HIGH',
  valueAtTrigger: 0,
  recurrenceCount: 2,
  activatedAt: new Date('2026-07-01T10:00:00Z'),
  normalizedAt: new Date('2026-07-01T11:30:00Z'),
  acknowledgedAt: new Date('2026-07-01T12:00:00Z'),
  ackNote: 'Switch PoE reiniciado; câmera voltou após religar a porta 8.',
  knownNames: ['Condominio Aurora', 'CAM Portaria Leste', 'tenant-aurora'],
};

describe('buildOperationalCase (whitelist estrita)', () => {
  it('gera a linha só com campos não identificáveis', () => {
    const row = buildOperationalCase(baseInput);
    expect(row).not.toBeNull();
    const keys = Object.keys(row!);
    for (const forbidden of ['tenantId', 'siteId', 'deviceId', 'gatewayId', 'deviceName', 'siteName', 'tenantName', 'userId', 'acknowledgedBy']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(row!.timeToResolveMinutes).toBe(90);
    expect(row!.occurredAt).toEqual(baseInput.acknowledgedAt);
  });

  it('o texto composto/resolução não contém nomes conhecidos', () => {
    const row = buildOperationalCase({
      ...baseInput,
      alarmName: 'Câmera offline - CAM Portaria Leste',
      ackNote: 'No Condominio Aurora a CAM Portaria Leste voltou após reiniciar o switch PoE da portaria.',
    });
    expect(row).not.toBeNull();
    for (const name of ['Condominio Aurora', 'CAM Portaria Leste', 'tenant-aurora']) {
      expect(row!.composedText).not.toContain(name);
      expect(row!.resolution).not.toContain(name);
      expect(row!.alarmName).not.toContain(name);
    }
  });

  it('descarta o caso quando o motivo do ACK não é saneável com segurança', () => {
    const row = buildOperationalCase({
      ...baseInput,
      ackNote: 'Condominio Aurora CAM Portaria Leste',
    });
    expect(row).toBeNull();
  });

  it('degrada o nome do alarme para rótulo genérico quando vira só redação', () => {
    const row = buildOperationalCase({ ...baseInput, alarmName: 'CAM Portaria Leste' });
    expect(row).not.toBeNull();
    expect(row!.alarmName).not.toContain('Portaria');
    expect(row!.alarmName.length).toBeGreaterThan(5);
  });
});

describe('composeCaseText', () => {
  it('inclui apenas os campos da whitelist', () => {
    const row = buildOperationalCase(baseInput)!;
    const text = composeCaseText(row);
    expect(text).toContain('Tipo de equipamento: CAMERA');
    expect(text).toContain('Protocolo: onvif');
    expect(text).toContain('Resolução (motivo do reconhecimento):');
    expect(text).not.toContain('evt-1'); // nem o id de origem entra no texto
  });
});

// ─── Ranking ─────────────────────────────────────────────────────────────────

const makeCase = (over: Partial<SimilarOperationalCase>): SimilarOperationalCase => ({
  caseId: 'c1',
  monitoredDeviceType: null,
  protocol: 'bacnet',
  alarmName: 'Alta temperatura',
  alarmType: 'VALUE_RANGE',
  severity: 'HIGH',
  valueAtTrigger: 30,
  recurrenceCount: 0,
  timeToResolveMinutes: 45,
  resolution: 'Filtro trocado.',
  occurredAt: new Date('2026-05-01T00:00:00Z'),
  similarity: 0.5,
  ...over,
});

describe('rankSimilarCases', () => {
  it('aplica o limiar mínimo e o limite de casos', () => {
    const cases = [
      makeCase({ caseId: 'a', similarity: 0.34 }), // abaixo do corte
      ...Array.from({ length: 6 }, (_, i) => makeCase({ caseId: `b${i}`, similarity: 0.6 })),
    ];
    const ranked = rankSimilarCases({}, cases);
    expect(ranked.length).toBe(MAX_SIMILAR_CASES);
    expect(ranked.every((c) => c.similarity >= MIN_CASE_SIMILARITY)).toBe(true);
  });

  it('prioriza mesmo tipo de equipamento e mesmo tipo de alarme', () => {
    const generic = makeCase({ caseId: 'generic', similarity: 0.6 });
    const sameEquip = makeCase({
      caseId: 'same-equip',
      monitoredDeviceType: 'CAMERA',
      protocol: 'onvif',
      alarmType: 'STATE_CHANGE',
      similarity: 0.45,
    });
    const ranked = rankSimilarCases(
      { monitoredDeviceType: 'CAMERA', protocol: 'onvif', alarmType: 'STATE_CHANGE' },
      [generic, sameEquip],
    );
    expect(ranked[0].caseId).toBe('same-equip');
  });

  it('sem monitoredDeviceType usa o protocolo como proxy do domínio', () => {
    const sameProtocol = makeCase({ caseId: 'p', protocol: 'modbus', similarity: 0.5 });
    const other = makeCase({ caseId: 'o', protocol: 'bacnet', similarity: 0.55 });
    const ranked = rankSimilarCases({ protocol: 'modbus' }, [sameProtocol, other]);
    expect(ranked[0].caseId).toBe('p');
  });

  it('modo estrito com alvo de câmera (CFTV) exclui casos BMS abaixo do limiar cross-domain', () => {
    const bmsPump = makeCase({
      caseId: 'bms-pump',
      monitoredDeviceType: null,
      protocol: 'bacnet',
      similarity: 0.55, // acima do MIN, abaixo do CROSS_DOMAIN
    });
    const cameraCase = makeCase({
      caseId: 'cam',
      monitoredDeviceType: 'CAMERA',
      protocol: 'onvif',
      similarity: 0.4,
    });
    const ranked = rankSimilarCases(
      { monitoredDeviceType: 'CAMERA', protocol: 'onvif', strict: true },
      [bmsPump, cameraCase],
    );
    expect(ranked.map((c) => c.caseId)).toEqual(['cam']);
  });

  it('modo estrito com alvo de câmera: nenhum caso relevante → lista vazia (nunca BMS solto)', () => {
    const bmsCases = [
      makeCase({ caseId: 'chiller', monitoredDeviceType: null, protocol: 'bacnet', similarity: 0.5 }),
      makeCase({ caseId: 'bomba', monitoredDeviceType: null, protocol: 'modbus', similarity: 0.45 }),
    ];
    const ranked = rankSimilarCases(
      { monitoredDeviceType: 'CAMERA', protocol: 'onvif', strict: true },
      bmsCases,
    );
    expect(ranked).toEqual([]);
  });

  it('modo estrito ainda admite caso de outro domínio quando MUITO semelhante', () => {
    const crossVeryHigh = makeCase({
      caseId: 'cross',
      monitoredDeviceType: 'SWITCH',
      protocol: 'snmp',
      similarity: 0.7, // >= CROSS_DOMAIN_CASE_SIMILARITY
    });
    const ranked = rankSimilarCases(
      { monitoredDeviceType: 'CAMERA', protocol: 'onvif', strict: true },
      [crossVeryHigh],
    );
    expect(ranked.map((c) => c.caseId)).toEqual(['cross']);
  });
});

// ─── Anti-alucinação de citações ─────────────────────────────────────────────

describe('sanitizeCaseCitations', () => {
  it('mantém citações válidas e neutraliza números fora dos candidatos', () => {
    const out = sanitizeCaseCitations('Ver [Caso 1] e também [Caso 7].', 2);
    expect(out).toContain('[Caso 1]');
    expect(out).not.toContain('[Caso 7]');
  });

  it('com zero casos recuperados, nenhuma citação sobrevive', () => {
    const out = sanitizeCaseCitations('Já houve caso semelhante [Caso 2].', 0);
    expect(out).not.toMatch(/\[Caso \d+\]/);
  });
});

// ─── Regressão: sem casos, o prompt/fluxo atual fica intacto ─────────────────

type AnyRecord = Record<string, unknown>;

const makeService = () => {
  const service = new AiService(
    {} as never,
    { search: jest.fn(async () => []) } as never,
    { record: jest.fn() } as never,
    { findSimilar: jest.fn(async () => []) } as never,
    { findAll: jest.fn(async () => []) } as never,
    { getStatus: jest.fn(() => 'online'), resolveLastSeenMany: jest.fn(async () => new Map()) } as never,
  );
  return service as unknown as {
    complete(
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      hits: AnyRecord[],
      rulesOverride?: string,
      similarCases?: SimilarOperationalCase[],
    ): Promise<string>;
    getClient(): unknown;
  };
};

const stubClient = (service: AnyRecord) => {
  const create = jest.fn(async (_args: { system: string }) => ({
    content: [{ type: 'text', text: 'resposta' }],
  }));
  (service as { getClient: () => unknown }).getClient = () => ({ messages: { create } }) as never;
  return create;
};

describe('AiService.complete com memória operacional', () => {
  it('SEM casos recuperados o system prompt não menciona a memória (comportamento atual intacto)', async () => {
    const service = makeService();
    const create = stubClient(service as unknown as AnyRecord);
    await service.complete([{ role: 'user', content: 'q' }], [], undefined, []);
    const system = (create.mock.calls[0][0] as unknown as { system: string }).system;
    expect(system).not.toContain('CASOS SEMELHANTES JÁ RESOLVIDOS');
    expect(system).not.toContain('memória operacional');
  });

  it('COM casos recuperados injeta o bloco anônimo e as regras de anonimato', async () => {
    const service = makeService();
    const create = stubClient(service as unknown as AnyRecord);
    const cases = [makeCase({ caseId: 'c1', monitoredDeviceType: 'CAMERA' })];
    await service.complete([{ role: 'user', content: 'q' }], [], undefined, cases);
    const system = (create.mock.calls[0][0] as unknown as { system: string }).system;
    expect(system).toContain('CASOS SEMELHANTES JÁ RESOLVIDOS');
    expect(system).toContain('[Caso 1]');
    expect(system).toContain('NUNCA mencione, sugira ou tente inferir cliente, site, local');
    // O bloco nunca carrega identificadores (só campos anônimos do caso).
    // ("multi-tenant" existe no BASE_PROMPT; o que não pode é o bloco de casos
    // conter IDs — validamos o bloco isoladamente.)
    const block = buildCasesBlock(cases);
    expect(block).not.toContain('tenant');
    expect(block).not.toContain('c1'); // nem o id interno do caso
    expect(system).not.toContain('tenantId');
  });
});

describe('buildCasesBlock', () => {
  it('descreve o caso só com campos anônimos e tempo relativo', () => {
    const block = buildCasesBlock(
      [makeCase({ occurredAt: new Date('2026-05-10T00:00:00Z') })],
      new Date('2026-08-10T00:00:00Z'),
    );
    expect(block).toContain('há cerca de 3 meses');
    expect(block).toContain('Como foi resolvido:');
    expect(block).not.toContain('caseId');
  });

  it('retorna vazio sem casos', () => {
    expect(buildCasesBlock([])).toBe('');
  });
});
