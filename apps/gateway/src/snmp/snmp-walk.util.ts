/**
 * Camada de transporte/descoberta SNMP genérica (independente de fabricante).
 *
 * Arquitetura em camadas (spec de descoberta robusta):
 *   transporte (sessão v1/v2c/v3) → walk recursivo → entrada preservada
 *   (OID, tipo ASN.1, valor bruto, valor normalizado, índice) → interpretação
 *   semântica (perfis, em outra camada — NUNCA aqui).
 *
 * Regras herdadas do campo:
 *   - Erro SNMP (noSuchObject/noSuchName) prova equipamento VIVO; só o
 *     silêncio total (timeout) é "não respondeu".
 *   - `session.subtree()` do net-snmp usa GETBULK em v2c e GETNEXT em v1 —
 *     o fallback por versão é automático.
 *   - NENHUM filtro por sufixo `.0` ou por tipo ASN.1: objetos de tabela
 *     (…1.7.3.1/…1.7.3.2), strings vazias, Gauge32, INTEGER e OCTET STRING
 *     são todos preservados. Descartes são contabilizados com motivo.
 */

import * as snmp from 'net-snmp';

import {
  classifySnmpError,
  createSnmpSession,
  normalizeSnmpValue,
  parseSnmpNumber,
  type SnmpV3Credentials,
} from './snmp-read.util';

// ─── Transporte ───────────────────────────────────────────────────────────────

/** Versões de protocolo que a camada de sessão comporta arquiteturalmente. */
export type SnmpProtocolVersion = '1' | '2c' | '3';

/** Credenciais SNMPv3 (USM) — definição canônica em snmp-read.util. */
export type { SnmpV3Credentials } from './snmp-read.util';

export interface SnmpSessionTarget {
  ip: string;
  port: number;
  version: SnmpProtocolVersion;
  /** Community (v1/v2c). Ignorada em v3. */
  community?: string;
  /** Credenciais USM (v3). */
  v3?: SnmpV3Credentials;
}

export interface SnmpSessionOptions {
  timeoutMs?: number;
  retries?: number;
}

/**
 * Abre uma sessão SNMP para o alvo. Único ponto de criação de sessão da
 * camada de descoberta — GET/GETNEXT/GETBULK/WALK operam sobre ela.
 * v1/v2c via community; v3 via usuário USM (createV3Session).
 */
export function openSnmpSession(
  target: SnmpSessionTarget,
  options: SnmpSessionOptions = {},
): snmp.Session {
  return createSnmpSession(
    {
      ip: target.ip,
      port: target.port,
      snmpVersion: target.version,
      community: target.community ?? 'public',
      v3: target.v3,
    },
    { timeoutMs: options.timeoutMs ?? 3000, retries: options.retries ?? 0 },
  );
}

// ─── Tipos ASN.1 ──────────────────────────────────────────────────────────────

/** Nomes dos tipos ASN.1/SNMP (RFC 1902 / net-snmp ObjectType). */
const ASN1_TYPE_NAMES: Record<number, string> = {
  1: 'Boolean',
  2: 'Integer',
  4: 'OctetString',
  5: 'Null',
  6: 'OID',
  64: 'IpAddress',
  65: 'Counter32',
  66: 'Gauge32',
  67: 'TimeTicks',
  68: 'Opaque',
  70: 'Counter64',
  128: 'NoSuchObject',
  129: 'NoSuchInstance',
  130: 'EndOfMibView',
};

/** Nome legível do tipo ASN.1 de um varbind (fallback: código numérico). */
export function asn1TypeName(type: number | undefined): string {
  if (type === undefined || type === null) return 'Unknown';
  return ASN1_TYPE_NAMES[type] ?? `Type${type}`;
}

/** Representação textual segura de um valor de varbind (Buffer, número, …). */
export function stringifySnmpValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) {
    const s = value.toString('utf8');
    return /^[\x20-\x7e\s]*$/.test(s) ? s : value.toString('hex');
  }
  return String(value);
}

// ─── Normalização ASN.1 na fronteira de entrada ──────────────────────────────

/**
 * Natureza do valor normalizado, derivada do tipo ASN.1:
 *   - 'duration' → TimeTicks já convertido de centésimos de segundo → SEGUNDOS
 *     na fronteira de entrada (consumidores NÃO devem reaplicar scale 0.01);
 *   - 'counter'  → Counter32/Counter64: acumulador bruto. A conversão em taxa
 *     é responsabilidade do COLETOR (computeRate), nunca da descoberta.
 */
export type SnmpValueKind = 'duration' | 'counter';

export interface NormalizedSnmpValue {
  numeric: number | null;
  kind?: SnmpValueKind;
}

/** Códigos ASN.1 relevantes para a normalização (RFC 1902 / net-snmp). */
const ASN1_COUNTER32 = 65;
const ASN1_TIMETICKS = 67;
const ASN1_COUNTER64 = 70;

/**
 * Normalizador ÚNICO de varbind na fronteira de entrada do walk (Bug 1 —
 * normalização dupla): dado o tipo net-snmp, aplica a conversão correta.
 *
 *   - TimeTicks    → ÷100 (centésimos de segundo → s), kind 'duration';
 *   - Counter32/64 → valor bruto preservado, kind 'counter' (taxa é do coletor);
 *   - OCTET STRING numérico → float (via parseSnmpNumber);
 *   - INTEGER enumerado → valor preservado (o rótulo é da camada semântica).
 *
 * A extração numérica delega a parseSnmpNumber — nunca parsing paralelo.
 */
export function normalizeSnmpVarbind(
  type: number | undefined,
  value: unknown,
): NormalizedSnmpValue {
  const normalized = normalizeSnmpValue(type, value);
  return normalized.kind
    ? { numeric: normalized.numeric, kind: normalized.kind }
    : { numeric: normalized.numeric };
}

// ─── Comparação e contenção de OIDs (guards do walk) ─────────────────────────

/**
 * Compara dois OIDs componente a componente, NUMERICAMENTE (nunca
 * lexicograficamente: …2.10 > …2.9). Retorna <0, 0 ou >0.
 */
export function compareOids(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    if (as[i] === undefined) return -1;
    if (bs[i] === undefined) return 1;
    const x = Number(as[i]);
    const y = Number(bs[i]);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** true quando `oid` é igual a `root` ou descendente dela. */
export function oidIsUnderRoot(oid: string, root: string): boolean {
  return oid === root || oid.startsWith(`${root}.`);
}

// ─── Walk recursivo de subárvore ──────────────────────────────────────────────

/**
 * Objeto SNMP descoberto no walk — preserva TUDO que o agente respondeu.
 * `value` (string) mantém compatibilidade com consumidores antigos do walk.
 */
export interface DiscoveredSnmpObject {
  oid: string;
  /** Nome do tipo ASN.1 ('OctetString', 'Gauge32', 'Integer', …). */
  type: string;
  /** Valor bruto em representação textual (pode ser string vazia). */
  value: string;
  /**
   * Valor normalizado numérico (null quando não numérico).
   * TimeTicks já chega em SEGUNDOS (ver `normalizeSnmpVarbind`).
   */
  numeric: number | null;
  /**
   * Natureza do valor normalizado ('duration' = TimeTicks já em segundos;
   * 'counter' = acumulador Counter32/64). Ausente para os demais tipos.
   * Gateways antigos não enviam este campo (compat no backend).
   */
  kind?: SnmpValueKind;
  /**
   * Índice de instância: último componente do OID quando ≠ 0 (entrada de
   * tabela/instância múltipla, ex.: …1.7.3.2 → 2). Escalares .0 → null.
   */
  index: number | null;
}

/** Classificação do desfecho de um walk de subárvore. */
export type WalkErrorKind =
  | 'timeout'        // silêncio total — equipamento/rede indisponível
  | 'auth'           // autenticação/autorizacão recusada pelo agente
  | 'no_permission'  // agente vivo mas recusou acesso à subárvore
  | 'agent_error';   // agente respondeu erro de protocolo (subárvore inexistente)

export interface SubtreeWalkOptions {
  /** Máximo de entradas coletadas (proteção contra subárvores gigantes). */
  maxEntries?: number;
  /** Orçamento de tempo do walk desta subárvore (ms). */
  budgetMs?: number;
  /** max-repetitions do GETBULK (v2c). */
  maxRepetitions?: number;
  /** Timeout por request individual (ms). */
  requestTimeoutMs?: number;
}

export interface SubtreeWalkResult {
  root: string;
  entries: DiscoveredSnmpObject[];
  /** true quando o walk parou por limite de entradas ou orçamento de tempo. */
  truncated: boolean;
  /** Varbinds descartados, por motivo (nunca por sufixo/tipo válido). */
  discarded: Record<string, number>;
  /**
   * null quando o walk terminou normalmente (mesmo vazio — subárvore
   * inexistente com agente vivo NÃO é erro de walk, é `agent_error` apenas
   * quando o agente devolveu erro de protocolo).
   */
  error: WalkErrorKind | null;
  /** true quando o agente respondeu QUALQUER datagrama (vivo). */
  responded: boolean;
  durationMs: number;
}

const DEFAULT_WALK_MAX_ENTRIES = 2000;
const DEFAULT_WALK_BUDGET_MS = 25_000;
const DEFAULT_MAX_REPETITIONS = 20;
const DEFAULT_REQUEST_TIMEOUT_MS = 2500;

/** Extrai o índice de instância (último componente ≠ 0) de um OID. */
export function instanceIndexOf(oid: string): number | null {
  const last = oid.slice(oid.lastIndexOf('.') + 1);
  if (!/^\d+$/.test(last)) return null;
  const n = Number(last);
  return n === 0 ? null : n;
}

/** Classifica o erro terminal de um walk. */
function classifyWalkError(error: unknown): WalkErrorKind {
  const message = String((error as Error | null)?.message ?? '').toLowerCase();
  const status = (error as { status?: number } | null)?.status;
  // net-snmp: RequestFailedError carrega o error-status da PDU.
  // 6 = noAccess, 16 = authorizationError (RFC 1905).
  if (status === 16 || /authorization/.test(message)) return 'auth';
  if (status === 6 || /noaccess|no access/.test(message)) return 'no_permission';
  if (classifySnmpError(error) === 'agent_error') return 'agent_error';
  return 'timeout';
}

// ─── Guards do walk (agentes defeituosos) ────────────────────────────────────

/** Códigos ASN.1 de varbind de erro (fim normal de dados, nunca erro fatal). */
const ASN1_NO_SUCH_OBJECT = 128;
const ASN1_NO_SUCH_INSTANCE = 129;
const ASN1_END_OF_MIB_VIEW = 130;

/** Desfecho do processamento de um lote de varbinds pelo coletor. */
export type WalkFeedAction =
  | 'continue'    // lote consumido, walk segue
  | 'stop';       // fim (normal ou defensivo) — encerrar o walk desta subárvore

/**
 * Coletor puro de entradas do walk com as três salvaguardas contra agentes
 * defeituosos (testável sem sessão SNMP):
 *
 *   (a) OID fora do prefixo da raiz → para (agente vazou da subárvore);
 *   (b) OID não estritamente crescente → aborta (agente em loop);
 *   (c) NoSuchObject/NoSuchInstance/EndOfMibView → fim NORMAL de dados.
 *
 * Todo descarte é contabilizado em `discarded` com motivo — nunca silencioso.
 */
export class WalkEntryCollector {
  readonly entries: DiscoveredSnmpObject[] = [];
  readonly discarded: Record<string, number> = {};
  truncated = false;
  private lastOid: string | null = null;

  constructor(
    private readonly root: string,
    private readonly maxEntries: number,
  ) {}

  private discard(reason: string): void {
    this.discarded[reason] = (this.discarded[reason] ?? 0) + 1;
  }

  feed(varbinds: Array<{ oid?: unknown; type?: number; value?: unknown }>): WalkFeedAction {
    for (const vb of varbinds) {
      const type = vb.type;
      // Varbind de erro = fim normal de dados (nunca erro fatal).
      if (
        type === ASN1_NO_SUCH_OBJECT ||
        type === ASN1_NO_SUCH_INSTANCE ||
        type === ASN1_END_OF_MIB_VIEW
      ) {
        this.discard(asn1TypeName(type));
        return 'stop';
      }
      const oid = String(vb.oid ?? '');
      // Guard (a): agente vazou da subárvore solicitada → fim normal.
      if (!oidIsUnderRoot(oid, this.root)) {
        this.discard('out_of_subtree');
        return 'stop';
      }
      // Guard (b): OID não estritamente crescente = agente em loop → aborta.
      if (this.lastOid !== null && compareOids(oid, this.lastOid) <= 0) {
        this.discard('non_increasing_oid');
        this.truncated = true;
        return 'stop';
      }
      this.lastOid = oid;
      if (this.entries.length >= this.maxEntries) {
        this.truncated = true;
        return 'stop';
      }
      const normalized = normalizeSnmpVarbind(type, vb.value);
      this.entries.push({
        oid,
        type: asn1TypeName(type),
        value: stringifySnmpValue(vb.value),
        numeric: normalized.numeric,
        ...(normalized.kind ? { kind: normalized.kind } : {}),
        index: instanceIndexOf(oid),
      });
    }
    return 'continue';
  }
}

/**
 * Degradação de max-repetitions após `tooBig`: metade, mínimo 1.
 * Retorna null quando não há mais para onde reduzir (já estava em 1).
 */
export function nextMaxRepetitions(current: number): number | null {
  if (current <= 1) return null;
  return Math.max(1, Math.floor(current / 2));
}

/** true quando o erro é `tooBig` (error-status 1, RFC 1905). */
export function isTooBigError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 1) return true;
  return /too\s*big/i.test(String((error as Error | null)?.message ?? ''));
}

/**
 * Walk recursivo genérico de uma subárvore SNMP.
 *
 * GETBULK em v2c, GETNEXT em v1 (via `session.subtree()`), com orçamento de
 * tempo e limite de entradas. Cada entrada preserva OID completo, tipo ASN.1,
 * valor bruto, valor normalizado (TimeTicks já em segundos — ver
 * `normalizeSnmpVarbind`) e índice de instância. Varbinds descartados são
 * contabilizados em `discarded` com motivo.
 *
 * Resposta `tooBig` reduz max-repetitions pela metade e tenta de novo (dentro
 * do orçamento de tempo); os guards de subárvore/ordem vivem no
 * `WalkEntryCollector`.
 */
export async function walkSnmpSubtree(
  target: SnmpSessionTarget,
  root: string,
  options: SubtreeWalkOptions = {},
): Promise<SubtreeWalkResult> {
  const budgetMs = options.budgetMs ?? DEFAULT_WALK_BUDGET_MS;
  const startedAt = Date.now();
  let maxRepetitions = options.maxRepetitions ?? DEFAULT_MAX_REPETITIONS;

  for (;;) {
    const remaining = budgetMs - (Date.now() - startedAt);
    const attempt = await walkSnmpSubtreeOnce(target, root, options, maxRepetitions, Math.max(remaining, 1));
    if (!attempt.tooBig) {
      return { ...attempt.result, durationMs: Date.now() - startedAt };
    }
    const next = nextMaxRepetitions(maxRepetitions);
    const stillHasBudget = budgetMs - (Date.now() - startedAt) > 0;
    if (next === null || !stillHasBudget) {
      // Sem mais degradação possível: devolve o desfecho como erro de agente.
      return {
        ...attempt.result,
        error: attempt.result.error ?? 'agent_error',
        durationMs: Date.now() - startedAt,
      };
    }
    maxRepetitions = next;
  }
}

/** Uma tentativa de walk (um max-repetitions fixo). */
function walkSnmpSubtreeOnce(
  target: SnmpSessionTarget,
  root: string,
  options: SubtreeWalkOptions,
  maxRepetitions: number,
  budgetMs: number,
): Promise<{ result: SubtreeWalkResult; tooBig: boolean }> {
  const maxEntries = options.maxEntries ?? DEFAULT_WALK_MAX_ENTRIES;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let session: snmp.Session;
    try {
      session = openSnmpSession(target, {
        timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        retries: 1,
      });
    } catch (err) {
      resolve({
        result: {
          root,
          entries: [],
          truncated: false,
          discarded: {},
          error: classifyWalkError(err),
          responded: false,
          durationMs: Date.now() - startedAt,
        },
        tooBig: false,
      });
      return;
    }

    const collector = new WalkEntryCollector(root, maxEntries);
    let responded = false;
    let terminalError: WalkErrorKind | null = null;
    let tooBig = false;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(budgetHandle);
      try {
        session.close();
      } catch {
        // best-effort
      }
      resolve({
        result: {
          root,
          entries: collector.entries,
          truncated: collector.truncated,
          discarded: collector.discarded,
          error: terminalError,
          responded,
          durationMs: Date.now() - startedAt,
        },
        tooBig,
      });
    };

    const budgetHandle = setTimeout(() => {
      collector.truncated = true;
      finish();
    }, budgetMs);

    // `subtree` existe em runtime mas falta nas typings do net-snmp.
    (session as unknown as {
      subtree: (
        oid: string,
        maxRepetitions: number,
        feedCb: (varbinds: snmp.VarBind[]) => void,
        doneCb: (error?: Error | null) => void,
      ) => void;
    }).subtree(
      root,
      maxRepetitions,
      (varbinds: snmp.VarBind[]) => {
        responded = true;
        if (collector.feed(varbinds) === 'stop') finish();
      },
      (error?: Error | null) => {
        if (error) {
          // tooBig: a resposta não coube no datagrama — sinaliza para o
          // chamador degradar max-repetitions e tentar de novo.
          if (isTooBigError(error)) {
            responded = true;
            tooBig = true;
            finish();
            return;
          }
          // Qualquer datagrama recebido prova o agente vivo; erro de agente
          // no fim do walk (ex.: noSuchName em v1 = fim da subárvore) é normal.
          const kind = classifyWalkError(error);
          if (kind === 'agent_error') {
            responded = true;
            // v1 sinaliza fim de subárvore com noSuchName — não é falha.
            if (collector.entries.length === 0) terminalError = 'agent_error';
          } else {
            terminalError = kind;
          }
        }
        finish();
      },
    );

    session.on('error', () => {
      if (!responded) terminalError = 'timeout';
      finish();
    });
  });
}

// ─── Resolução de raízes de walk ─────────────────────────────────────────────

export interface WalkRoot {
  root: string;
  label: string;
}

/**
 * Raízes padrão de descoberta (MIBs universais), na ORDEM canônica do
 * documento de descoberta: system → IF-MIB → HOST-RESOURCES → UCD →
 * (ENTITY) → proprietárias do perfil. A ordem importa: as primeiras raízes
 * identificam o equipamento e alimentam o fallback de enterprise.
 */
export const STANDARD_WALK_ROOTS: WalkRoot[] = [
  { root: '1.3.6.1.2.1.1', label: 'MIB-II system' },
  { root: '1.3.6.1.2.1.2', label: 'MIB-II interfaces' },
  { root: '1.3.6.1.2.1.25', label: 'HOST-RESOURCES-MIB' },
  { root: '1.3.6.1.4.1.2021', label: 'UCD-SNMP-MIB' },
  { root: '1.3.6.1.2.1.47', label: 'ENTITY-MIB' },
];

const isUnderRoot = oidIsUnderRoot;

/**
 * Monta a lista final de raízes de walk:
 *   1. Raízes padrão (MIB-II system/interfaces, HOST-RESOURCES, ENTITY);
 *   2. Raízes declaradas por perfis de fabricante (conhecimento aditivo);
 *   3. Fallback: enterprise extraída do sysObjectID — SÓ quando nenhum perfil
 *      já declarou uma raiz sob aquela enterprise (a raiz do perfil é mais
 *      específica e proposital).
 *
 * Dedupe por ancestralidade: uma raiz descendente de outra já incluída é
 * redundante (a ancestral cobre a subárvore inteira).
 */
export function resolveWalkRoots(input: {
  profileRoots?: string[];
  sysObjectId?: string | null;
  includeStandard?: boolean;
}): WalkRoot[] {
  const roots: WalkRoot[] = [];
  const push = (candidate: WalkRoot) => {
    if (roots.some((r) => isUnderRoot(candidate.root, r.root))) return;
    // Remove raízes já incluídas que são descendentes da nova (a nova cobre).
    for (let i = roots.length - 1; i >= 0; i--) {
      if (isUnderRoot(roots[i].root, candidate.root)) roots.splice(i, 1);
    }
    roots.push(candidate);
  };

  if (input.includeStandard !== false) {
    for (const r of STANDARD_WALK_ROOTS) push(r);
  }

  const profileRoots = (input.profileRoots ?? []).filter(Boolean);
  for (const root of profileRoots) {
    push({ root, label: `Perfil do fabricante (${root})` });
  }

  const sysObjectId = input.sysObjectId?.trim() ?? '';
  const m = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(sysObjectId);
  if (m) {
    const enterpriseRoot = `1.3.6.1.4.1.${m[1]}`;
    const coveredByProfile = profileRoots.some((r) =>
      isUnderRoot(r, enterpriseRoot),
    );
    if (!coveredByProfile) {
      push({
        root: enterpriseRoot,
        label: `Enterprise do fabricante (${enterpriseRoot})`,
      });
    }
  }

  return roots;
}
