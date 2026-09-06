/**
 * Parser prático de arquivos MIB (ASN.1) para resolução de OIDs proprietários.
 *
 * Abordagem: extrai definições OBJECT IDENTIFIER e OBJECT-TYPE, resolve os
 * nomes parentais iterativamente a partir de um conjunto de raízes conhecidas
 * (MIB-II, enterprises, etc.) e devolve um array plano de { oid, name, description }.
 *
 * Não é um parser ASN.1 completo — trata do subconjunto relevante para MIBs
 * SNMP típicas e ignora sintaxe que não contribui para a tabela OID→nome.
 */

export interface MibEntry {
  oid: string;
  name: string;
  description?: string;
}

/** Raízes conhecidas sem precisar de MIB padrão. */
const WELL_KNOWN: Record<string, string> = {
  iso: '1',
  ccitt: '0',
  'joint-iso-ccitt': '2',
  'joint-iso-itu-t': '2',
  org: '1.3',
  dod: '1.3.6',
  internet: '1.3.6.1',
  directory: '1.3.6.1.1',
  mgmt: '1.3.6.1.2',
  mib: '1.3.6.1.2.1',
  'mib-2': '1.3.6.1.2.1',
  experimental: '1.3.6.1.3',
  private: '1.3.6.1.4',
  enterprises: '1.3.6.1.4.1',
  security: '1.3.6.1.5',
  snmpV2: '1.3.6.1.6',
  snmpv2: '1.3.6.1.6',
  snmpModules: '1.3.6.1.6.3',
  // Módulos MIB-II comuns importados por MIBs de fabricante
  system: '1.3.6.1.2.1.1',
  interfaces: '1.3.6.1.2.1.2',
  ifTable: '1.3.6.1.2.1.2.2',
  ifEntry: '1.3.6.1.2.1.2.2.1',
  ip: '1.3.6.1.2.1.4',
  icmp: '1.3.6.1.2.1.5',
  tcp: '1.3.6.1.2.1.6',
  udp: '1.3.6.1.2.1.7',
  snmp: '1.3.6.1.2.1.11',
  host: '1.3.6.1.2.1.25',
  hrSystem: '1.3.6.1.2.1.25.1',
  hrStorage: '1.3.6.1.2.1.25.2',
  hrDevice: '1.3.6.1.2.1.25.3',
  hrSWRun: '1.3.6.1.2.1.25.4',
  hrSWRunPerf: '1.3.6.1.2.1.25.5',
  hrSWInstalled: '1.3.6.1.2.1.25.6',
  hrMIBAdminInfo: '1.3.6.1.2.1.25.7',
  // UCD
  ucdSnmp: '1.3.6.1.4.1.2021',
  ucdavis: '1.3.6.1.4.1.2021',
};

/**
 * Remove comentários de linha (`--`) e de bloco em ASN.1.
 * Comentários ASN.1 começam com `--` e terminam em `--` ou fim de linha.
 */
function stripComments(text: string): string {
  // Tratar comentários de bloco (-- ... --) em uma mesma linha
  return text.replace(/--[^\n]*/g, ' ');
}

/**
 * Extrai uma definição de bloco de DESCRIPTION de um texto MIB, preservando
 * o índice de início para sabermos que a DESCRIPTION pertence ao objeto certo.
 */
function extractDescriptions(
  text: string,
): Map<number, string> {
  const map = new Map<number, string>();
  // Encontrar DESCRIPTION "..."  com possível conteúdo multiline
  const re = /DESCRIPTION\s+"((?:[^"\\]|\\.)*)"/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    map.set(m.index, m[1].replace(/\s+/g, ' ').trim());
  }
  return map;
}

/**
 * Faz o parse de um arquivo MIB ASN.1 e retorna a lista de entradas
 * OID → nome / descrição resolvidas.
 *
 * Entradas cujo OID pai não pôde ser resolvido são silenciosamente omitidas.
 */
export function parseMib(content: string): MibEntry[] {
  const cleaned = stripComments(content);
  const descriptions = extractDescriptions(content); // Usar texto original para DESCRIPTION

  // Mapa nome → OID numérico (começa com raízes conhecidas)
  const nameToOid: Record<string, string> = { ...WELL_KNOWN };

  // Coletar todas as definições de objeto no formato:
  //   name OBJECT IDENTIFIER ::= { parent offset }
  //   name OBJECT-TYPE ... ::= { parent offset }
  //   name MODULE-IDENTITY ... ::= { parent offset }
  //   name NOTIFICATION-TYPE ... ::= { parent offset }
  //   name OBJECT-GROUP ... ::= { parent offset }
  //
  // Padrão: identificador, tipo/keyword, talvez campos intermediários, ::= { parent n }
  const assignRe =
    /(\b[a-zA-Z][a-zA-Z0-9-]*)\s+(?:OBJECT-TYPE|OBJECT IDENTIFIER|MODULE-IDENTITY|NOTIFICATION-TYPE|OBJECT-GROUP|NOTIFICATION-GROUP|MODULE-COMPLIANCE|AGENT-CAPABILITIES|TEXTUAL-CONVENTION)[^:]*?::=\s*\{\s*([a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z][a-zA-Z0-9-]*)*)\s+(\d+)\s*\}/gs;

  // Também capturar o offset de índice do match para associar DESCRIPTION
  interface RawDef {
    name: string;
    parent: string;
    offset: number;
    matchIndex: number;
  }

  const rawDefs: RawDef[] = [];
  let m: RegExpExecArray | null;

  const re = assignRe;
  re.lastIndex = 0;
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1];
    // O "parent" pode ser um grupo: "enterprises 12345" — pegar último token como offset
    // Na verdade o formato é { parentName offset } ou { parentName subId offset }
    // Normalizar: dividir os tokens do bloco { } e extrair o offset (último número)
    const blockContent = m[0];
    const braceStart = blockContent.lastIndexOf('{');
    const braceEnd = blockContent.lastIndexOf('}');
    const inside = blockContent.slice(braceStart + 1, braceEnd).trim();
    const tokens = inside.split(/\s+/);
    // O offset é o último token (número)
    const offset = parseInt(tokens[tokens.length - 1], 10);
    if (isNaN(offset)) continue;
    // O parent é tudo exceto o último token
    const parent = tokens.slice(0, -1).join(' ');

    rawDefs.push({ name, parent, offset, matchIndex: m.index });
  }

  // Resolver iterativamente até que não haja mais progresso
  // (necessário para dependências entre objetos do mesmo arquivo)
  const pending = [...rawDefs];
  let progress = true;
  while (progress && pending.length > 0) {
    progress = false;
    let i = 0;
    while (i < pending.length) {
      const def = pending[i];
      // O parent pode ser "enterprises 12345" (dois tokens) — precisamos do
      // primeiro token como nome pai e o segundo como sub-prefixo intermediário
      const parentTokens = def.parent.split(/\s+/);
      const primaryParent = parentTokens[0];
      const parentOid = nameToOid[primaryParent];
      if (parentOid !== undefined) {
        // Montar o OID completo incluindo tokens intermediários
        let oidParts = parentOid;
        for (let j = 1; j < parentTokens.length; j++) {
          const sub = parseInt(parentTokens[j], 10);
          if (!isNaN(sub)) {
            oidParts = `${oidParts}.${sub}`;
          }
        }
        oidParts = `${oidParts}.${def.offset}`;
        nameToOid[def.name] = oidParts;
        pending.splice(i, 1);
        progress = true;
      } else {
        i++;
      }
    }
  }

  // Construir a lista de entradas, buscando DESCRIPTION no texto original
  const entries: MibEntry[] = [];
  const seen = new Set<string>();

  // Procurar a DESCRIPTION mais próxima ANTES de cada ::= assignment
  const descEntries = [...descriptions.entries()].sort((a, b) => a[0] - b[0]);

  for (const def of rawDefs) {
    const oid = nameToOid[def.name];
    if (!oid || seen.has(oid)) continue;
    // Verificar que é um OID válido
    if (!/^\d+(\.\d+)+$/.test(oid)) continue;
    seen.add(oid);

    // Encontrar a DESCRIPTION mais próxima anterior ao assignment do objeto
    // (ela fica dentro da definição OBJECT-TYPE, antes do ::=)
    let description: string | undefined;
    // Encontrar o range deste def no texto original
    // Heurística: a DESCRIPTION imediatamente anterior ao matchIndex do cleaned
    const matchPos = def.matchIndex;
    // Pegar a última DESCRIPTION antes do matchIndex
    let lastDescPos = -1;
    let lastDesc: string | undefined;
    for (const [pos, desc] of descEntries) {
      if (pos < matchPos) {
        lastDescPos = pos;
        lastDesc = desc;
      } else {
        break;
      }
    }
    // Verificar que a DESCRIPTION está razoavelmente próxima (dentro de 5000 chars)
    if (lastDesc && matchPos - lastDescPos < 5000) {
      description = lastDesc;
    }

    entries.push({ oid, name: def.name, description });
  }

  // Ordenar por OID para facilitar debugging
  entries.sort((a, b) => {
    const aParts = a.oid.split('.').map(Number);
    const bParts = b.oid.split('.').map(Number);
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
      if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
    }
    return aParts.length - bParts.length;
  });

  return entries;
}
