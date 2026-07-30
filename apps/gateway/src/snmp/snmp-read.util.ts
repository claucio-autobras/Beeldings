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
