/**
 * Importação de casos técnicos (seed Bluebee) — funções PURAS, exportadas para
 * testes: validação/normalização dos registros do JSON e composição do texto
 * completo do caso para chunking/embedding.
 *
 * O formato segue o "Master Prompt de Pesquisa e Diagnóstico Técnico": cada
 * caso tem case_id único (BB-BMS-XXXX), classe de conhecimento
 * (FIELD_VALIDATED/DOCUMENTED/DERIVED/SYNTHETIC), severidade, protocolo,
 * subsistema, escopo de fabricante, sintoma, força de evidência, fonte
 * (título + URL) e tags.
 */
import { KnowledgeClass } from '@prisma/client';

/** Registro bruto do arquivo seed (bluebee_seed_kb_v1_100_bms_cases.json). */
export interface SeedCaseRecord {
  case_id: string;
  domain?: string;
  subsystem?: string;
  protocol?: string;
  vendor_scope?: string;
  equipment?: string;
  bluebee_question?: string;
  symptom?: string;
  context?: string;
  possible_causes?: string;
  diagnostic_steps?: string;
  root_cause_example?: string;
  corrective_action?: string;
  post_validation?: string;
  bluebee_answer?: string;
  severity?: string;
  knowledge_class?: string;
  evidence_strength?: string;
  validation_status?: string;
  source_title?: string;
  source_url?: string;
  source_basis?: string;
  tags?: string;
}

/** Caso normalizado, pronto para virar um KnowledgeDoc type=CASE. */
export interface NormalizedSeedCase {
  caseId: string;
  title: string;
  content: string;
  knowledgeClass: KnowledgeClass;
  caseSeverity: string | null;
  protocol: string | null;
  subsystem: string | null;
  vendorScope: string | null;
  equipmentType: string | null;
  symptom: string | null;
  evidenceStrength: string | null;
  source: string | null;
  sourceUrl: string | null;
  tags: string[];
}

const CASE_ID_RE = /^BB-[A-Z0-9]{2,8}-\d{3,6}$/;
const MAX_TITLE = 200;

const trimOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

function parseKnowledgeClass(value: unknown): KnowledgeClass | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toUpperCase();
  return key in KnowledgeClass ? KnowledgeClass[key as keyof typeof KnowledgeClass] : null;
}

/** Tags: string separada por vírgulas → lista limpa e deduplicada. */
export function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.split(',')) {
    const tag = t.trim().toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * Texto completo do caso para chunking/embedding: todos os campos técnicos
 * relevantes em seções rotuladas em pt-BR — é o que a busca semântica "vê".
 * A fonte (título/URL) entra no texto para o modelo poder citá-la.
 */
export function composeCaseContent(r: SeedCaseRecord): string {
  const sections: Array<[string, string | null | undefined]> = [
    ['Caso', r.case_id],
    ['Classificação', r.knowledge_class],
    ['Domínio', r.domain],
    ['Subsistema', r.subsystem],
    ['Protocolo', r.protocol],
    ['Fabricante (escopo)', r.vendor_scope],
    ['Equipamento', r.equipment],
    ['Pergunta típica', r.bluebee_question],
    ['Sintoma', r.symptom],
    ['Contexto', r.context],
    ['Causas possíveis', r.possible_causes],
    ['Passos de diagnóstico', r.diagnostic_steps],
    ['Causa raiz de referência', r.root_cause_example],
    ['Ação corretiva', r.corrective_action],
    ['Validação pós-correção', r.post_validation],
    ['Resposta de referência', r.bluebee_answer],
    ['Severidade', r.severity],
    ['Força de evidência', r.evidence_strength],
    ['Fonte', r.source_title],
    ['URL da fonte', r.source_url],
    ['Base da fonte', r.source_basis],
    ['Tags', r.tags],
  ];
  return sections
    .filter((s): s is [string, string] => Boolean(s[1] && String(s[1]).trim()))
    .map(([label, value]) => `${label}: ${String(value).trim()}`)
    .join('\n');
}

/**
 * Normaliza um registro do seed. Retorna null quando o registro é inválido
 * (sem case_id no formato esperado ou sem classe de conhecimento) — o
 * importador contabiliza como inválido em vez de criar lixo na base.
 */
export function normalizeSeedCase(r: SeedCaseRecord): NormalizedSeedCase | null {
  const caseId = trimOrNull(r.case_id)?.toUpperCase() ?? null;
  if (!caseId || !CASE_ID_RE.test(caseId)) return null;
  const knowledgeClass = parseKnowledgeClass(r.knowledge_class);
  if (!knowledgeClass) return null;

  const question = trimOrNull(r.bluebee_question);
  const symptom = trimOrNull(r.symptom);
  const equipment = trimOrNull(r.equipment);
  const fallbackTitle = [equipment, symptom].filter(Boolean).join(': ') || 'Caso técnico';
  const title = `${caseId} — ${question ?? fallbackTitle}`.slice(0, MAX_TITLE);

  const content = composeCaseContent(r);
  if (!content.trim()) return null;

  return {
    caseId,
    title,
    content,
    knowledgeClass,
    caseSeverity: trimOrNull(r.severity),
    protocol: trimOrNull(r.protocol),
    subsystem: trimOrNull(r.subsystem),
    vendorScope: trimOrNull(r.vendor_scope),
    equipmentType: equipment,
    symptom,
    evidenceStrength: trimOrNull(r.evidence_strength),
    source: trimOrNull(r.source_title),
    sourceUrl: trimOrNull(r.source_url),
    tags: parseTags(r.tags),
  };
}

/** Estrutura do arquivo seed (envelope + records). */
export interface SeedFile {
  dataset_name?: string;
  records?: unknown;
}

/**
 * Extrai os registros válidos de um arquivo seed já parseado. Lança quando o
 * envelope não tem `records` como lista — arquivo errado é erro explícito.
 */
export function extractSeedRecords(file: SeedFile): SeedCaseRecord[] {
  if (!file || !Array.isArray(file.records)) {
    throw new Error('Arquivo seed inválido: esperado um objeto com a lista "records".');
  }
  return file.records.filter(
    (r): r is SeedCaseRecord => Boolean(r && typeof r === 'object' && 'case_id' in r),
  );
}
