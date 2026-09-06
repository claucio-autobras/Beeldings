import {
  buildLiveStatusBlock,
  detectLiveStatusIntent,
  deviceKindLabel,
  formatDurationPt,
  LIVE_STATUS_RULES,
  matchNamedEntity,
  normalizeForMatch,
  type LiveStatusData,
} from './live-status.util.js';
import {
  caseDomainOf,
  inferQuestionDomain,
  rankSimilarCases,
  CROSS_DOMAIN_CASE_SIMILARITY,
  MIN_CASE_SIMILARITY_NO_DOMAIN,
  type SimilarOperationalCase,
} from './operational-memory.util.js';
import { AiService } from './ai.service.js';

/**
 * Testes do chat com diagnóstico ao vivo e relevância de casos:
 * - detecção da intenção de estado do sistema e casamento de entidades;
 * - bloco factual com durações calculadas pelo backend;
 * - domínio da pergunta: pergunta de câmera NÃO retorna caso de chiller;
 * - sem domínio inferível, só entra caso com similaridade bem mais alta;
 * - o system prompt só ganha o bloco/regras quando o bloco existe.
 */

// ─── Intenção de estado do sistema ───────────────────────────────────────────

describe('detectLiveStatusIntent', () => {
  it.each([
    'quero um diagnóstico do meu site A',
    'há quanto tempo meu chiller está em falha?',
    'o que está offline?',
    'quais câmeras estão fora do ar',
    'me dá um resumo do sistema',
    'tem algum alarme ativo agora?',
    'desde quando o gateway parou de comunicar',
  ])('detecta pergunta de estado: %s', (q) => {
    expect(detectLiveStatusIntent(q)).toBe(true);
  });

  it.each([
    'qual a pinagem do MCP17?',
    'como configuro uma automação de horário?',
    'o que é uma tendência (trend)?',
  ])('não dispara em pergunta de conhecimento: %s', (q) => {
    expect(detectLiveStatusIntent(q)).toBe(false);
  });
});

// ─── Casamento de entidades por nome ─────────────────────────────────────────

describe('matchNamedEntity', () => {
  const sites = [
    { id: 's1', name: 'Site A' },
    { id: 's2', name: 'Hospital Vida Plena' },
  ];

  it('casa por nome sem diferenciar acentos/maiúsculas', () => {
    expect(matchNamedEntity('diagnóstico do HOSPITAL VIDA PLENA', sites)?.id).toBe('s2');
  });

  it('prefere o nome mais longo quando um contém o outro', () => {
    const devices = [
      { id: 'd1', name: 'Chiller 02' },
      { id: 'd2', name: 'Chiller 02 Torre Norte' },
    ];
    expect(matchNamedEntity('o chiller 02 torre norte está em falha?', devices)?.id).toBe('d2');
  });

  it('retorna null sem citação e ignora nomes muito curtos', () => {
    expect(matchNamedEntity('o que está offline?', sites)).toBeNull();
    expect(matchNamedEntity('há um problema', [{ id: 'x', name: 'um' }])).toBeNull();
  });

  it('normalizeForMatch remove acentos', () => {
    expect(normalizeForMatch('Câmera Térreo')).toBe('camera terreo');
  });
});

// ─── Durações e bloco factual ────────────────────────────────────────────────

describe('formatDurationPt', () => {
  it('formata minutos, horas e dias', () => {
    expect(formatDurationPt(30_000)).toBe('menos de 1 min');
    expect(formatDurationPt(12 * 60_000)).toBe('12 min');
    expect(formatDurationPt((3 * 60 + 5) * 60_000)).toBe('3 h 05 min');
    expect(formatDurationPt(26 * 60 * 60_000)).toBe('1 d 2 h');
    expect(formatDurationPt(-5_000)).toBe('menos de 1 min');
  });
});

const NOW = new Date('2026-08-10T15:00:00Z');

const baseData: LiveStatusData = {
  now: NOW,
  scopeLabel: 'todos os sites e equipamentos do cliente',
  siteNames: ['Site A', 'Site B'],
  alarms: [],
  offlineDevices: [],
  totalDevicesInScope: 5,
  offlineGateways: [],
  totalGatewaysInScope: 2,
};

describe('buildLiveStatusBlock', () => {
  it('sem problemas: afirma explicitamente que não há alarmes/offline', () => {
    const block = buildLiveStatusBlock(baseData);
    expect(block).toContain('nenhum alarme ativo no escopo');
    expect(block).toContain('nenhum dos 5 equipamento(s) do escopo está offline');
    expect(block).toContain('todos os 2 gateway(s) do escopo estão online');
    expect(block).toContain('Sites do cliente: Site A, Site B.');
  });

  it('alarme ativo sai com severidade e duração calculada pelo backend', () => {
    const block = buildLiveStatusBlock({
      ...baseData,
      alarms: [
        {
          name: 'Alta pressão',
          message: 'Pressão acima do limite',
          severity: 'HIGH',
          state: 'ACTIVE',
          deviceName: 'Chiller 02',
          siteName: 'Site A',
          activatedAt: new Date(NOW.getTime() - (3 * 60 + 12) * 60_000),
          reactivationCount: 0,
          lastReactivatedAt: null,
        },
      ],
    });
    expect(block).toContain('[severidade ALTA] Alta pressão');
    expect(block).toContain('equipamento "Chiller 02" (site "Site A")');
    expect(block).toContain('ativo há 3 h 12 min');
    expect(block).toContain('não reconhecido');
  });

  it('offline sai com "desde quando" ou "sem registro de comunicação"', () => {
    const block = buildLiveStatusBlock({
      ...baseData,
      offlineDevices: [
        {
          name: 'CAM Portaria',
          kindLabel: 'câmera',
          siteName: 'Site B',
          lastSeen: new Date(NOW.getTime() - 2 * 60 * 60_000),
        },
        { name: 'Medidor', kindLabel: 'equipamento (modbus)', siteName: null, lastSeen: null },
      ],
      offlineGateways: [{ id: 'gw-1', lastSeen: null }],
    });
    expect(block).toContain('"CAM Portaria" (câmera, site "Site B") — offline; última comunicação há 2 h');
    expect(block).toContain('"Medidor" (equipamento (modbus)) — offline; sem registro de comunicação');
    expect(block).toContain('Gateway gw-1 — offline; sem registro de comunicação');
  });

  it('deviceKindLabel traduz tipos monitorados e degrada para o protocolo', () => {
    expect(deviceKindLabel('CAMERA', 'onvif')).toBe('câmera');
    expect(deviceKindLabel(null, 'bacnet')).toBe('equipamento (bacnet)');
  });
});

// ─── Domínio da pergunta × casos da memória ──────────────────────────────────

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

describe('inferQuestionDomain', () => {
  it('pergunta de câmera → CFTV; de chiller → BMS; de switch → NETWORK', () => {
    expect(inferQuestionDomain('minha câmera da portaria está offline')).toBe('CFTV');
    expect(inferQuestionDomain('o chiller desarmou de novo')).toBe('BMS');
    expect(inferQuestionDomain('o switch do rack parou')).toBe('NETWORK');
    expect(inferQuestionDomain('a catraca não abre')).toBe('ACCESS');
  });

  it('sem vocabulário de domínio (ou ambíguo) retorna null', () => {
    expect(inferQuestionDomain('o que está acontecendo?')).toBeNull();
    expect(inferQuestionDomain('a câmera e o chiller pararam juntos')).toBeNull();
  });
});

describe('caseDomainOf', () => {
  it('classifica por tipo monitorado e cai no protocolo quando não há tipo', () => {
    expect(caseDomainOf('CAMERA', 'snmp')).toBe('CFTV');
    expect(caseDomainOf('SWITCH', 'snmp')).toBe('NETWORK');
    expect(caseDomainOf('ACCESS_CONTROLLER', 'snmp')).toBe('ACCESS');
    expect(caseDomainOf(null, 'onvif')).toBe('CFTV');
    expect(caseDomainOf(null, 'bacnet')).toBe('BMS');
    expect(caseDomainOf(null, 'modbus')).toBe('BMS');
  });
});

describe('rankSimilarCases — modo estrito do chat', () => {
  const chillerCase = makeCase({ caseId: 'chiller', protocol: 'bacnet', similarity: 0.55 });
  const cameraCase = makeCase({
    caseId: 'camera',
    monitoredDeviceType: 'CAMERA',
    protocol: 'onvif',
    similarity: 0.4,
  });

  it('pergunta de câmera NÃO retorna caso de chiller', () => {
    const ranked = rankSimilarCases({ domain: 'CFTV', strict: true }, [chillerCase, cameraCase]);
    expect(ranked.map((c) => c.caseId)).toEqual(['camera']);
  });

  it('caso de outro domínio só entra quando é MUITO parecido de fato', () => {
    const veryClose = makeCase({
      caseId: 'very-close',
      protocol: 'bacnet',
      similarity: CROSS_DOMAIN_CASE_SIMILARITY + 0.01,
    });
    const ranked = rankSimilarCases({ domain: 'CFTV', strict: true }, [chillerCase, veryClose]);
    expect(ranked.map((c) => c.caseId)).toEqual(['very-close']);
  });

  it('sem domínio inferível exige similaridade bem mais alta', () => {
    const weak = makeCase({ caseId: 'weak', similarity: MIN_CASE_SIMILARITY_NO_DOMAIN - 0.05 });
    const strong = makeCase({ caseId: 'strong', similarity: MIN_CASE_SIMILARITY_NO_DOMAIN + 0.05 });
    const ranked = rankSimilarCases({ domain: null, strict: true }, [weak, strong]);
    expect(ranked.map((c) => c.caseId)).toEqual(['strong']);
  });

  it('equipamento concreto citado deriva o domínio (câmera exclui chiller)', () => {
    const ranked = rankSimilarCases(
      { monitoredDeviceType: 'CAMERA', protocol: 'onvif', strict: true },
      [chillerCase, cameraCase],
    );
    expect(ranked.map((c) => c.caseId)).toEqual(['camera']);
  });

  it('sem strict, o comportamento atual (sugestão/primeira ação) fica intacto', () => {
    const ranked = rankSimilarCases({ monitoredDeviceType: 'CAMERA', protocol: 'onvif' }, [
      chillerCase,
      cameraCase,
    ]);
    expect(ranked.map((c) => c.caseId).sort()).toEqual(['camera', 'chiller']);
  });
});

// ─── System prompt: bloco ao vivo só quando existe ───────────────────────────

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
      liveStatusBlock?: string | null,
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

describe('AiService.complete com bloco factual ao vivo', () => {
  it('COM bloco: injeta o estado atual e as regras de dados ao vivo', async () => {
    const service = makeService();
    const create = stubClient(service as unknown as AnyRecord);
    const block = buildLiveStatusBlock(baseData);
    await service.complete([{ role: 'user', content: 'q' }], [], undefined, [], block);
    const system = (create.mock.calls[0][0] as unknown as { system: string }).system;
    expect(system).toContain('ESTADO ATUAL DO SISTEMA');
    expect(system).toContain('NUNCA invente equipamentos, alarmes, sites, durações ou horários');
    expect(system).toContain(LIVE_STATUS_RULES);
  });

  it('SEM bloco: o prompt fica idêntico ao atual (sem menção a dados ao vivo)', async () => {
    const service = makeService();
    const create = stubClient(service as unknown as AnyRecord);
    await service.complete([{ role: 'user', content: 'q' }], [], undefined, [], null);
    const system = (create.mock.calls[0][0] as unknown as { system: string }).system;
    expect(system).not.toContain('ESTADO ATUAL DO SISTEMA');
    expect(system).not.toContain('dados ao vivo');
  });
});
