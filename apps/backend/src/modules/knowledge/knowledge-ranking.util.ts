/**
 * Re-ranqueamento dos hits da base de conhecimento ciente de CASOS técnicos —
 * funções PURAS (exportadas para testes).
 *
 * Ordem de confiança do método de diagnóstico (master prompt):
 *   FIELD_VALIDATED > DOCUMENTED > DERIVED > SYNTHETIC > documento sem classe.
 * Além da classe, favorece correspondência de protocolo/fabricante/equipamento
 * extraída da pergunta ou do contexto do ativo. A similaridade semântica segue
 * dominante — os boosts desempatam candidatos próximos, nunca trazem um hit
 * irrelevante para o topo.
 */
import { KnowledgeClass } from '@prisma/client';
import type { KnowledgeSearchHit } from './knowledge.service.js';

/** Alvo de correspondência derivado da pergunta/do ativo (tudo opcional). */
export interface KnowledgeRankTarget {
  /** Protocolos citados/derivados (ex.: "BACnet MS/TP", "Modbus"). */
  protocols?: string[];
  /** Fabricantes citados (ex.: "Johnson Controls", "Siemens"). */
  vendors?: string[];
  /** Termos de equipamento citados (ex.: "fancoil", "medidor"). */
  equipment?: string[];
}

// Boost por classe de conhecimento — pequeno o suficiente para nunca superar
// uma diferença real de similaridade, grande o suficiente para desempatar.
const CLASS_BOOST: Record<KnowledgeClass, number> = {
  FIELD_VALIDATED: 0.09,
  DOCUMENTED: 0.06,
  DERIVED: 0.03,
  SYNTHETIC: 0,
};

const MATCH_BOOST = 0.05;

const stripAccents = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** true quando `needle` aparece (sem acento/caixa) dentro de `haystack`. */
function fuzzyIncludes(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return stripAccents(haystack).includes(stripAccents(needle));
}

function anyMatch(fields: Array<string | null | undefined>, needles: string[]): boolean {
  return needles.some((n) => n.trim() && fields.some((f) => fuzzyIncludes(f, n)));
}

/** Score de um hit para o alvo — exportado para teste determinístico. */
export function scoreKnowledgeHit(hit: KnowledgeSearchHit, target: KnowledgeRankTarget): number {
  let score = hit.similarity;
  if (hit.knowledgeClass) score += CLASS_BOOST[hit.knowledgeClass] ?? 0;
  if (target.protocols?.length && anyMatch([hit.protocol, hit.subsystem], target.protocols)) {
    score += MATCH_BOOST;
  }
  if (target.vendors?.length && anyMatch([hit.vendorScope, hit.title, hit.source], target.vendors)) {
    score += MATCH_BOOST;
  }
  if (
    target.equipment?.length &&
    anyMatch([hit.equipmentType, hit.equipmentModel, hit.symptom, hit.title], target.equipment)
  ) {
    score += MATCH_BOOST;
  }
  return score;
}

/**
 * Re-ranqueia os hits recuperados e devolve os `k` melhores. Estável para
 * documentos sem metadados de caso: sem classe e sem correspondência, a ordem
 * é a da similaridade original.
 */
export function rankKnowledgeHits(
  hits: KnowledgeSearchHit[],
  target: KnowledgeRankTarget,
  k: number,
): KnowledgeSearchHit[] {
  return hits
    .map((hit, i) => ({ hit, i, score: scoreKnowledgeHit(hit, target) }))
    // Empate exato preserva a ordem vinda da busca (similaridade).
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, Math.max(0, k))
    .map(({ hit }) => hit);
}

// ─── Extração de alvo a partir do texto da pergunta ──────────────────────────

// Protocolos reconhecíveis no vocabulário das perguntas (pt-BR). O valor é o
// termo canônico comparado contra hit.protocol/subsystem.
const PROTOCOL_PATTERNS: Array<{ re: RegExp; term: string }> = [
  { re: /ms\s*\/?\s*tp|mstp/i, term: 'MS/TP' },
  { re: /bacnet\s*\/?\s*ip/i, term: 'BACnet/IP' },
  { re: /\bbacnet\b/i, term: 'BACnet' },
  { re: /\bmodbus\b/i, term: 'Modbus' },
  { re: /\bmqtt\b/i, term: 'MQTT' },
  { re: /\bsnmp\b/i, term: 'SNMP' },
  { re: /\bonvif\b/i, term: 'ONVIF' },
  { re: /\bknx\b/i, term: 'KNX' },
  { re: /\blon(works)?\b/i, term: 'LonWorks' },
];

// Fabricantes relevantes do domínio (master prompt, seção DOCUMENTED).
const KNOWN_VENDORS = [
  'Schneider',
  'Johnson Controls',
  'Metasys',
  'Siemens',
  'Honeywell',
  'Carrier',
  'Trane',
  'Daikin',
  'Danfoss',
  'ABB',
  'WEG',
  'Belimo',
  'Notifier',
  'Simplex',
  'Bosch',
  'Axis',
  'Avigilon',
  'Intelbras',
  'Hikvision',
  'Dahua',
];

// Termos de equipamento comuns em perguntas de troubleshooting predial.
const EQUIPMENT_TERMS = [
  'fancoil',
  'fan coil',
  'chiller',
  'ahu',
  'vav',
  'vrf',
  'bomba',
  'torre de resfriamento',
  'medidor',
  'controlador',
  'controladora',
  'gateway',
  'atuador',
  'valvula',
  'válvula',
  'damper',
  'sensor',
  'inversor',
  'rooftop',
  'split',
];

/**
 * Extrai protocolos/fabricantes/equipamentos citados num texto (pergunta do
 * chat ou contexto do ativo) para o re-ranqueamento dos hits.
 */
export function extractKnowledgeTarget(text: string): KnowledgeRankTarget {
  const t = text ?? '';
  const flat = stripAccents(t);
  const protocols = PROTOCOL_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.term);
  const vendors = KNOWN_VENDORS.filter((v) => flat.includes(stripAccents(v)));
  const equipment = EQUIPMENT_TERMS.filter((e) => flat.includes(stripAccents(e)));
  return { protocols, vendors, equipment };
}

// ─── Anti-alucinação de case_id ──────────────────────────────────────────────

const CASE_ID_MENTION_RE = /\bBB-[A-Z0-9]{2,8}-\d{3,6}\b/g;

/**
 * Salvaguarda anti-alucinação: neutraliza menções a case_id (BB-XXX-NNNN) que
 * NÃO estão entre os casos efetivamente recuperados pela busca — a IA nunca
 * "cita" um caso que o RAG não trouxe.
 */
export function sanitizeKnowledgeCaseIds(reply: string, retrievedCaseIds: string[]): string {
  const valid = new Set(retrievedCaseIds.map((id) => id.toUpperCase()));
  return reply.replace(CASE_ID_MENTION_RE, (id) =>
    valid.has(id.toUpperCase()) ? id : '[caso não encontrado na base]',
  );
}
