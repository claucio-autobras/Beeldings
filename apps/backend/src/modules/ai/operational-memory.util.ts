/**
 * Memória operacional anonimizada — funções PURAS (exportadas para testes):
 * saneamento do texto livre, montagem do caso pela whitelist estrita,
 * ranqueamento dos candidatos e salvaguarda anti-alucinação das citações.
 *
 * Requisito central (LGPD): o caso persistido/exibido NUNCA contém tenantId,
 * siteId, deviceId, nomes de cliente/site/equipamento/gateway, endereços,
 * e-mails ou telefones. A IA aprende com o problema, nunca com quem/onde.
 */

export const REDACTED = '[removido]';

/** Similaridade vetorial mínima para um caso contar como "semelhante". */
export const MIN_CASE_SIMILARITY = 0.35;
/**
 * Modo estrito SEM domínio inferível (chat com pergunta genérica): exige
 * similaridade bem mais alta para um caso entrar como precedente.
 */
export const MIN_CASE_SIMILARITY_NO_DOMAIN = 0.5;
/**
 * Modo estrito COM domínio: um caso de OUTRO domínio só entra se for de fato
 * muito parecido com a pergunta (ex.: mesmo problema de rede em outra classe
 * de equipamento).
 */
export const CROSS_DOMAIN_CASE_SIMILARITY = 0.6;
/** Máximo de casos levados ao prompt/UI. */
export const MAX_SIMILAR_CASES = 4;

// ─── Domínio do caso / da pergunta ───────────────────────────────────────────

/**
 * Domínio funcional de um caso/pergunta — granulação grossa de propósito:
 * evita que uma pergunta de câmera traga precedente de chiller, sem exigir
 * casamento exato de tipo de equipamento.
 */
export type CaseDomain = 'CFTV' | 'NETWORK' | 'ACCESS' | 'BMS';

/**
 * Classifica um caso da memória no seu domínio. Casos SNMP sem tipo caem em
 * CFTV (infra de monitoramento SNMP) — nunca em BMS.
 */
export function caseDomainOf(monitoredDeviceType: string | null, protocol: string): CaseDomain {
  const type = (monitoredDeviceType ?? '').toUpperCase();
  if (type === 'CAMERA' || type === 'NVR' || type === 'DVR') return 'CFTV';
  if (type === 'SWITCH') return 'NETWORK';
  if (type === 'ACCESS_CONTROLLER') return 'ACCESS';
  const p = (protocol ?? '').toLowerCase();
  if (p === 'onvif' || p === 'snmp') return 'CFTV';
  return 'BMS';
}

const stripAccents = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Palavras-chave por domínio (comparadas SEM acento e em minúsculas, por
// palavra inteira). Cobrem o vocabulário operacional em pt-BR do produto.
const DOMAIN_KEYWORDS: Record<CaseDomain, string[]> = {
  CFTV: [
    'camera',
    'cameras',
    'cftv',
    'nvr',
    'dvr',
    'onvif',
    'gravador',
    'video loss',
    'perda de video',
    'imagem da camera',
  ],
  NETWORK: ['switch', 'switches'],
  ACCESS: [
    'controladora de acesso',
    'controle de acesso',
    'catraca',
    'catracas',
    'leitor facial',
    'fechadura',
  ],
  BMS: [
    'chiller',
    'chillers',
    'fancoil',
    'fan coil',
    'fan-coil',
    'ahu',
    'vrf',
    'hvac',
    'ar condicionado',
    'ar-condicionado',
    'split',
    'splitao',
    'bomba',
    'bombas',
    'compressor',
    'caldeira',
    'boiler',
    'exaustor',
    'ventilador',
    'condensadora',
    'evaporadora',
    'torre de resfriamento',
    'quadro eletrico',
    'disjuntor',
    'gerador',
    'nobreak',
    'medidor de energia',
    'iluminacao',
    'bacnet',
    'modbus',
    'automacao predial',
    'bms',
  ],
};

/**
 * Infere o domínio da pergunta pelo vocabulário. Retorna null quando nenhum
 * domínio (ou mais de um) é citado — nesse caso a busca estrita exige
 * similaridade bem mais alta em vez de filtrar por domínio.
 */
export function inferQuestionDomain(question: string): CaseDomain | null {
  const q = ` ${stripAccents(question).replace(/[^a-z0-9]+/g, ' ')} `;
  const hits: CaseDomain[] = [];
  for (const domain of Object.keys(DOMAIN_KEYWORDS) as CaseDomain[]) {
    const found = DOMAIN_KEYWORDS[domain].some((kw) => q.includes(` ${kw} `));
    if (found) hits.push(domain);
  }
  return hits.length === 1 ? hits[0] : null;
}

// ─── Saneamento de texto livre ───────────────────────────────────────────────

// Padrões genéricos de PII/identificação em português: e-mail, URL, IP,
// telefone BR, CEP, CPF/CNPJ, endereços e referências a locais, e nomes
// próprios após pronomes de tratamento ou funções.
const GENERIC_PATTERNS: RegExp[] = [
  // e-mail
  /[\w.+-]+@[\w-]+\.[\w.-]+/gi,
  // URL
  /\bhttps?:\/\/\S+/gi,
  // IPv4
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  // CPF / CNPJ
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
  // CEP
  /\b\d{5}-\d{3}\b/g,
  // Telefone BR: (11) 91234-5678, 11 91234 5678, +55 11 91234-5678
  /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9?\d{4}[\s.-]\d{4}\b/g,
  // Endereços: logradouro + resto do trecho
  /\b(?:rua|av\.|avenida|alameda|travessa|rodovia|estrada|pra[çc]a|largo)\s+[^,.;\n]{2,60}/gi,
  // Referências a locais/instalações seguidas de nome próprio ou código
  // (keyword aceita inicial maiúscula/minúscula; nome seguinte exige maiúscula)
  /\b(?:[Cc]ondom[ií]nio|[Ee]dif[ií]cio|[Pp]r[eé]dio|[Ss]hopping|[Hh]ospital|[Hh]otel|[Ee]scola|[Cc]ol[eé]gio|[Ff][aá]brica|[Pp]lanta|[Uu]nidade|[Ff]ilial|[Mm]atriz|[Ll]oja|[Gg]alp[aã]o|[Ss]ite|[Oo]bra)\s+[A-ZÀ-Ú0-9][^\s,.;:!?]*(?:\s+(?:d[aoe]s?\s+)?[A-ZÀ-Ú0-9][^\s,.;:!?]*){0,3}/g,
  // Bloco/torre/andar/sala + identificador (localização interna)
  /\b(?:bloco|torre|andar|sala)\s+[A-Za-z0-9][^\s,.;:!?]{0,10}/gi,
  // Pronome de tratamento + nome próprio
  /\b(?:[Ss]r\.?|[Ss]ra\.?|[Dd]r\.?|[Dd]ra\.?|[Dd]ona)\s+[A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:d[aoe]s?\s+)?[A-ZÀ-Ú][a-zà-ú]+)*/g,
  // Função + nome próprio (técnico João, zelador Pedro...)
  /\b(?:[Tt][eé]cnico|[Ee]ngenheir[oa]|[Zz]elador(?:a)?|[Ss][ií]ndic[oa]|[Oo]perador(?:a)?|[Ee]letricista|[Ss]upervisor(?:a)?|[Gg]erente|[Pp]orteiro|[Cc]olaborador(?:a)?|[Ff]uncion[aá]ri[oa])\s+[A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*/g,
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Redige ocorrências de nomes conhecidos (tenants, sites, equipamentos,
 * gateways, usuários) no texto — determinístico e case-insensitive. Nomes
 * muito curtos (<3 chars) são ignorados para não redigir palavras comuns.
 */
export function redactKnownNames(text: string, knownNames: string[]): string {
  let out = text;
  for (const name of knownNames) {
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length < 3) continue;
    const re = new RegExp(escapeRegex(trimmed), 'gi');
    out = out.replace(re, REDACTED);
  }
  return out;
}

/**
 * Sanea um texto livre (ex.: motivo do ACK) para a memória global:
 * 1. redige nomes conhecidos da plataforma;
 * 2. redige padrões genéricos de PII/local;
 * 3. avalia segurança: texto que ficou majoritariamente redigido ou sem
 *    conteúdo útil retorna null — o caso fica FORA do índice.
 */
export function sanitizeOperationalText(
  text: string,
  knownNames: string[] = [],
): string | null {
  const original = text?.trim();
  if (!original) return null;

  let out = redactKnownNames(original, knownNames);
  for (const re of GENERIC_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  out = out.replace(/\s+/g, ' ').trim();

  // Segurança: avalia o que sobrou de conteúdo útil sem os placeholders.
  // Texto dominado por redações (ou quase sem sobra) não vai para o índice.
  const redactions = out.split(REDACTED).length - 1;
  const remaining = out.split(REDACTED).join('').replace(/\s+/g, ' ').trim();
  if (remaining.length < 10) return null; // sobrou quase nada de útil
  if (redactions > 8) return null; // excesso de identificações no texto
  const redactedChars = redactions * REDACTED.length;
  if (redactedChars / Math.max(out.length, 1) > 0.5) return null;
  return out;
}

// ─── Whitelist / montagem do caso ────────────────────────────────────────────

/** Entrada da montagem: dados da ocorrência + lista de nomes a redigir. */
export interface OperationalCaseInput {
  sourceEventId: string;
  monitoredDeviceType: string | null;
  protocol: string;
  alarmName: string;
  alarmMessage: string | null;
  alarmType: string;
  severity: string;
  valueAtTrigger: number | null;
  recurrenceCount: number;
  activatedAt: Date;
  normalizedAt: Date | null;
  acknowledgedAt: Date;
  ackNote: string;
  /** Nomes identificáveis a redigir (tenant/site/device/gateway/usuários). */
  knownNames: string[];
}

/** Linha pronta para persistir — SÓ campos da whitelist (nada identificável). */
export interface OperationalCaseRow {
  sourceEventId: string;
  monitoredDeviceType: string | null;
  protocol: string;
  alarmName: string;
  alarmMessage: string | null;
  alarmType: string;
  severity: string;
  valueAtTrigger: number | null;
  recurrenceCount: number;
  timeToResolveMinutes: number | null;
  resolution: string;
  occurredAt: Date;
  composedText: string;
}

const SEVERITY_PT: Record<string, string> = { LOW: 'baixa', MEDIUM: 'média', HIGH: 'alta' };

/** Texto composto do caso para embedding — só campos da whitelist. */
export function composeCaseText(row: Omit<OperationalCaseRow, 'composedText'>): string {
  const parts = [
    `Tipo de equipamento: ${row.monitoredDeviceType ?? 'BMS (automação predial)'}`,
    `Protocolo: ${row.protocol}`,
    `Alarme: ${row.alarmName} (${row.alarmType}, severidade ${SEVERITY_PT[row.severity] ?? row.severity})`,
    row.alarmMessage ? `Sintoma/mensagem: ${row.alarmMessage}` : null,
    row.valueAtTrigger !== null ? `Valor no disparo: ${row.valueAtTrigger}` : null,
    row.recurrenceCount > 0 ? `Reincidência: ${row.recurrenceCount} reativação(ões) antes da resolução` : null,
    row.timeToResolveMinutes !== null ? `Tempo até resolução: ${row.timeToResolveMinutes} min` : null,
    `Resolução (motivo do reconhecimento): ${row.resolution}`,
  ].filter((p): p is string => Boolean(p));
  return parts.join('\n');
}

/**
 * Monta um caso operacional a partir de uma ocorrência resolvida+reconhecida.
 * Retorna null quando o motivo do ACK não puder ser saneado com segurança —
 * o caso fica de fora do índice (nunca persistimos texto arriscado).
 */
export function buildOperationalCase(input: OperationalCaseInput): OperationalCaseRow | null {
  const resolution = sanitizeOperationalText(input.ackNote, input.knownNames);
  if (!resolution) return null;

  // Nome/mensagem da regra também passam pelo saneamento (podem conter nomes
  // de local/equipamento); se ficarem vazios, degradam para rótulos genéricos.
  const alarmName =
    sanitizeOperationalText(input.alarmName, input.knownNames) ??
    `Alarme ${input.alarmType === 'STATE_CHANGE' ? 'de mudança de estado' : 'de faixa de valor'}`;
  const alarmMessage = input.alarmMessage
    ? sanitizeOperationalText(input.alarmMessage, input.knownNames)
    : null;

  const timeToResolveMinutes = input.normalizedAt
    ? Math.max(0, Math.round((input.normalizedAt.getTime() - input.activatedAt.getTime()) / 60_000))
    : null;

  const base: Omit<OperationalCaseRow, 'composedText'> = {
    sourceEventId: input.sourceEventId,
    monitoredDeviceType: input.monitoredDeviceType,
    protocol: input.protocol,
    alarmName,
    alarmMessage,
    alarmType: input.alarmType,
    severity: input.severity,
    valueAtTrigger: input.valueAtTrigger,
    recurrenceCount: input.recurrenceCount,
    timeToResolveMinutes,
    resolution,
    occurredAt: input.acknowledgedAt,
  };
  return { ...base, composedText: composeCaseText(base) };
}

// ─── Busca / ranqueamento ────────────────────────────────────────────────────

/** Caso anônimo exposto à IA e à UI (nunca contém IDs de origem). */
export interface SimilarOperationalCase {
  caseId: string;
  monitoredDeviceType: string | null;
  protocol: string;
  alarmName: string;
  alarmType: string;
  severity: string;
  valueAtTrigger: number | null;
  recurrenceCount: number;
  timeToResolveMinutes: number | null;
  resolution: string;
  occurredAt: Date;
  similarity: number;
}

export interface CaseSearchTarget {
  monitoredDeviceType?: string | null;
  protocol?: string | null;
  alarmType?: string | null;
  /**
   * Domínio inferido da PERGUNTA (chat) quando não há equipamento concreto.
   * Ignorado quando monitoredDeviceType/protocol estão presentes (deles se
   * deriva o domínio diretamente).
   */
  domain?: CaseDomain | null;
  /**
   * Modo estrito (chat, primeira ação e sugestão por equipamento): com
   * domínio conhecido, exclui casos de outro domínio (salvo similaridade
   * altíssima); sem domínio, exige similaridade bem mais alta.
   */
  strict?: boolean;
}

/**
 * Ranqueia candidatos priorizando mesmo tipo de equipamento e mesmo tipo de
 * alarme sobre a similaridade pura; aplica o limiar mínimo e devolve poucos
 * casos (MAX_SIMILAR_CASES). No modo estrito (chat) filtra também por domínio
 * da pergunta — pergunta de câmera nunca traz precedente de chiller.
 */
export function rankSimilarCases(
  target: CaseSearchTarget,
  candidates: SimilarOperationalCase[],
): SimilarOperationalCase[] {
  const targetEquip = target.monitoredDeviceType ?? null;
  const targetProtocol = target.protocol ?? null;
  const targetAlarmType = target.alarmType ?? null;

  // Domínio efetivo: do equipamento concreto quando existe; senão o inferido
  // da pergunta (pode ser null — pergunta genérica).
  const domain: CaseDomain | null =
    targetEquip !== null || targetProtocol
      ? caseDomainOf(targetEquip, targetProtocol ?? '')
      : target.domain ?? null;

  let pool = candidates.filter((c) => c.similarity >= MIN_CASE_SIMILARITY);
  if (target.strict) {
    pool = domain
      ? pool.filter(
          (c) =>
            caseDomainOf(c.monitoredDeviceType, c.protocol) === domain ||
            c.similarity >= CROSS_DOMAIN_CASE_SIMILARITY,
        )
      : pool.filter((c) => c.similarity >= MIN_CASE_SIMILARITY_NO_DOMAIN);
  }

  return pool
    .map((c) => {
      // Mesmo tipo de equipamento: monitoredDeviceType quando ambos têm; senão
      // mesmo protocolo (proxy do domínio: BACnet/Modbus/MQTT/ONVIF/SNMP).
      const sameEquip =
        targetEquip !== null
          ? c.monitoredDeviceType === targetEquip
          : targetProtocol !== null && c.protocol === targetProtocol;
      const sameAlarmType = targetAlarmType !== null && c.alarmType === targetAlarmType;
      let score = c.similarity;
      if (sameEquip) score += 0.15;
      if (sameAlarmType) score += 0.1;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIMILAR_CASES)
    .map(({ c }) => c);
}

// ─── Prompt / anti-alucinação ────────────────────────────────────────────────

/**
 * Bloco de contexto "casos semelhantes já resolvidos" injetado no prompt.
 * Os casos são numerados ([Caso 1..N]) e descritos SÓ com campos anônimos.
 */
export function buildCasesBlock(cases: SimilarOperationalCase[], now = new Date()): string {
  if (cases.length === 0) return '';
  const lines = cases.map((c, i) => {
    const months = Math.max(0, Math.floor((now.getTime() - c.occurredAt.getTime()) / (30 * 24 * 60 * 60 * 1000)));
    const when = months <= 0 ? 'há menos de um mês' : months === 1 ? 'há cerca de 1 mês' : `há cerca de ${months} meses`;
    const equip = c.monitoredDeviceType ?? `equipamento BMS (${c.protocol})`;
    return `[Caso ${i + 1}] Equipamento: ${equip}. Alarme: "${c.alarmName}" (${c.alarmType}, severidade ${
      SEVERITY_PT[c.severity] ?? c.severity
    }).${c.valueAtTrigger !== null ? ` Valor no disparo: ${c.valueAtTrigger}.` : ''}${
      c.timeToResolveMinutes !== null ? ` Resolvido em ~${c.timeToResolveMinutes} min.` : ''
    } Registrado ${when}. Como foi resolvido: "${c.resolution}"`;
  });
  return `=== CASOS SEMELHANTES JÁ RESOLVIDOS (memória operacional anônima do sistema) ===\n${lines.join(
    '\n',
  )}\n=== FIM DOS CASOS SEMELHANTES ===`;
}

/** Regras de uso da memória operacional, anexadas SOMENTE quando há casos. */
export const OPERATIONAL_CASES_RULES = `Regras da memória operacional (siga estritamente):
- Os "CASOS SEMELHANTES JÁ RESOLVIDOS" acima são precedentes 100% ANÔNIMOS registrados na plataforma (podem vir de qualquer cliente/local).
- NUNCA mencione, sugira ou tente inferir cliente, site, local, endereço, gateway ou nome de equipamento desses casos — nem indiretamente (ex.: "no seu outro site", "no mesmo prédio").
- Ao usar um caso, apresente-o como "já houve um caso semelhante registrado no sistema, resolvido assim: ..." e cite-o como [Caso N], usando SOMENTE os números listados acima.
- Só afirme que existe precedente se um caso listado for de fato semelhante; se nenhum for, NÃO afirme precedente.
- A solução de um caso anterior não necessariamente resolve o problema atual — trate como pista, não como verdade absoluta.`;

/**
 * Salvaguarda anti-alucinação (pós-processamento): remove citações [Caso N]
 * cujo número NÃO existe entre os candidatos realmente recuperados. Com zero
 * casos recuperados, qualquer citação vira texto neutro — a IA nunca "cria"
 * um precedente que a busca não encontrou.
 */
export function sanitizeCaseCitations(reply: string, caseCount: number): string {
  return reply.replace(/\[\s*[Cc]aso\s+(\d+)\s*\]/g, (match, num: string) => {
    const n = Number(num);
    if (Number.isInteger(n) && n >= 1 && n <= caseCount) return `[Caso ${n}]`;
    return caseCount > 0 ? '[caso não listado]' : 'um caso não confirmado';
  });
}
