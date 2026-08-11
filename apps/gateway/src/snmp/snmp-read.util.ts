import * as snmp from 'net-snmp';

/** Timeout por request SNMP (ms). */
export const SNMP_TIMEOUT_MS = 3000;

export interface SnmpTarget {
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
}

/**
 * Classifica um erro do net-snmp:
 *   - 'silence'        → o agente NÃO respondeu (timeout / rede / community
 *                        errada — o firmware simplesmente descarta o pacote);
 *   - 'agent_error'    → o agente RESPONDEU com um erro de protocolo (ex.:
 *                        noSuchName no SNMPv1, GenErr…). A câmera está viva;
 *                        só o OID pedido não existe/não é legível.
 *
 * Regra aprendida em campo (Hikvision real): responder com erro É uma
 * resposta — nunca pode virar "câmera não respondeu".
 */
export function classifySnmpError(error: unknown): 'silence' | 'agent_error' {
  const name = (error as { name?: string } | null)?.name ?? '';
  // RequestFailedError = PDU de resposta com error-status ≠ 0 (agente vivo).
  if (name === 'RequestFailedError') return 'agent_error';
  // RequestTimedOutError e erros de socket/rede = silêncio.
  return 'silence';
}

/**
 * Normaliza um valor de varbind SNMP para número.
 *
 * Câmeras (ex.: Hikvision) respondem métricas como OCTET STRING com sufixo
 * de unidade — "45 PERCENT", "256 MB", "0.0 GB" — em vez de INTEGER. Aqui
 * extraímos a parte numérica inicial (aceitando vírgula decimal), tratando
 * Buffer/string/número de forma uniforme. Retorna null quando não há número.
 *
 * É o ÚNICO ponto de parsing de valor SNMP: polling de telemetria, teste e
 * diagnóstico usam esta função — nunca parsing paralelo divergente.
 */
export function parseSnmpNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  const trimmed = text.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;
  // Prefixo numérico ("45 PERCENT" → 45, "0.0 GB" → 0.0, "87,5 %" → 87.5)
  const match = /^[+-]?\d+(?:[.,]\d+)?/.exec(trimmed);
  if (!match) return null;
  const n = Number(match[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza um varbind SNMP para string legível (sysDescr, sysObjectID…).
 * OIDs chegam como string da lib; buffers viram utf8. Retorna null p/ vazio.
 */
export function parseSnmpString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

/**
 * GET "cru" de OIDs textuais (sysDescr, sysObjectID…) numa sessão efêmera.
 * Best-effort para identificação de fabricante: erro de agente → posições
 * null (host vivo, OID ausente); silêncio → null (host não respondeu).
 * Não faz fallback por OID — identificação tolera lacunas.
 */
export function readSnmpStrings(
  target: SnmpTarget,
  oids: string[],
): Promise<Array<string | null> | null> {
  return new Promise((resolve) => {
    const session = createSession(target);
    let settled = false;
    const done = (result: Array<string | null> | null) => {
      if (settled) return;
      settled = true;
      try {
        session.close();
      } catch {
        // best-effort
      }
      resolve(result);
    };
    session.get(oids, (error: Error | null, varbinds: snmp.VarBind[]) => {
      if (error) {
        done(classifySnmpError(error) === 'agent_error' ? oids.map(() => null) : null);
        return;
      }
      done(
        varbinds.map((vb) =>
          vb && !snmp.isVarbindError(vb) ? parseSnmpString(vb.value) : null,
        ),
      );
    });
    session.on('error', () => done(null));
  });
}

/** Pausa entre GETs individuais do fallback (firmwares descartam rajadas). */
const FALLBACK_GET_INTERVAL_MS = 100;

function createSession(target: SnmpTarget): snmp.Session {
  return snmp.createSession(target.ip, target.community || 'public', {
    port: target.port || 161,
    version: target.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c,
    timeout: SNMP_TIMEOUT_MS,
    retries: 1,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET de UM OID numa sessão efêmera própria. Retorna o valor numérico, ou
 * null quando o OID não é suportado / o host não respondeu a este GET.
 * Usado no fallback por OID — a vivacidade do host já foi provada pelo lote.
 */
function readOneOid(target: SnmpTarget, oid: string): Promise<number | null> {
  return new Promise((resolve) => {
    const session = createSession(target);
    let settled = false;
    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      try {
        session.close();
      } catch {
        // best-effort
      }
      resolve(value);
    };
    session.get([oid], (error: Error | null, varbinds: snmp.VarBind[]) => {
      if (error) {
        done(null);
        return;
      }
      const vb = varbinds[0];
      done(vb && !snmp.isVarbindError(vb) ? parseSnmpNumber(vb.value) : null);
    });
    session.on('error', () => done(null));
  });
}

/**
 * Fallback por OID: relê cada OID individualmente (padrão split-on-error do
 * Modbus). Usado quando o GET em lote volta com erro de agente — em SNMP v1,
 * um único OID inválido derruba a requisição inteira e sem o fallback TODOS
 * os pontos ficariam null mesmo com a câmera respondendo.
 * A ordem do array de retorno espelha a ordem dos OIDs de entrada.
 */
async function readOidsIndividually(
  target: SnmpTarget,
  oids: string[],
): Promise<Array<number | null>> {
  const values: Array<number | null> = [];
  for (let i = 0; i < oids.length; i++) {
    if (i > 0) await sleep(FALLBACK_GET_INTERVAL_MS);
    values.push(await readOneOid(target, oids[i]));
  }
  return values;
}

/** Limite de entradas por coluna no walk de tabela (proteção contra loops). */
const TABLE_WALK_MAX_ENTRIES = 2048;

/** Timeout por sessão de walk de tabela (ms). */
const TABLE_WALK_TIMEOUT_MS = 20_000;

/**
 * Entrada de tabela SNMP lida no walk de uma coluna.
 * ifIndex é o último componente numérico do OID (ex.: .1.3.6.1.2.1.2.2.1.8.3 → ifIndex=3).
 *
 * counterType é preenchido a partir do campo `type` do varbind retornado pelo
 * agente SNMP. Counter32 (type=65/0x41) e Counter64 (type=70/0x46) são os
 * relevantes para cálculo de taxa B/s; demais tipos ficam como undefined.
 */
export interface SnmpTableEntry {
  oid: string;
  ifIndex: number;
  value: number | null;
  /** 'counter32' | 'counter64' quando o varbind reportou o tipo explicitamente. */
  counterType?: 'counter32' | 'counter64';
}

/**
 * Lê uma coluna de tabela SNMP (subtree walk) a partir do OID-prefixo da
 * coluna (sem o índice final). Retorna:
 *   - Array de entradas { oid, ifIndex, value } quando o equipamento respondeu
 *     (mesmo que vazio — tabela sem entradas ≠ sem resposta);
 *   - null quando o equipamento NÃO respondeu (timeout/rede).
 *
 * Usa `session.subtree()` do net-snmp que envia GETBULK em v2c e GETNEXT em
 * v1 internamente — mesma API, comportamento otimizado por versão.
 *
 * split-on-error preservado: varbinds com erro de OID são ignorados e o walk
 * continua. Um erro fatal de sessão (timeout) retorna null.
 *
 * Limite de entradas por coluna: TABLE_WALK_MAX_ENTRIES (proteção contra
 * loops em equipamentos com tabelas gigantes).
 */
export function readSnmpTable(
  target: SnmpTarget,
  columnOidPrefix: string,
): Promise<SnmpTableEntry[] | null> {
  return new Promise((resolve) => {
    const session = snmp.createSession(target.ip, target.community || 'public', {
      port: target.port || 161,
      version: target.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c,
      timeout: SNMP_TIMEOUT_MS,
      retries: 1,
    });

    const entries: SnmpTableEntry[] = [];
    let finished = false;
    let reachable = false;

    const timeoutHandle = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { session.close(); } catch { /* best-effort */ }
      // Se ao menos uma entrada chegou, o host respondeu — retorna o parcial.
      resolve(reachable ? entries : null);
    }, TABLE_WALK_TIMEOUT_MS);

    const done = (result: SnmpTableEntry[] | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);
      try { session.close(); } catch { /* best-effort */ }
      resolve(result);
    };

    (session as unknown as {
      subtree: (
        oid: string,
        maxRepetitions: number,
        feedCb: (varbinds: snmp.VarBind[]) => void,
        doneCb: (error?: Error | null) => void,
      ) => void;
    }).subtree(
      columnOidPrefix,
      20,
      (varbinds: snmp.VarBind[]) => {
        for (const vb of varbinds) {
          // Varbind com erro de OID: ignora (split-on-error) — walk continua.
          if (snmp.isVarbindError(vb)) continue;

          reachable = true;

          // Extrai o ifIndex: último componente numérico do OID.
          const oidStr = String(vb.oid);
          const suffix = oidStr.startsWith(columnOidPrefix)
            ? oidStr.slice(columnOidPrefix.length).replace(/^\./, '')
            : '';
          const ifIndex = /^\d+$/.test(suffix) ? Number(suffix) : null;
          if (ifIndex === null) continue;

          // Classifica o tipo de contador a partir do campo type do varbind.
          // 65 = Counter32 (0x41), 70 = Counter64 (0x46) — RFC 1902 / net-snmp ObjectType.
          const counterType: SnmpTableEntry['counterType'] =
            vb.type === 65 ? 'counter32' : vb.type === 70 ? 'counter64' : undefined;

          entries.push({
            oid: oidStr,
            ifIndex,
            value: parseSnmpNumber(vb.value),
            counterType,
          });

          if (entries.length >= TABLE_WALK_MAX_ENTRIES) {
            // Truncamento: para o walk e retorna o que coletou.
            done(entries);
            return;
          }
        }
      },
      (error?: Error | null) => {
        if (error) {
          // Erro no final do walk: se ao menos uma entrada chegou, o host
          // respondeu. Erros de "endOfMibView" são normais (fim da coluna).
          done(reachable ? entries : null);
          return;
        }
        done(reachable ? entries : (entries.length === 0 && !reachable ? null : entries));
      },
    );

    session.on('error', () => done(reachable ? entries : null));
  });
}

/**
 * Lê uma coluna de tabela SNMP como strings (ifDescr, ifAlias, etc.).
 * Mesmo contrato de readSnmpTable mas retorna string | null em vez de number.
 */
export interface SnmpTableStringEntry {
  oid: string;
  ifIndex: number;
  value: string | null;
}

export function readSnmpTableStrings(
  target: SnmpTarget,
  columnOidPrefix: string,
): Promise<SnmpTableStringEntry[] | null> {
  return new Promise((resolve) => {
    const session = snmp.createSession(target.ip, target.community || 'public', {
      port: target.port || 161,
      version: target.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c,
      timeout: SNMP_TIMEOUT_MS,
      retries: 1,
    });

    const entries: SnmpTableStringEntry[] = [];
    let finished = false;
    let reachable = false;

    const timeoutHandle = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { session.close(); } catch { /* best-effort */ }
      resolve(reachable ? entries : null);
    }, TABLE_WALK_TIMEOUT_MS);

    const done = (result: SnmpTableStringEntry[] | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);
      try { session.close(); } catch { /* best-effort */ }
      resolve(result);
    };

    (session as unknown as {
      subtree: (
        oid: string,
        maxRepetitions: number,
        feedCb: (varbinds: snmp.VarBind[]) => void,
        doneCb: (error?: Error | null) => void,
      ) => void;
    }).subtree(
      columnOidPrefix,
      20,
      (varbinds: snmp.VarBind[]) => {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          reachable = true;
          const oidStr = String(vb.oid);
          const suffix = oidStr.startsWith(columnOidPrefix)
            ? oidStr.slice(columnOidPrefix.length).replace(/^\./, '')
            : '';
          const ifIndex = /^\d+$/.test(suffix) ? Number(suffix) : null;
          if (ifIndex === null) continue;
          entries.push({ oid: oidStr, ifIndex, value: parseSnmpString(vb.value) });
          if (entries.length >= TABLE_WALK_MAX_ENTRIES) { done(entries); return; }
        }
      },
      (error?: Error | null) => {
        done(error ? (reachable ? entries : null) : (reachable ? entries : null));
      },
    );

    session.on('error', () => done(reachable ? entries : null));
  });
}

/**
 * Consulta OIDs numa sessão SNMP efêmera. Retorna:
 *   - array de valores (null nas posições com erro de OID) quando o host respondeu;
 *   - null quando o host NÃO respondeu (timeout/unreachable).
 *
 * Se o GET em lote volta com erro de agente (SNMP v1: um OID inválido
 * invalida a requisição inteira), cai para leitura individual por OID —
 * os OIDs válidos ainda retornam valor e só os inválidos ficam null.
 *
 * Sem OIDs informados, usa sysUpTime como "ping SNMP" e retorna [] se respondeu.
 */
export function readSnmpOids(
  target: SnmpTarget,
  oids: string[],
): Promise<Array<number | null> | null> {
  return new Promise((resolve) => {
    const session = createSession(target);

    let settled = false;
    const done = (result: Array<number | null> | null) => {
      if (settled) return;
      settled = true;
      try {
        session.close();
      } catch {
        // best-effort
      }
      resolve(result);
    };

    const queryOids = oids.length > 0 ? oids : ['1.3.6.1.2.1.1.3.0'];

    session.get(queryOids, (error: Error | null, varbinds: snmp.VarBind[]) => {
      if (error) {
        // Erro de protocolo (ex.: noSuchName no v1) = o agente respondeu:
        // host vivo. Com mais de um OID, relê individualmente para salvar
        // os OIDs válidos; com um só, ele mesmo é o inválido.
        if (classifySnmpError(error) === 'agent_error') {
          if (oids.length > 1) {
            try {
              session.close();
            } catch {
              // best-effort
            }
            settled = true;
            void readOidsIndividually(target, oids).then(resolve);
            return;
          }
          done(oids.length > 0 ? oids.map(() => null) : []);
          return;
        }
        done(null);
        return;
      }
      const values = varbinds.map((vb) => {
        if (snmp.isVarbindError(vb)) {
          return null;
        }
        return parseSnmpNumber(vb.value);
      });
      done(oids.length > 0 ? values : []);
    });

    session.on('error', () => done(null));
  });
}
