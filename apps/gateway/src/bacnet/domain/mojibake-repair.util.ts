/**
 * Repara nomes com o caractere U+FFFD (�) — resultado de controladoras BACnet
 * que declaram UTF-8 mas enviam acentos em Latin-1. O byte original se perde
 * na decodificação, então a recuperação usa um dicionário de palavras comuns
 * em automação predial: o � funciona como curinga de exatamente 1 caractere.
 *
 * Palavras fora do dicionário permanecem intactas (com o �), nunca chutamos.
 */

const REPLACEMENT_CHAR = '\uFFFD';

/** Dicionário (minúsculas, acentuadas) de vocabulário de automação predial. */
const DICTIONARY = [
  'água', 'poço', 'nível', 'mínimo', 'máximo', 'mín', 'máx',
  'síntese', 'extravasão', 'automático', 'automática', 'pressão', 'vazão',
  'ligação', 'medição', 'tensão', 'exaustão', 'iluminação', 'ventilação',
  'injeção', 'sucção', 'condensação', 'climatização', 'refrigeração',
  'operação', 'situação', 'posição', 'rotação', 'direção', 'estação',
  'subestação', 'emergência', 'frequência', 'referência', 'ocorrência',
  'presença', 'ausência', 'média', 'médio', 'botão', 'padrão', 'vácuo',
  'elétrica', 'elétrico', 'térmica', 'térmico', 'hidráulica', 'hidráulico',
  'sanitário', 'sanitária', 'reservatório', 'relatório', 'horário',
  'usuário', 'secundário', 'secundária', 'primário', 'primária', 'prédio',
  'térreo', 'geração', 'proteção', 'atuação', 'comunicação', 'manutenção',
  'alimentação', 'distribuição', 'instalação', 'programação',
  'configuração', 'calibração', 'saturação', 'infiltração', 'início',
  'saída', 'função', 'seleção', 'estágio', 'gás', 'óleo', 'combustível',
  'não', 'órgão', 'pátio', 'vestiário', 'escritório', 'gerência',
  'circulação', 'renovação', 'recirculação', 'pressurização', 'detecção',
  'inundação', 'condensadora', 'evaporadora',
];

/**
 * Tenta casar `word` (contendo �) contra o dicionário, tratando cada �
 * como exatamente 1 caractere. Retorna a palavra reparada ou null.
 */
function repairWord(word: string, titleCaseContext: boolean): string | null {
  const lower = word.toLowerCase();
  for (const dictWord of DICTIONARY) {
    if (dictWord.length !== lower.length) continue;
    let ok = true;
    for (let i = 0; i < lower.length; i++) {
      if (lower[i] === REPLACEMENT_CHAR) continue;
      if (lower[i] !== dictWord[i]) { ok = false; break; }
    }
    if (!ok) continue;

    const rest = word.replace(new RegExp(REPLACEMENT_CHAR, 'g'), '');
    const isAllUpper = rest.length > 0 && rest === rest.toUpperCase() && rest !== rest.toLowerCase();

    let out = '';
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== REPLACEMENT_CHAR) { out += word[i]; continue; }
      const ch = dictWord[i];
      // Maiúscula se a palavra é toda maiúscula, ou se o � é a 1ª letra e o
      // texto ao redor usa Título Capitalizado (ex.: "�gua Gelada" → "Água
      // Gelada", mas "poço de �gua" → "poço de água"). "Po�o" → "Poço"
      // permanece correto porque o � não está na 1ª posição.
      const upper = isAllUpper || (i === 0 && titleCaseContext);
      out += upper ? ch.toUpperCase() : ch;
    }
    return out;
  }
  return null;
}

/**
 * Repara todas as palavras reconhecíveis de um texto que contenham U+FFFD.
 * Texto sem � é retornado inalterado (caminho rápido).
 */
export function repairMojibake(text: string): string {
  if (!text || !text.includes(REPLACEMENT_CHAR)) return text;
  // Contexto de caixa: se a maioria das palavras alfabéticas do texto começa
  // com maiúscula, tratamos como Título Capitalizado ao repor a 1ª letra.
  const alphaWords = text.match(/[A-Za-zÀ-ú][^\s\-/()[\],.;:]*/g) ?? [];
  const upperStarts = alphaWords.filter((w) => /^[A-ZÀ-Ú]/.test(w)).length;
  const titleCaseContext = alphaWords.length > 0 && upperStarts * 2 >= alphaWords.length;
  return text.replace(/[^\s\-/()[\],.;:]+/g, (word) => {
    if (!word.includes(REPLACEMENT_CHAR)) return word;
    return repairWord(word, titleCaseContext) ?? word;
  });
}
